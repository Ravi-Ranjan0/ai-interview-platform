import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { streamVideo } from "@/lib/stream-video";
import { CallEndedEvent, CallRecordingReadyEvent, CallSessionParticipantLeftEvent, CallSessionStartedEvent, CallTranscriptionReadyEvent } from "@stream-io/node-sdk";
import { and, eq, not } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { qdrant } from "@/lib/qdrant";
import { geminiEmbeddings } from "@/lib/embedding";
import type { AgentVectorPayload } from "@/inngest/functions";
import { env } from "@/lib/env";

const RAG_SCORE_THRESHOLD = 0.5;

// Mid-conversation retrieval: registered as an OpenAI Realtime tool (see
// call.session_started below) instead of a one-shot context dump, so the
// live interviewer can pull in specific facts on demand. `addTool` (from
// @openai/realtime-api-beta, which @stream-io/openai-realtime-api wraps)
// owns the whole function-call round trip itself — it re-registers the tool
// into the session, sends `function_call_output` once `handler` resolves,
// and triggers the next response. No manual event wiring needed.
//
// `candidateId` scopes quiz-answer-derived chunks (see gradeQuizAttempt in
// src/inngest/functions.ts) to the one candidate they belong to; general
// knowledge-base chunks have no candidateId and stay visible to everyone.
function buildKnowledgeBaseSearchTool(agentId: string, candidateId: string) {
    return {
        definition: {
            name: "search_knowledge_base",
            description:
                "Search the candidate's uploaded documents, crawled sources, and their pre-interview quiz answers for facts relevant to a topic. Call this whenever you need specifics about the candidate's background/experience or the job knowledge base instead of guessing.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "What to search for" },
                },
                required: ["query"],
            },
        },
        handler: async ({ query }: { query: string }) => {
            try {
                const vector = await geminiEmbeddings.embedQuery(query);
                const raw = await qdrant.search("agents", {
                    vector,
                    limit: 8,
                    filter: {
                        must: [{ key: "agentId", match: { value: agentId } }],
                        should: [
                            { is_empty: { key: "candidateId" } },
                            { key: "candidateId", match: { value: candidateId } },
                        ],
                    },
                });
                const hits = raw.filter((r) => (r.score ?? 0) >= RAG_SCORE_THRESHOLD).slice(0, 5);
                if (hits.length === 0) return { found: false, results: [] };
                return {
                    found: true,
                    results: hits.map((r) => {
                        const p = r.payload as Partial<AgentVectorPayload>;
                        return { text: p.text, source: p.source ?? p.fileName ?? p.url ?? "quiz answer" };
                    }),
                };
            } catch (err) {
                console.error(`[interview-rag-tool-failed] agent=${agentId}`, err);
                return { found: false, results: [], error: "retrieval failed" };
            }
        },
    };
}
function verifySignaturewithSDK(body: string, signature: string): boolean {
    return streamVideo.verifyWebhook(body, signature);
};

export async function POST(req: NextRequest) {
    const signature = req.headers.get("x-signature");
    const apiKey = req.headers.get("x-api-key");

    if (!signature || !apiKey) {
        return NextResponse.json({ error: "Missing signature or API key" }, { status: 400 });
    }

    const body = await req.text();
    if (!verifySignaturewithSDK(body, signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(body) as Record<string, unknown>;
    } catch (error) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const eventType = (payload as Record<string, unknown>)?.type;
    if (eventType === "call.session_started") {
        const event = payload as CallSessionStartedEvent;
        const meetingId = event.call.custom?.meetingId;

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meeting ID in event" }, { status: 400 });
        }

        const [existingMeeting] = await db
            .select()
            .from(meetings)
            .where(
                and(
                    eq(meetings.id, meetingId),
                    not(eq(meetings.status, "completed")),
                    not(eq(meetings.status, "active")),
                    not(eq(meetings.status, "cancelled")),
                    not(eq(meetings.status, "processing"))
                )
            );

        if (!existingMeeting) {
            return NextResponse.json({ error: "Meeting not found or already completed" }, { status: 404 });
        }

        await db
            .update(meetings)
            .set({ status: "active", startedAt: new Date() })
            .where(eq(meetings.id, existingMeeting.id));


        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, existingMeeting.agentId));

        if (!existingAgent) {
            return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        }

        const call = streamVideo.video.call("default", meetingId);

        const realTimeClient = await streamVideo.video.connectOpenAi({
            call,
            openAiApiKey: env.OPENAI_API_KEY,
            agentUserId: existingAgent.id,
        });

        const tool = buildKnowledgeBaseSearchTool(existingAgent.id, existingMeeting.userId);
        realTimeClient.addTool(tool.definition, tool.handler);

        await realTimeClient.updateSession({
            instructions:
                `${existingAgent.instructions}\n\nYou have a search_knowledge_base tool. Call it whenever you need concrete details about the candidate or the role instead of guessing.`,
        });

    } else if (eventType === "call.session_participant_left") {
        const event = payload as CallSessionParticipantLeftEvent;
        const meetingId = event.call_cid.split(":")[1];
        if (!meetingId) {
            return NextResponse.json({ error: "Missing meeting ID in event" }, { status: 400 });
        }
        const call = streamVideo.video.call("default", meetingId);
        await call.end();

    } else if (eventType === "call.session_ended") {
        const event = payload as CallEndedEvent;
        const meetingId = event.call.custom?.meetingId;

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meeting ID in event" }, { status: 400 });
        }
        await db
            .update(meetings)
            .set({ status: "processing", endedAt: new Date() })
            .where(and(eq(meetings.id, meetingId), eq(meetings.status, "active")));
    } else if (eventType === "call.transcription_ready") {
        const event = payload as CallTranscriptionReadyEvent;
        const meetingId = event.call_cid.split(":")[1];

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meeting ID in event" }, { status: 400 });
        }

        const [updatedMeeting] = await db
            .update(meetings)
            .set({
                transcriptUrl: event.call_transcription.url
            })
            .where(eq(meetings.id, meetingId))
            .returning();
        if (!updatedMeeting) {
            return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
        }

        // Call inngest 

        // ponytail: id-scoped dedupe so a Stream retry doesn't run the
        // summarizer twice per meeting. Upgrade path: per-event dedupe table.
        await inngest.send({
            id: `meetings-processing-${updatedMeeting.id}`,
            name: "meetings/processing",
            data: {
                meetingId: updatedMeeting.id,
                transcriptUrl: updatedMeeting.transcriptUrl,
            },
        });






    } else if (eventType === "call.recording_ready") {
        const event = payload as CallRecordingReadyEvent;
        const meetingId = event.call_cid.split(":")[1];

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meeting ID in event" }, { status: 400 });
        }

        await db
            .update(meetings)
            .set({
                recordingUrl: event.call_recording.url
            })
            .where(eq(meetings.id, meetingId))
            .returning();

    }

    return NextResponse.json({ status: "ok" });
}