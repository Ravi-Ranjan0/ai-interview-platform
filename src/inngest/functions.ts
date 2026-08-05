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
import { ensureAgentCollection } from "@/lib/qdrant";
import { indexChunksForSource, removeSource, listIndexedSourceIds } from "@/lib/knowledge-index";
import { hybridSearch } from "@/lib/hybrid-search";
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
    await step.run("index-interview-summary", async () => {
      const chunks = chunkText(summaryText);
      await indexChunksForSource({
        agentId: meeting.agentId,
        sourceType: "interview",
        sourceId: meeting.id,
        candidateId: meeting.userId,
        label: "interview",
        payloadExtra: { meetingId: meeting.id },
        chunks: chunks.map(c => ({ heading: c.heading, text: c.chunk, chunkIndex: c.index })),
      });
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

    await step.run("index-candidate-answers", async () => {
      await indexChunksForSource({
        agentId: attempt.agentId,
        sourceType: "quiz",
        sourceId: attempt.id,
        candidateId: attempt.userId,
        label: "quiz",
        chunks: answeredQuestions.map((q, i) => ({
          text: `Q: ${q.questionText}\nA: ${q.answerText}`,
          chunkIndex: i,
        })),
      });
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

// ``` or ~~~ fence marker (optionally followed by a language tag on the
// opening line). Tracked as on/off toggle — good enough for well-formed
// fenced blocks without needing to match fence character/length exactly.
function isFenceLine(line: string): boolean {
  return /^(`{3,}|~{3,})/.test(line.trim());
}

function splitIntoSections(text: string): { heading: string; body: string }[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: "Content", lines: [] }];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      sections[sections.length - 1].lines.push(line);
      continue;
    }
    // A `#`-prefixed line inside a fenced code block (e.g. a Python/shell
    // comment) is not a markdown heading — skip heading detection entirely
    // while inside a fence, otherwise it would incorrectly split a code
    // block across "sections".
    if (inFence) {
      sections[sections.length - 1].lines.push(line);
      continue;
    }
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

type ContentSegment = { type: "code" | "prose"; content: string };

// Splits a section's body into alternating code/prose runs so each gets the
// chunking strategy suited to it — a fenced code block needs to stay intact
// (or split between statements/functions), while narrative prose is fine
// split at sentence boundaries.
function splitIntoSegments(body: string): ContentSegment[] {
  const lines = body.split("\n");
  const segments: ContentSegment[] = [];
  let prose: string[] = [];
  let i = 0;

  const flushProse = () => {
    if (prose.length > 0) {
      segments.push({ type: "prose", content: prose.join("\n") });
      prose = [];
    }
  };

  while (i < lines.length) {
    if (isFenceLine(lines[i])) {
      const code: string[] = [lines[i]];
      i++;
      while (i < lines.length && !isFenceLine(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        code.push(lines[i]); // closing fence
        i++;
      }
      flushProse();
      segments.push({ type: "code", content: code.join("\n") });
      continue;
    }
    prose.push(lines[i]);
    i++;
  }
  flushProse();
  return segments;
}

// Splits an oversized code block on blank lines — the closest cheap proxy
// for "between functions/top-level statements" without a real parser per
// language. Only when a single statement group has no internal blank line
// (one very long function) does it fall back to slicing on whole *lines*,
// which — unlike the prose path's word-boundary slice — never cuts a line
// (and so never a token/identifier) in half.
function splitCodeIntoUnits(code: string, maxChars: number): string[] {
  if (code.length <= maxChars) return [code];

  const units: string[] = [];
  for (const group of code.split(/\n{2,}/).filter(Boolean)) {
    if (group.length <= maxChars) {
      units.push(group);
      continue;
    }
    const lines = group.split("\n");
    let buffer: string[] = [];
    let bufferLength = 0;
    for (const line of lines) {
      if (bufferLength + line.length + 1 > maxChars && buffer.length > 0) {
        units.push(buffer.join("\n"));
        buffer = [];
        bufferLength = 0;
      }
      buffer.push(line);
      bufferLength += line.length + 1;
    }
    if (buffer.length > 0) units.push(buffer.join("\n"));
  }
  return units;
}

// Splits prose into sentence/line-sized units, never wider than maxChars.
// Prefers sentence boundaries; a single unbroken run longer than maxChars
// (rare — e.g. a URL-heavy line) falls back to slicing on the nearest word
// boundary so a word is never cut in half.
function splitProseIntoUnits(prose: string, maxChars: number): string[] {
  const units: string[] = [];
  for (const paragraph of prose.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)) {
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

function splitIntoUnits(body: string, maxChars: number): string[] {
  const units: string[] = [];
  for (const segment of splitIntoSegments(body)) {
    if (segment.type === "code") {
      units.push(...splitCodeIntoUnits(segment.content, maxChars));
    } else {
      units.push(...splitProseIntoUnits(segment.content, maxChars));
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

    // 3) Deduplicate chunks (near-identical boilerplate across pages, e.g.
    // shared nav/footer text — a different problem from indexChunksForSource's
    // exact-hash diffing below, which compares a single page's chunks against
    // what was already indexed for that same page in a previous run).
    const uniqueChunks = deduplicateChunks(chunks);
    console.log(`Unique chunks after deduplication: ${uniqueChunks.length}`);

    // 4) Index per page — each page is its own source, so re-crawling later
    // only re-embeds pages whose content actually changed.
    const result = await step.run("index-chunks", async () => {
      const byUrl = new Map<string, typeof uniqueChunks>();
      for (const chunk of uniqueChunks) {
        const group = byUrl.get(chunk.url) ?? [];
        group.push(chunk);
        byUrl.set(chunk.url, group);
      }

      let indexed = 0, cached = 0, skippedUnchanged = 0, removed = 0;
      for (const [url, group] of byUrl) {
        const stats = await indexChunksForSource({
          agentId,
          sourceType: "url",
          sourceId: url,
          label: url,
          payloadExtra: { url },
          chunks: group.map(c => ({ heading: c.section, text: c.chunkText, chunkIndex: c.chunkIndex })),
        });
        indexed += stats.indexed;
        cached += stats.cached;
        skippedUnchanged += stats.skippedUnchanged;
        removed += stats.removed;
      }

      console.log(
        `[index-chunks] agent=${agentId} indexed=${indexed} cached=${cached} ` +
          `skippedUnchanged=${skippedUnchanged} removed=${removed}`
      );
      return { indexed, cached, skippedUnchanged, removed };
    });

    return { success: true, pointsStored: result.indexed, agentId };
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

    // 2) RAG retrieval: hybrid dense+lexical search (see src/lib/hybrid-search.ts)
    const retrieval = await step.run("rag-retrieval", async () => {
      try {
        const hits = await hybridSearch({ agentId, candidateId: userId, query: content, limit: 10 });

        const DENSE_SCORE_THRESHOLD = 0.5;
        // Below the main threshold there's still a "probably relevant, just
        // not a confident match" band. A hard cutoff at 0.5 was answering
        // "I don't know" even when the single best hit was a near-miss (e.g.
        // 0.46) instead of actually irrelevant — fall back to the top match
        // alone if it clears this lower floor, rather than dropping context
        // entirely. An exact lexical match qualifies on its own regardless of
        // cosine score — that's the whole point of the lexical leg.
        const DENSE_FALLBACK_FLOOR = 0.35;
        let searchResults = hits
          .filter((h) => h.matchedLexical || (h.denseScore ?? 0) >= DENSE_SCORE_THRESHOLD)
          .slice(0, 5);
        let usedFallback = false;

        if (searchResults.length === 0 && (hits[0]?.denseScore ?? 0) >= DENSE_FALLBACK_FLOOR) {
          searchResults = hits.slice(0, 1);
          usedFallback = true;
        }

        // One structured line per chat request. Grep `[rag-scores]` in prod
        // logs to build a score-distribution histogram before tuning.
        console.log(
          `[rag-scores] agent=${agentId} threshold=${DENSE_SCORE_THRESHOLD} ` +
            `dense=${JSON.stringify(hits.map((h) => Number((h.denseScore ?? 0).toFixed(3))))} ` +
            `lexical=${JSON.stringify(hits.map((h) => h.matchedLexical))} ` +
            `kept=${searchResults.length} fallback=${usedFallback}`
        );

        if (searchResults.length === 0) return { context: "", sources: [], error: null };

        const sources = searchResults.map((h) => ({
          // "quiz" / "interview" for candidate-derived chunks (see
          // gradeQuizAttempt / meetingsProcessing); a document's fileName
          // for uploads. Lets the chat UI label sources meaningfully
          // instead of falling back to a generic "knowledge base".
          source: h.label,
          section: h.heading,
          score: h.denseScore,
          matchedLexical: h.matchedLexical,
        }));

        const contextParts = searchResults.map((h, i) => {
          const source = h.label || "knowledge base";
          return `[Source ${i + 1}: ${source}${h.heading ? ` - ${h.heading}` : ""}]\n${h.text}`;
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
      // 5-6) Index chunks — diffs against whatever was already indexed for
      // this documentId, so reprocessing the same document only re-embeds
      // chunks that actually changed.
      const stats = await step.run("index-chunks", async () => {
        return indexChunksForSource({
          agentId,
          sourceType: "document",
          sourceId: documentId,
          label: fileName,
          payloadExtra: { documentId, fileName },
          chunks: chunks.map(c => ({ heading: c.heading, text: c.chunk, chunkIndex: c.index })),
        });
      });

      // 7) Update document status
      await step.run("mark-completed", async () => {
        await db
          .update(documents)
          .set({
            status: "completed",
            chunkCount: stats.indexed + stats.skippedUnchanged,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, documentId));
      });

      console.log(
        `Successfully processed ${fileName}: indexed=${stats.indexed} cached=${stats.cached} ` +
          `skippedUnchanged=${stats.skippedUnchanged} removed=${stats.removed}`
      );
      return { success: true, chunksProcessed: stats.indexed };
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
// Incremental — prunes URLs no longer present, then re-embeds via
// generateAndStoreEmbeddings, which itself only re-indexes chunks that
// actually changed within each surviving page (see indexChunksForSource).
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

    // Prune URLs that dropped out of the crawl entirely (e.g. removed from
    // the agent's URL list, or now 404ing). Content that changed *within* a
    // surviving URL is diffed separately, per-page, inside
    // generateAndStoreEmbeddings via indexChunksForSource — this step only
    // handles URLs no longer present at all.
    await step.run("prune-removed-urls", async () => {
      const currentUrls = new Set(allPages.map(p => p.url));
      const previouslyIndexedUrls = await listIndexedSourceIds(agentId, "url");
      const removedUrls = previouslyIndexedUrls.filter(u => !currentUrls.has(u));
      for (const url of removedUrls) {
        await removeSource("url", url);
      }
      if (removedUrls.length > 0) {
        console.log(`[prune-removed-urls] agent=${agentId} removed=${removedUrls.length}`);
      }
    });

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
