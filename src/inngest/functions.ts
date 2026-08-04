import { StreamTranscriptItem } from "@/modules/meetings/type";
import { inngest } from "./client";
import { parseEvent } from "./events";
import { env } from "@/lib/env";
import { ROOM_STALE_AFTER_MS } from "@/constant";
import JSONL from "jsonl-parse-stringify";
import { db } from "@/db";
import { agents, meetings, messages, user, documents, rooms, roomMessages, quizQuestions, quizAttempts, quizAttemptQuestions } from "@/db/schema";
import { and, eq, gte, inArray, lt, notExists } from "drizzle-orm";
import { createAgent, gemini, TextMessage, } from "@inngest/agent-kit";
import { qdrant, ensureAgentCollection } from "@/lib/qdrant";
import { geminiEmbeddings, VECTOR_SIZE } from "@/lib/embedding";
import { randomUUID } from "crypto";
import stringSimilarity from "string-similarity";

// Shared shape between the two writers (URL + document pipelines) and the
// three readers (agentChatHandler retrieval, buildAgentSessionContext,
// url-vector cleanup). Discriminator: presence of `documentId` marks a
// document-sourced point; absence marks a URL-sourced point.
export type AgentVectorPayload = {
  agentId: string;
  text: string;
  chunkIndex: number;
  url?: string;
  section?: string;
  fileName?: string;
  documentId?: string;
  source?: string;
  // Set only on quiz-answer-derived and interview-summary-derived points
  // (see gradeQuizAttempt and meetingsProcessing below) so the live
  // interview's retrieval tool can scope a search to one candidate while
  // general knowledge-base chunks (no candidateId) stay visible to all.
  candidateId?: string;
  // Set only on interview-summary-derived points; traces a chunk back to
  // the specific past meeting it summarizes.
  meetingId?: string;
};

// ponytail: 5-at-a-time cap avoids Gemini 429s on large docs. Upgrade path:
// swap for p-limit if we ever need per-key concurrency across events.
const EMBED_CONCURRENCY = 5;
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}


const summarizer = createAgent({
  name: "summarizer",
  system: `You are an expert summarizer. You write readable, concise, simple content. You are given a transcript of a meeting and you need to summarize it.

Use the following markdown structure for every output:

### Overview
Provide a detailed, engaging summary of the session's content. Focus on major features, user workflows, and any key takeaways. Write in a narrative style, using full sentences. Highlight unique or powerful aspects of the product, platform, or discussion.

### Notes
Break down key content into thematic sections with timestamp ranges. Each section should summarize key points, actions, or demos in bullet format.

Example:
#### Section Name
- Main point or demo shown here
- Another key insight or interaction
- Follow-up tool or explanation provided

#### Next Section
- Feature X automatically does Y
- Mention of integration with Z`
    .trim(),
  model: gemini({
    model: "gemini-1.5-flash",
    apiKey: env.GEMINI_API_KEY,
  }),
})


export const meetingsProcessing = inngest.createFunction(
  { id: "meetings-processing" },
  { event: "meetings/processing" },
  async ({ event, step }) => {
    const { meetingId, transcriptUrl } = parseEvent("meetings/processing", event.data);

    const meeting = await step.run("fetch-meeting", async () => {
      return db.select().from(meetings).where(eq(meetings.id, meetingId)).then(res => res[0]);
    });
    if (!meeting) throw new Error("Meeting not found");

    const response = await step.run("fetch-transcript", async () => {
      return fetch(transcriptUrl).then((res) => res.text());
    });

    const transcript = await step.run("parse-transcript", async () => {
      return JSONL.parse<StreamTranscriptItem>(response);
    });

    const transcriptWithSpeakers = await step.run("add-speakers", async () => {
      const speakerIds = [
        ...new Set(transcript.map((item) => item.speaker_id)),
      ];

      const userSpeakers = await db
        .select()
        .from(user)
        .where(inArray(user.id, speakerIds))
        .then((users) =>
          users.map((user) => ({
            ...user,
          }))
        )

      const agentSpeakers = await db
        .select()
        .from(agents)
        .where(inArray(agents.id, speakerIds))
        .then((agents) =>
          agents.map((agent) => ({
            ...agent,
          }))
        );

      const speakers = [...userSpeakers, ...agentSpeakers];

      return transcript.map((item) => {
        const speaker = speakers.find((speaker) => speaker.id === item.speaker_id);

        if (!speaker) {
          return {
            ...item,
            user: {
              name: "Unknown",
            }
          }
        }
        return {
          ...item,
          user: {
            name: speaker.name,
          }
        };
      });
    });


    const { output } = await summarizer.run(
      "Summarize the following transcript:" +
      JSON.stringify(transcriptWithSpeakers)
    )

    const summaryText = (output[0] as TextMessage).content as string;

    await step.run("save-summary", async () => {
      await db
        .update(meetings)
        .set({
          summary: summaryText,
          status: "completed",
        })
        .where(eq(meetings.id, meetingId));
    });

    // Embed the interview summary the same way quiz answers are embedded
    // (candidateId-scoped, same "agents" Qdrant collection) so both chat and
    // future live interviews can retrieve what happened in this candidate's
    // past sessions, not just their quiz answers and uploaded docs.
    await step.run("embed-interview-summary", async () => {
      await ensureAgentCollection();
      const chunks = chunkText(summaryText);
      const points = await mapWithConcurrency(chunks, EMBED_CONCURRENCY, async (chunk) => {
        const vector = await geminiEmbeddings.embedQuery(chunk.chunk);
        return {
          id: randomUUID(),
          vector,
          payload: {
            agentId: meeting.agentId,
            candidateId: meeting.userId,
            source: "interview",
            meetingId: meeting.id,
            section: chunk.heading,
            text: chunk.chunk,
            chunkIndex: chunk.index,
          } satisfies AgentVectorPayload,
        };
      });
      await qdrant.upsert("agents", { points, wait: true });
    });

  });


