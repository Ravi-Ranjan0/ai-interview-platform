import { StreamTranscriptItem } from "@/modules/meetings/type";
import { inngest } from "./client";
import JSONL from "jsonl-parse-stringify";
import { db } from "@/db";
import { agents, meetings, messages, user, documents } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createAgent, gemini, TextMessage, } from "@inngest/agent-kit";
import { qdrant, ensureAgentCollection } from "@/lib/qdrant";
import { geminiEmbeddings, VECTOR_SIZE } from "@/lib/embedding";
import { randomUUID } from "crypto";
import stringSimilarity from "string-similarity";

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
    apiKey: process.env.GEMINI_API_KEY
  }),
})


export const meetingsProcessing = inngest.createFunction(
  { id: "meetings-processing" },
  { event: "meetings/processing" },
  async ({ event, step }) => {
    // Process the meeting event
    // const response = await step.fetch(event.data.transcriptUrl);
    const response = await step.run("fetch-transcript", async () => {
      return fetch(event.data.transcriptUrl).then((res) => res.text());
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

    await step.run("save-summary", async () => {
      await db
        .update(meetings)
        .set({
          summary: (output[0] as TextMessage).content as string,
          status: "completed",
        })
        .where(eq(meetings.id, event.data.meetingId));
    });

  });


const questionGenerator = createAgent({
  name: "question-generator",
  system: `
  Act like a professional prompt-based question generator. You specialize in crafting thoughtful, relevant, and well-structured questions in response to user-provided instructions across any domain. Your only responsibility is to produce a clean list of questions that probe deeply into the subject matter the user has specified.

You must:
- Generate only questions—do not include categories, titles, summaries, or explanations.
- Ensure each question is precise, context-aware, and aligned with the user’s intent.
- Write in a clear and professional tone, avoiding repetition, ambiguity, or overly simplistic phrasing.
- Encourage reflection, critical thinking, or detailed responses, depending on the topic.
- Cover different angles and cognitive levels (e.g. factual, analytical, evaluative, situational, or hypothetical).
- Format your output strictly as a list of bullet-pointed questions without numbering, headings, or meta commentary.
- Adapt to any type of instruction, whether it relates to science, education, psychology, business, strategy, design, writing, ethics, or others.

Do not answer the questions. Do not explain your choices. Do not group or organize by theme. Simply generate a flat list of refined, standalone questions based solely on the user's instructions.

Take a deep breath and work on this problem step-by-step.

  `,
  model: gemini({
    model: "gemini-1.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  }),
});

export const generateAgentQuestions = inngest.createFunction(
  { id: "generate-agent-questions" },
  { event: "agents/questions" }, // ✅ Event name expects only agentId
  async ({ event, step }) => {
    const { agentId } = event.data;
    console.log("🚀 Inngest function fired with agentId:", agentId);

    // Step 1: Fetch agent by ID
    const agent = await step.run("fetch-agent", async () => {
      return db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .then(res => res[0]);
    });

    if (!agent) {
      throw new Error("Agent not found");
    }

    // Step 2: Generate questions using instructions
    const { output } = await questionGenerator.run(
      `Based on the following user instructions, generate a list of thoughtful questions:\n\n${agent.instructions}`
    );
    console.log("Generated questions:", output);

    // const generatedQuestions = (output[0] as TextMessage).content;

    const rawOutput = output[0] as TextMessage;

    const generatedQuestions =
      typeof rawOutput.content === "string"
        ? rawOutput.content
        : rawOutput.content.map(c => c.text).join("\n"); // For TextContent[]


    // Step 3: Save questions to agent's lastResponse
    await step.run("save-response", async () => {
      await db
        .update(agents)
        .set({
          lastResponse: generatedQuestions,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agentId));
    });

    return { questions: generatedQuestions };
  }
);



function chunkText(
  text: string,
  options: { maxChars?: number; overlap?: number } = {}
) {
  const MAX_CHARS = options.maxChars ?? 1000;
  const OVERLAP = options.overlap ?? 200;
  const results: { heading: string; chunk: string; index: number }[] = [];

  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  let currentHeading = "Content";
  let buffer: string[] = [];
  let bufferLength = 0;

  function flushBuffer(heading: string) {
    if (buffer.length === 0) return;
    const fullText = buffer.join("\n\n");

    if (fullText.length <= MAX_CHARS) {
      results.push({ heading, chunk: fullText, index: results.length });
    } else {
      let start = 0;
      while (start < fullText.length) {
        const end = Math.min(start + MAX_CHARS, fullText.length);
        results.push({
          heading,
          chunk: fullText.slice(start, end),
          index: results.length,
        });
        start += MAX_CHARS - OVERLAP;
      }
    }
    buffer = [];
    bufferLength = 0;
  }

  for (const para of paragraphs) {
    const headingMatch = para.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      flushBuffer(currentHeading);
      currentHeading = headingMatch[1].trim();
      continue;
    }

    if (bufferLength + para.length > MAX_CHARS && buffer.length > 0) {
      flushBuffer(currentHeading);
    }

    buffer.push(para);
    bufferLength += para.length;
  }

  flushBuffer(currentHeading);
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
    const { agentId, pages } = event.data as { agentId: string; pages: { url: string; text: string }[] };
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
    apiKey: process.env.GEMINI_API_KEY,
  }),
});

export const agentChatHandler = inngest.createFunction(
  { id: "agent-chat-handler-instruction-only" },
  { event: "agent/message" },
  async ({ event, step }) => {
    const { agentId, conversationId, userId, content } = event.data;
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

        const searchResults = await qdrant.search("agents", {
          vector: queryVector,
          limit: 5,
          filter: {
            must: [
              { key: "agentId", match: { value: agentId } },
            ],
          },
          score_threshold: 0.5,
        });

        if (searchResults.length === 0) return { context: "", sources: [] };

        const sources = searchResults.map((r) => {
          const payload = r.payload as {
            text?: string;
            url?: string;
            section?: string;
            fileName?: string;
          };
          return {
            fileName: payload.fileName,
            url: payload.url,
            section: payload.section,
            score: r.score,
          };
        });

        const contextParts = searchResults.map((result, i) => {
          const payload = result.payload as {
            text: string;
            url?: string;
            section?: string;
            fileName?: string;
          };
          const source = payload.url || payload.fileName || "knowledge base";
          return `[Source ${i + 1}: ${source}${payload.section ? ` - ${payload.section}` : ""}]\n${payload.text}`;
        });

        return { context: contextParts.join("\n\n---\n\n"), sources };
      } catch (error) {
        console.error("RAG retrieval failed, falling back to instructions only:", error);
        return { context: "", sources: [] };
      }
    });

    const ragContext = retrieval.context;
    const retrievalSources = retrieval.sources;

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

    // DO NOT wrap this in step.run to avoid nested steps
    const { output } = await instructionOnlyAgent.run(prompt);
    const reply = (output[0] as TextMessage).content as string;

    // 4) Save reply. metadata carries retrieval sources for the Test Agent UI
    // and any future debug panels. Non-agent readers can ignore it.
    await step.run("save-agent-reply", async () => {
      await db.insert(messages).values({
        conversationId,
        userId,
        sender: "agent",
        content: reply,
        metadata: retrievalSources.length > 0
          ? JSON.stringify({ sources: retrievalSources })
          : null,
      });
    });

    return { success: true, reply };
  }
);

export const processDocumentEmbeddings = inngest.createFunction(
  { id: "process-document-embeddings" },
  { event: "documents/process" },
  async ({ event, step }) => {
    const { documentId, agentId, fileUrl, fileName, mimeType } = event.data;

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
  }
);

