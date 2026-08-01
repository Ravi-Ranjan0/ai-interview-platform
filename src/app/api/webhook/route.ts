import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { streamVideo } from "@/lib/stream-video";
import { CallEndedEvent, CallRecordingReadyEvent, CallSessionParticipantLeftEvent, CallSessionStartedEvent, CallTranscriptionReadyEvent } from "@stream-io/node-sdk";
import { and, eq, not } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { qdrant } from "@/lib/qdrant";

// ponytail: static per-session RAG context — pull top-K agent-scoped chunks
// with no query filter and inline them into the instructions. Upgrade path:
// register a Stream/OpenAI tool for mid-conversation retrieval.
const RAG_CONTEXT_LIMIT = 20;
const RAG_CONTEXT_CHAR_CAP = 6000;

async function buildAgentSessionContext(agentId: string): Promise<string> {
    try {
        const result = await qdrant.scroll("agents", {
            filter: { must: [{ key: "agentId", match: { value: agentId } }] },
            limit: RAG_CONTEXT_LIMIT,
            with_payload: true,
            with_vector: false,
        });
        const points = result.points ?? [];
        if (points.length === 0) return "";
        let total = 0;
        const parts: string[] = [];
        for (const p of points) {
            const payload = p.payload as {
                text?: string;
                url?: string;
                fileName?: string;
                section?: string;
            } | null;
            const text = payload?.text?.trim();
            if (!text) continue;
            const source = payload?.fileName ?? payload?.url ?? "knowledge base";
            const block = `[${source}${payload?.section ? ` · ${payload.section}` : ""}]\n${text}`;
            if (total + block.length > RAG_CONTEXT_CHAR_CAP) break;
            parts.push(block);
            total += block.length;
        }
        return parts.join("\n\n---\n\n");
    } catch (err) {
        // Interview proceeds with instructions only, but log with a
        // greppable prefix so ops can find silent RAG regressions.
        // Was N2 in cycle 4.
        console.error(`[interview-rag-fallback] agent=${agentId}`, err);
        return "";
    }
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
            openAiApiKey: process.env.OPENAI_API_KEY!,
            agentUserId: existingAgent.id,
        });

        const ragContext = await buildAgentSessionContext(existingAgent.id);
        const sessionInstructions = ragContext
            ? `${existingAgent.instructions}\n\nREFERENCE MATERIAL (from the candidate's uploaded documents and crawled sources — cite briefly when you use it):\n${ragContext}`
            : existingAgent.instructions;

        await realTimeClient.updateSession({
            instructions: sessionInstructions,
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