// Extracts a TextMessage's content whether it's a plain string or a
// TextContent[] (agent-kit's two possible shapes) into a single string.
function textMessageContent(message: TextMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.map(c => c.text).join("\n");
}

// Best-effort JSON-array parse for LLM output that was asked to return
// strict JSON but might wrap it in prose or a code fence anyway.
function parseJsonArray(raw: string): unknown[] | null {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const quizQuestionGenerator = createAgent({
  name: "quiz-question-generator",
  system: `
You write pre-interview screening quiz questions. Given a job/role description (INSTRUCTIONS) and a list of questions that already exist for this role (EXISTING), produce new, distinct quiz questions that ask the CANDIDATE about their own background, experience, and skills relevant to the role — not trivia about the role itself.

Rules:
- Ask the candidate to describe/explain/reflect on their own experience (e.g. "Describe a time you...", "What experience do you have with...", "How would you approach...").
- Every question must be meaningfully different in substance from every question in EXISTING — do not rephrase an existing question.
- Cover a mix of angles: technical/skills, past experience, problem-solving, behavioral, motivation.
- Output ONLY a JSON array of strings, nothing else. No markdown fence, no commentary, no numbering.
  `.trim(),
  model: gemini({
    model: "gemini-1.5-flash",
    apiKey: env.GEMINI_API_KEY,
  }),
});

const QUESTION_SIMILARITY_THRESHOLD = 0.85;

export const generateQuizQuestionBank = inngest.createFunction(
  { id: "generate-quiz-question-bank" },
  { event: "agents/generate-quiz-questions" },
  async ({ event, step }) => {
    const { agentId, count } = parseEvent("agents/generate-quiz-questions", event.data);

    const agent = await step.run("fetch-agent", async () => {
      return db.select().from(agents).where(eq(agents.id, agentId)).then(res => res[0]);
    });
    if (!agent) throw new Error("Agent not found");

    const existing = await step.run("fetch-existing-bank", async () => {
      return db
        .select({ question: quizQuestions.question })
        .from(quizQuestions)
        .where(and(eq(quizQuestions.agentId, agentId), eq(quizQuestions.isActive, true)));
    });
    const existingTexts = existing.map(q => q.question);

    const generated = await step.run("generate-questions", async () => {
      const { output } = await quizQuestionGenerator.run(
        `INSTRUCTIONS:\n${agent.instructions}\n\n` +
        `EXISTING (${existingTexts.length}):\n${existingTexts.map(q => `- ${q}`).join("\n") || "(none)"}\n\n` +
        `Generate ${count} new questions.`
      );
      const raw = textMessageContent(output[0] as TextMessage);
      const parsed = parseJsonArray(raw);
      if (parsed) {
        return parsed.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
      }
      // Fallback: the same bullet/line splitting the old lastResponse UI used,
      // in case the model ignores the "JSON only" instruction.
      return raw
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("*") || line.startsWith("•") || line.startsWith("-"))
        .map(line => line.replace(/^([*•\-])\s*/, "").replace(/^"|"$/g, ""))
        .filter(Boolean);
    });

    const deduped = await step.run("dedupe-against-existing", async () => {
      const kept: string[] = [];
      for (const candidate of generated) {
        const comparisonPool = [...existingTexts, ...kept];
        const isDuplicate = comparisonPool.some(
          existingQ => stringSimilarity.compareTwoStrings(existingQ, candidate) > QUESTION_SIMILARITY_THRESHOLD
        );
        if (!isDuplicate) kept.push(candidate);
      }
      return kept;
    });

    if (deduped.length === 0) {
      return { success: false, reason: "No new distinct questions generated" };
    }

    await step.run("save-questions", async () => {
      await db.insert(quizQuestions).values(
        deduped.map(question => ({ agentId, question }))
      );
    });

    return { success: true, added: deduped.length };
  }
);

const quizGrader = createAgent({
  name: "quiz-grader",
  system: `
You grade pre-interview screening quiz answers. You are given the role's INSTRUCTIONS and a JSON array of {index, question, answer} pairs. For each pair, rate how well the answer demonstrates relevant experience/skill for the role on a 0-10 scale, and give one short (1-2 sentence) piece of feedback.

Output ONLY a JSON array of {"index": number, "rating": number, "feedback": string}, one entry per input pair, nothing else — no markdown fence, no commentary.
  `.trim(),
  model: gemini({
    model: "gemini-1.5-flash",
    apiKey: env.GEMINI_API_KEY,
  }),
});

// Grades a completed quiz attempt and embeds each Q&A pair into Qdrant,
// scoped to this candidate (candidateId payload field), so the live
// interview's retrieval tool (src/app/api/webhook/route.ts) can pull up
// what the candidate actually said instead of guessing.
export const gradeQuizAttempt = inngest.createFunction(
  { id: "grade-quiz-attempt" },
  { event: "quiz/attempt-completed" },
  async ({ event, step }) => {
    const { quizAttemptId } = parseEvent("quiz/attempt-completed", event.data);

    const attempt = await step.run("fetch-attempt", async () => {
      return db.select().from(quizAttempts).where(eq(quizAttempts.id, quizAttemptId)).then(res => res[0]);
    });
    if (!attempt) throw new Error("Quiz attempt not found");

    const answeredQuestions = await step.run("fetch-answered-questions", async () => {
      return db
        .select()
        .from(quizAttemptQuestions)
        .where(eq(quizAttemptQuestions.quizAttemptId, quizAttemptId))
        .then(rows => rows.filter(r => r.answerText && r.answerText.trim().length > 0));
    });

    const agent = await step.run("fetch-agent", async () => {
      return db.select().from(agents).where(eq(agents.id, attempt.agentId)).then(res => res[0]);
    });
    if (!agent) throw new Error("Agent not found");

    if (answeredQuestions.length === 0) {
      await step.run("mark-completed-no-answers", async () => {
        await db.update(quizAttempts).set({ overallScore: 0 }).where(eq(quizAttempts.id, quizAttemptId));
      });
      return { success: true, graded: 0 };
    }

    type Grade = { index: number; rating: number; feedback: string };
    const grades = await step.run("grade-answers", async () => {
      const pairs = answeredQuestions.map((q, index) => ({ index, question: q.questionText, answer: q.answerText }));
      try {
        const { output } = await quizGrader.run(
          `INSTRUCTIONS:\n${agent.instructions}\n\nPAIRS:\n${JSON.stringify(pairs)}`
        );
        const raw = textMessageContent(output[0] as TextMessage);
        const parsed = parseJsonArray(raw);
        if (!parsed) throw new Error("Grader did not return a JSON array");
        return parsed
          .filter((g): g is Grade =>
            typeof g === "object" && g !== null &&
            typeof (g as Grade).index === "number" &&
            typeof (g as Grade).rating === "number"
          )
          .map(g => ({ ...g, rating: Math.max(0, Math.min(10, Math.round(g.rating))) }));
      } catch (err) {
        console.error(`[quiz-grading-failed] attempt=${quizAttemptId}`, err);
        return pairs.map((p): Grade => ({ index: p.index, rating: 0, feedback: "Grading unavailable." }));
      }
    });

    await step.run("save-grades", async () => {
      await Promise.all(
        grades.map(g => {
          const question = answeredQuestions[g.index];
          if (!question) return Promise.resolve();
          return db
            .update(quizAttemptQuestions)
            .set({ rating: g.rating, feedback: g.feedback })
            .where(eq(quizAttemptQuestions.id, question.id));
        })
      );
      const overallScore = Math.round(
        (grades.reduce((sum, g) => sum + g.rating, 0) / grades.length) * 10
      );
      await db.update(quizAttempts).set({ overallScore }).where(eq(quizAttempts.id, quizAttemptId));
    });

    await step.run("embed-candidate-answers", async () => {
      await ensureAgentCollection();
      const points = await mapWithConcurrency(answeredQuestions, EMBED_CONCURRENCY, async (q) => {
        const text = `Q: ${q.questionText}\nA: ${q.answerText}`;
        const vector = await geminiEmbeddings.embedQuery(text);
        return {
          id: randomUUID(),
          vector,
          payload: {
            agentId: attempt.agentId,
            candidateId: attempt.userId,
            source: "quiz",
            text,
            chunkIndex: 0,
          } satisfies AgentVectorPayload,
        };
      });
      await qdrant.upsert("agents", { points, wait: true });
    });

    return { success: true, graded: grades.length };
  }
);

// Markdown ATX heading, any level (1-6 per CommonMark). Checked per-line
// (not per-paragraph-blob) so a heading immediately followed by body text on
// the next line — no blank line in between, e.g. "#### Section\n- bullet" —
// is still detected. The previous version's non-multiline regex only ever
// matched when a heading was the *entire* isolated paragraph, which missed
// exactly this shape (notably the interview-summarizer's own output).
function matchHeadingLine(line: string): string | null {
  const match = line.trim().match(/^#{1,6}\s+(.+)$/);
  return match ? match[1].trim() : null;
}

function splitIntoSections(text: string): { heading: string; body: string }[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: "Content", lines: [] }];
  for (const line of text.split("\n")) {
    const heading = matchHeadingLine(line);
    if (heading) {
      sections.push({ heading, lines: [] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }
  return sections
    .map(s => ({ heading: s.heading, body: s.lines.join("\n").trim() }))
    .filter(s => s.body.length > 0);
}

// Splits section body into sentence/line-sized units, never wider than
// maxChars. Prefers sentence boundaries; a single unbroken run longer than
// maxChars (rare — e.g. a URL-heavy line) falls back to slicing on the
// nearest word boundary so a word is never cut in half.
function splitIntoUnits(body: string, maxChars: number): string[] {
  const units: string[] = [];
  for (const paragraph of body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)) {
    const pieces = paragraph
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n+/)
      .map(s => s.trim())
      .filter(Boolean);

    for (const piece of pieces) {
      if (piece.length <= maxChars) {
        units.push(piece);
        continue;
      }
      let rest = piece;
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(" ", maxChars);
        if (cut <= 0) cut = maxChars;
        units.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) units.push(rest);
    }
  }
  return units;
}

// Greedily packs units into ~maxChars chunks. Every boundary carries the
// trailing ~overlap chars of units forward into the next chunk — unlike the
// previous version, where overlap only applied to the one oversized-blob
// branch and every ordinary paragraph-boundary chunk got none.
function packUnits(units: string[], maxChars: number, overlap: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const takeOverlapTail = (nextUnit: string): string[] => {
    const carry: string[] = [];
    let carryLength = 0;
    for (let i = current.length - 1; i >= 0 && carryLength < overlap; i--) {
      const unit = current[i];
      // Only fold genuinely small trailing units into the overlap window.
      // A unit that's already large on its own (e.g. a maxChars-sized slice
      // from the word-boundary fallback below) would blow the next chunk's
      // budget the moment a new unit is added on top of it — so for that
      // boundary, start the next chunk fresh instead of forcing overlap.
      if (unit.length > overlap) break;
      carry.unshift(unit);
      carryLength += unit.length + 1;
    }
    // Carrying is only useful if there's still room left for the unit that
    // triggered this flush — otherwise we'd just have to unwind it again
    // immediately, producing a redundant near-duplicate chunk. Skip it.
    if (carryLength + nextUnit.length + 1 > maxChars) return [];
    return carry;
  };

  for (const unit of units) {
    if (current.length > 0 && currentLength + unit.length + 1 > maxChars) {
      chunks.push(current.join(" "));
      current = takeOverlapTail(unit);
      currentLength = current.reduce((sum, u) => sum + u.length + 1, 0);
    }

    current.push(unit);
    currentLength += unit.length + 1;

    // Defensive: a carried-forward unit plus this new unit can still
    // combine to exceed maxChars in one step (belt-and-suspenders on top of
    // the guard above). Catch it immediately rather than letting it compound
    // with whatever unit comes next.
    if (currentLength > maxChars && current.length > 1) {
      const justAdded = current.pop()!;
      chunks.push(current.join(" "));
      current = [justAdded];
      currentLength = justAdded.length + 1;
    }
  }
  if (current.length > 0) chunks.push(current.join(" "));

  return chunks;
}

function chunkText(
  text: string,
  options: { maxChars?: number; overlap?: number; minChars?: number } = {}
): { heading: string; chunk: string; index: number }[] {
  const MAX_CHARS = options.maxChars ?? 1000;
  const OVERLAP = options.overlap ?? 200;
  const MIN_CHARS = options.minChars ?? 150;

  const results: { heading: string; chunk: string; index: number }[] = [];

  for (const section of splitIntoSections(text)) {
    const units = splitIntoUnits(section.body, MAX_CHARS);
    const chunks = packUnits(units, MAX_CHARS, OVERLAP);

    // A tiny trailing chunk is a low-signal embedding on its own — fold it
    // into its predecessor instead (unless it's the section's only chunk).
    if (chunks.length > 1 && chunks[chunks.length - 1].length < MIN_CHARS) {
      const last = chunks.pop()!;
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${last}`;
    }

    for (const chunk of chunks) {
      results.push({ heading: section.heading, chunk, index: results.length });
    }
  }

  return results;
}

function deduplicateChunks<T extends { chunkText?: string; chunk?: string }>(
  chunks: T[]
): T[] {
  const unique: T[] = [];
  chunks.forEach(chunk => {
    const text = chunk.chunkText ?? chunk.chunk ?? "";
    const isDuplicate = unique.some(u => {
      const uText = u.chunkText ?? u.chunk ?? "";
      return stringSimilarity.compareTwoStrings(uText, text) > 0.9;
    });
    if (!isDuplicate) unique.push(chunk);
  });
  return unique;
}

export const generateAndStoreEmbeddings = inngest.createFunction(
  { id: "generate-and-store-embeddings" },
  { event: "agents/generate-embeddings" },
  async ({ event, step }) => {
    const { agentId, pages } = parseEvent("agents/generate-embeddings", event.data);
    if (!pages || pages.length === 0) {
      throw new Error("No pages provided for embeddings generation");
    }

    console.log(`🔹 Generating embeddings for agent: ${agentId}`);
    await ensureAgentCollection();

    // 1️⃣ Fetch agent info
    const agent = await step.run("fetch-agent", async () => {
      const res = await db.select().from(agents).where(eq(agents.id, agentId));
      return res[0];
    });
    if (!agent) throw new Error("Agent not found");

    // 2) Split pages into semantic chunks
    const chunks: {
      url: string;
      section: string;
      chunkText: string;
      chunkIndex: number;
    }[] = [];

    const validPages = pages.filter(p => p.text && p.text.trim().length > 0);

    validPages.forEach(page => {
      const pageChunks = chunkText(page.text);
      pageChunks.forEach(c => {
        chunks.push({
          url: page.url,
          section: c.heading,
          chunkText: c.chunk,
          chunkIndex: c.index,
        });
      });
    });

    console.log(`Total chunks extracted: ${chunks.length}`);

    // 3) Deduplicate chunks
    const uniqueChunks = deduplicateChunks(chunks);
    console.log(`Unique chunks after deduplication: ${uniqueChunks.length}`);

    // 4️⃣ Generate embeddings
    const vectors = await step.run("generate-embeddings", async () => {
      return mapWithConcurrency(uniqueChunks, EMBED_CONCURRENCY, async (chunk) => {
        const vector = await geminiEmbeddings.embedQuery(chunk.chunkText);

        if (vector.length !== VECTOR_SIZE) {
          throw new Error(
            `Vector dimension mismatch! Expected ${VECTOR_SIZE}, got ${vector.length}`
          );
        }

        return {
          id: randomUUID(),
          vector,
          payload: {
            agentId,
            url: chunk.url,
            section: chunk.section,
            text: chunk.chunkText,
            chunkIndex: chunk.chunkIndex,
          },
        };
      });
    });

    console.log(`📊 Generated ${vectors.length} embeddings`);

    // 5️⃣ Store embeddings in Qdrant
    const result = await step.run("store-embeddings", async () => {
      const points = vectors.map(v => ({
        id: v.id,
        vector: v.vector,
        payload: v.payload
      }));

      console.log(`📦 Upserting ${points.length} points to Qdrant`);
      const upsertResult = await qdrant.upsert("agents", { points, wait: true });
      console.log(`✅ Successfully stored embeddings for agent ${agentId}`, upsertResult);

      return { success: true, pointsStored: points.length };
    });

    return { success: true, pointsStored: result.pointsStored, agentId };
  }
);


export const instructionOnlyAgent = createAgent({
  name: "instruction-only-agent",
  system: `
You are an assistant whose knowledge comes from INSTRUCTIONS and CONTEXT blocks provided below.
CONTEXT contains relevant excerpts retrieved from the agent's knowledge base (documents, web pages).
You MUST answer user questions using solely the information inside INSTRUCTIONS and CONTEXT.
Do NOT access external knowledge, do not guess, do not hallucinate.
If a question cannot be answered using the provided information, reply only with:
"I don't know based on the given information."

Strict output rules:
- Answer concisely and directly.
- If the answer exists in the INSTRUCTIONS or CONTEXT, provide it.
- When citing from CONTEXT, mention the source if available.
- If neither contains the answer, use exactly: "I don't know based on the given information."
- Do not include extra commentary, meta explanation, or questions back to the user.
`.trim(),
  model: gemini({
    model: "gemini-1.5-flash",
    apiKey: env.GEMINI_API_KEY,
  }),
});

export const agentChatHandler = inngest.createFunction(
  { id: "agent-chat-handler-instruction-only" },
  { event: "agent/message" },
  async ({ event, step }) => {
    const { agentId, conversationId, userId, content } = parseEvent("agent/message", event.data);
    console.log("agentChatHandler fired for agent:", agentId);

    // 1) Fetch agent record
    const agent = await step.run("fetch-agent", async () => {
      await ensureAgentCollection();
      const res = await db.select().from(agents).where(eq(agents.id, agentId));
      return res[0];
    });

    if (!agent) throw new Error("Agent not found");

    const instructionsText = agent.instructions ?? "";

    // 2) RAG retrieval: embed user question and search Qdrant
    const retrieval = await step.run("rag-retrieval", async () => {
      try {
        const queryVector = await geminiEmbeddings.embedQuery(content);

        // Fetch a wider window than we'll actually use, so [rag-scores] logs
        // show what got filtered out — needed to tune SCORE_THRESHOLD (C3).
        // Keep the effective behavior identical: filter in TS at 0.5.
        const rawResults = await qdrant.search("agents", {
          vector: queryVector,
          limit: 10,
          filter: {
            must: [
              { key: "agentId", match: { value: agentId } },
            ],
          },
        });

        const SCORE_THRESHOLD = 0.5;
        // Below the main threshold there's still a "probably relevant, just
        // not a confident match" band. A hard cutoff at 0.5 was answering
        // "I don't know" even when the single best hit was a near-miss (e.g.
        // 0.46) instead of actually irrelevant — fall back to the top match
        // alone if it clears this lower floor, rather than dropping context
        // entirely.
        const FALLBACK_FLOOR = 0.35;
        let searchResults = rawResults
          .filter((r) => (r.score ?? 0) >= SCORE_THRESHOLD)
          .slice(0, 5);
        let usedFallback = false;

        if (searchResults.length === 0 && (rawResults[0]?.score ?? 0) >= FALLBACK_FLOOR) {
          searchResults = rawResults.slice(0, 1);
          usedFallback = true;
        }

        // One structured line per chat request. Grep `[rag-scores]` in prod
        // logs to build a score-distribution histogram before tuning.
        console.log(
          `[rag-scores] agent=${agentId} threshold=${SCORE_THRESHOLD} ` +
            `raw=${JSON.stringify(rawResults.map((r) => Number((r.score ?? 0).toFixed(3))))} ` +
            `kept=${searchResults.length} fallback=${usedFallback}`
        );

        if (searchResults.length === 0) return { context: "", sources: [], error: null };

        const sources = searchResults.map((r) => {
          const payload = r.payload as Partial<AgentVectorPayload>;
          return {
            fileName: payload.fileName,
            url: payload.url,
            section: payload.section,
            // "quiz" / "interview" for candidate-derived chunks (see
            // gradeQuizAttempt / meetingsProcessing); a document's fileName
            // for uploads. Lets the chat UI label sources meaningfully
            // instead of falling back to a generic "knowledge base".
            source: payload.source,
            score: r.score,
          };
        });

        const contextParts = searchResults.map((result, i) => {
          const payload = result.payload as Partial<AgentVectorPayload>;
          const source = payload.url || payload.fileName || payload.source || "knowledge base";
          return `[Source ${i + 1}: ${source}${payload.section ? ` - ${payload.section}` : ""}]\n${payload.text ?? ""}`;
        });

        return { context: contextParts.join("\n\n---\n\n"), sources, error: null };
      } catch (error) {
        // Fallback keeps the reply flowing, but surface the failure on the
        // message's metadata so the UI can distinguish "no relevant sources"
        // from "retrieval broke". Was N1 in cycle 4.
        console.error("[chat-rag-fallback] retrieval failed for agent", agentId, error);
        return {
          context: "",
          sources: [],
          error: error instanceof Error ? error.message : "retrieval failed",
        };
      }
    });

    const ragContext = retrieval.context;
    const retrievalSources = retrieval.sources;
    const retrievalError = retrieval.error;

    // 3) Build prompt with RAG context
    const prompt = `
You are an assistant whose knowledge comes from the provided INSTRUCTIONS and CONTEXT.
Use the CONTEXT (retrieved from the knowledge base) to answer the user's question when relevant.
If the answer is found in either INSTRUCTIONS or CONTEXT, provide it.
If neither contains the answer, respond exactly with:
"I don't know based on the given information."

INSTRUCTIONS:
${instructionsText}

${ragContext ? `CONTEXT (from knowledge base):\n${ragContext}` : ""}

USER QUESTION:
${content}
`.trim();

    // DO NOT wrap this in step.run to avoid nested steps. An uncaught error
    // here used to fail the whole function with no reply row ever written —
    // the chat UI polls for a reply and would spin on the typing indicator
    // forever. Catch it and persist a visible fallback instead.
    let reply: string;
    let llmError: string | null = null;
    try {
      const { output } = await instructionOnlyAgent.run(prompt);
      reply = (output[0] as TextMessage).content as string;
    } catch (error) {
      console.error("[chat-llm-failed] agent=", agentId, error);
      llmError = error instanceof Error ? error.message : "LLM call failed";
      reply = "Sorry, I couldn't generate a reply just now. Please try again.";
    }

    // 4) Save reply. metadata carries retrieval sources for the chat UI
    // and any future debug panels; retrievalError/llmError surface silent-
    // failure regressions. Non-agent readers can ignore it.
    await step.run("save-agent-reply", async () => {
      const meta: { sources?: unknown[]; retrievalError?: string; llmError?: string } = {};
      if (retrievalSources.length > 0) meta.sources = retrievalSources;
      if (retrievalError) meta.retrievalError = retrievalError;
      if (llmError) meta.llmError = llmError;

      await db.insert(messages).values({
        conversationId,
        userId,
        sender: "agent",
        content: reply,
        metadata: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
      });
    });

    return { success: !llmError, reply };
  }
);

export const processDocumentEmbeddings = inngest.createFunction(
  { id: "process-document-embeddings" },
  { event: "documents/process" },
  async ({ event, step }) => {
    const { documentId, agentId, fileUrl, fileName, mimeType } = parseEvent("documents/process", event.data);

    console.log(`Processing document: ${fileName} for agent: ${agentId}`);
    await ensureAgentCollection();

    // 1) Update status to processing
    await step.run("mark-processing", async () => {
      await db
        .update(documents)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(documents.id, documentId));
    });

    // 2) Download and parse the document in a single step
    //    (Buffer cannot be serialized across Inngest steps)
    const parsedText = await step.run("download-and-parse", async () => {
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      const { parseDocument } = await import("@/utils/document-parser");
      const parsed = await parseDocument(fileBuffer, fileName, mimeType);
      return parsed.text;
    });

    if (!parsedText || parsedText.trim().length === 0) {
      await step.run("mark-failed", async () => {
        await db
          .update(documents)
          .set({ status: "failed", error: "No text content extracted", updatedAt: new Date() })
          .where(eq(documents.id, documentId));
      });
      return { success: false, reason: "No text extracted" };
    }

    // 4) Chunk the text
    const chunks = chunkText(parsedText);
    console.log(`Extracted ${chunks.length} chunks from ${fileName}`);

    // Steps 5-7 can fail for reasons unrelated to "no text extracted"
    // (Gemini error, vector dimension mismatch, Qdrant unreachable). Without
    // this catch, the document was left stuck at status "processing"
    // forever once Inngest's retries were exhausted, with no error surfaced.
    try {
      // 5) Generate embeddings
      const vectors = await step.run("generate-embeddings", async () => {
        return mapWithConcurrency(chunks, EMBED_CONCURRENCY, async (chunk) => {
          const vector = await geminiEmbeddings.embedQuery(chunk.chunk);

          if (vector.length !== VECTOR_SIZE) {
            throw new Error(
              `Vector dimension mismatch! Expected ${VECTOR_SIZE}, got ${vector.length}`
            );
          }

          return {
            id: randomUUID(),
            vector,
            payload: {
              agentId,
              documentId,
              fileName,
              source: fileName,
              section: chunk.heading,
              text: chunk.chunk,
              chunkIndex: chunk.index,
            },
          };
        });
      });

      // 6) Store in Qdrant
      await step.run("store-embeddings", async () => {
        await qdrant.upsert("agents", {
          points: vectors.map(v => ({
            id: v.id,
            vector: v.vector,
            payload: v.payload,
          })),
          wait: true,
        });
      });

      // 7) Update document status
      await step.run("mark-completed", async () => {
        await db
          .update(documents)
          .set({
            status: "completed",
            chunkCount: vectors.length,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, documentId));
      });

      console.log(`Successfully processed ${fileName}: ${vectors.length} chunks stored`);
      return { success: true, chunksProcessed: vectors.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error during embedding";
      console.error(`[document-process-failed] document=${documentId} agent=${agentId}: ${message}`);
      await step.run("mark-failed", async () => {
        await db
          .update(documents)
          .set({ status: "failed", error: message, updatedAt: new Date() })
          .where(eq(documents.id, documentId));
      });
      return { success: false, reason: message };
    }
  }
);


// Crawl an agent's URL list off the request path (was A10: sync-in-mutation).
// Idempotent — clears prior URL-sourced vectors for this agent, then re-embeds
// via the existing generateAndStoreEmbeddings function.
export const crawlAgentUrls = inngest.createFunction(
  { id: "agents-crawl-urls" },
  { event: "agents/crawl-urls" },
  async ({ event, step }) => {
    const { agentId, urls } = parseEvent("agents/crawl-urls", event.data);
    if (!urls || urls.length === 0) {
      return { success: false, reason: "No URLs provided" };
    }

    await ensureAgentCollection();

    await step.run("mark-processing", async () => {
      await db
        .update(agents)
        .set({ urlsStatus: "processing", urlsError: null, updatedAt: new Date() })
        .where(eq(agents.id, agentId));
    });

    // Delete prior URL-sourced vectors for this agent.
    // Discriminator: URL points have `url`, no `documentId`. Document points
    // have `documentId`. So `must agentId=X + must_not documentId exists`.
    await step.run("clear-url-vectors", async () => {
      try {
        const filter = {
          must: [{ key: "agentId", match: { value: agentId } }],
          must_not: [{ is_empty: { key: "documentId" } }],
        };
        // Qdrant delete supports a filter form; the SDK's overload types are
        // ambiguous here so we cast the whole options bag.
        await qdrant.delete("agents", { filter, wait: true } as never);
      } catch (err) {
        // ponytail: best-effort cleanup — if Qdrant rejects the filter we
        // still proceed to re-crawl, and the worst case is duplicate points.
        console.error(`Qdrant URL-vector cleanup failed for agent ${agentId}:`, err);
      }
    });

    // Crawl. Playwright navigation stays sequential (one browser instance),
    // but per-page Gemini cleanup now runs with bounded concurrency instead
    // of one call at a time, and a wall-clock budget keeps a slow/hung site
    // from blowing out the whole step's execution time.
    const { allPages, failedUrls } = await step.run("crawl", async () => {
      const { chromium } = await import("playwright");
      const { crawlAndCleanUrls } = await import("@/utils/web-crawler");
      const browser = await chromium.launch({ headless: true });
      try {
        const { pages, failedUrls } = await crawlAndCleanUrls(urls, browser, {
          maxDepth: 3,
          maxPagesPerUrl: 10,
          timeBudgetMs: 3 * 60 * 1000,
        });
        return { allPages: pages, failedUrls };
      } finally {
        await browser.close().catch(() => {});
      }
    });

    if (allPages.length === 0) {
      await step.run("mark-failed", async () => {
        await db
          .update(agents)
          .set({
            urlsStatus: "failed",
            urlsError: failedUrls.length > 0
              ? `No content extracted. Failed URLs: ${failedUrls.join(", ")}`
              : "No content extracted from provided URLs",
            urlsUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(agents.id, agentId));
      });
      return { success: false, reason: "No content extracted" };
    }

    // Reuse the existing embed pipeline verbatim.
    await step.sendEvent("dispatch-embeddings", {
      name: "agents/generate-embeddings",
      data: { agentId, pages: allPages, url: urls[0] },
    });

    // Partial failures don't block completion (some pages/URLs still made it
    // in), but they're surfaced via urlsError so the gap is visible instead
    // of silently missing content.
    await step.run("mark-completed", async () => {
      await db
        .update(agents)
        .set({
          urlsStatus: "completed",
          urlsError: failedUrls.length > 0
            ? `${failedUrls.length} page(s) failed to crawl and were skipped: ${failedUrls.join(", ")}`
            : null,
          urlsUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agentId));
    });

    return { success: true, pagesCrawled: allPages.length, failedUrls: failedUrls.length };
  }
);

// First cron-triggered function in the app. Cancels 'open' discussion rooms
// that are old and have had no chat activity in ROOM_STALE_AFTER_MS, keeping
// the lobby from filling up with abandoned rooms nobody ever scheduled.
export const cancelStaleRooms = inngest.createFunction(
  { id: "rooms-cancel-stale" },
  { cron: "0 * * * *" }, // hourly
  async ({ step }) => {
    const staleBefore = new Date(Date.now() - ROOM_STALE_AFTER_MS);

    const cancelledRooms = await step.run("cancel-stale-open-rooms", async () => {
      return db
        .update(rooms)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(rooms.status, "open"),
            lt(rooms.createdAt, staleBefore),
            notExists(
              db
                .select({ id: roomMessages.id })
                .from(roomMessages)
                .where(
                  and(eq(roomMessages.roomId, rooms.id), gte(roomMessages.createdAt, staleBefore))
                )
            )
          )
        )
        .returning({ id: rooms.id });
    });

    console.log(`[rooms-cancel-stale] cancelled ${cancelledRooms.length} stale room(s)`);
    return { cancelledCount: cancelledRooms.length };
  }
);
