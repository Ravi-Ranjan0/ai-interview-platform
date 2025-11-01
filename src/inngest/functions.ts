import { StreamTranscriptItem } from "@/modules/meetings/type";
import { inngest } from "./client";
import JSONL from "jsonl-parse-stringify";
import { db } from "@/db";
import { agents, meetings, user } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createAgent, openai, gemini, TextMessage, } from "@inngest/agent-kit";
import { qdrant } from "@/lib/qdrant";
import { GeminiAI } from "@/lib/gemini-client";
import { geminiEmbeddings } from "@/lib/embedding";
import { randomUUID } from "crypto";


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
    model: "gemini-1.5-flash-8b",
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
    model: "gemini-1.5-flash-8b",
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

// export const generateAndStoreEmbeddings = inngest.createFunction(
//   { id: "generate-and-store-embeddings" },
//   { event: "agents/generate-embeddings" },
//   async ({ event, step }) => {
//     const { agentId, texts } = event.data;
//     console.log("🔹 Generating embeddings for agent:", agentId);

//     // 1️⃣ Fetch agent info
//     const agent = await step.run("fetch-agent", async () => {
//       const res = await db.select().from(agents).where(eq(agents.id, agentId));
//       return res[0];
//     });

//     if (!agent) throw new Error("Agent not found");

//     // 2️⃣ Generate embeddings using Gemini
//     const embeddings = await step.run("generate-embeddings", async () => {
//       const model = GeminiAI.getGenerativeModel({
//         model: "text-embedding-004", // ✅ Gemini’s embedding model
//       });

//       interface EmbeddingResult {
//         embedding: { values: number[] };
//       }

//       interface EmbeddingVector {
//         id: string;
//         vector: number[];
//         payload: {
//           agentId: string;
//           text: string;
//         };
//       }

//       const textsArray = texts as string[];
//       const vectors: EmbeddingVector[] = await Promise.all(
//         textsArray.map(async (text: string, idx: number) => {
//           const result = (await model.embedContent(text)) as EmbeddingResult;
//           return {
//         id: `${agentId}-${idx}`,
//         vector: result.embedding.values,
//         payload: { agentId, text },
//           };
//         })
//       );

//       return vectors;
//     });

//     // 3️⃣ Store embeddings in Qdrant
//     await step.run("store-embeddings", async () => {
//       await qdrant.upsert("agents", {
//         points: embeddings.map((e) => ({
//           id: e.id,
//           vector: e.vector,
//           payload: e.payload,
//         })),
//       });
//     });

//     return { success: true };
//   }
// );

const VECTOR_SIZE = 3072; // Must match your embedding model

// Ensure collection exists
// async function ensureCollection() {
//   const collections = await qdrant.getCollections();
//   const exists = collections.collections.some(c => c.name === "agents");

//   if (!exists) {
//     await qdrant.createCollection("agents", {
//       vectors: { size: VECTOR_SIZE, distance: "Cosine" },
//     });
//     console.log("✅ Collection 'agents' created");
//   }
// }
async function ensureCollection() {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(c => c.name === "agents");

  // If exists, ensure size matches — if not, recreate
  if (exists) {
    const info = await qdrant.getCollection("agents");

    // qdrant response shapes may vary between SDK versions; try common locations for vector size.
    const currentVectorSize =
      (info as any).vectors?.size ??
      (info as any).config?.vectors?.size ??
      (info as any).config?.params?.vectors?.size ??
      null;

    if (currentVectorSize === null) {
      console.warn(
        `⚠️ Could not determine vector size for 'agents' collection, recreating to ensure correct vector size (${VECTOR_SIZE})`
      );
      await qdrant.deleteCollection("agents");
    } else if (currentVectorSize !== VECTOR_SIZE) {
      console.warn(
        `⚠️ Recreating 'agents' collection with correct vector size (${VECTOR_SIZE}), found ${currentVectorSize}`
      );
      await qdrant.deleteCollection("agents");
    } else {
      return; // ✅ Already correct
    }
  }

  await qdrant.createCollection("agents", {
    vectors: { size: VECTOR_SIZE, distance: "Cosine" },
  });

  console.log(`✅ Collection 'agents' created with vector size ${VECTOR_SIZE}`);
}


// export const generateAndStoreEmbeddings = inngest.createFunction(
//   { id: "generate-and-store-embeddings" },
//   { event: "agents/generate-embeddings" },
//   async ({ event, step }) => {
//     const { agentId, texts } = event.data;
//     console.log("🔹 Generating embeddings for agent:", agentId);

//     await ensureCollection();

//     // 1️⃣ Fetch agent info
//     const agent = await step.run("fetch-agent", async () => {
//       const res = await db.select().from(agents).where(eq(agents.id, agentId));
//       return res[0];
//     });

//     if (!agent) throw new Error("Agent not found");

//     // 2️⃣ Generate embeddings
//     const embeddings = await step.run("generate-embeddings", async () => {
//       const model = GeminiAI.getGenerativeModel({ model: "text-embedding-004" });

//       const vectors = await Promise.all(
//         (texts as string[]).map(async (text: string, idx: number) => {
//           const result = await model.embedContent(text);
//           const vector = result.embedding.values;

//           if (vector.length !== VECTOR_SIZE) {
//             throw new Error(`Invalid embedding length: ${vector.length}, expected ${VECTOR_SIZE}`);
//           }

//           return {
//             id: `${agentId}-${idx}`,
//             vector,
//             payload: { agentId, text },
//           };
//         })
//       );

//       return vectors;
//     });

//     // 3️⃣ Store embeddings in Qdrant
//     await step.run("store-embeddings", async () => {
//       const points = embeddings.map(e => ({
//         id: e.id,
//         vector: e.vector,
//         payload: e.payload || {},
//       }));

//       await qdrant.upsert("agents", { points });
//       console.log(`✅ Stored ${points.length} embeddings for agent ${agentId}`);
//     });

//     return { success: true };
//   }
// );

// export const generateAndStoreEmbeddings = inngest.createFunction(
//   { id: "generate-and-store-embeddings" },
//   { event: "agents/generate-embeddings" },
//   async ({ event, step }) => {
//     const { agentId, texts } = event.data;
//     console.log("🔹 Generating embeddings for agent:", agentId);

//     await ensureCollection();

//     // 1️⃣ Fetch agent info
//     const agent = await step.run("fetch-agent", async () => {
//       const res = await db.select().from(agents).where(eq(agents.id, agentId));
//       return res[0];
//     });

//     if (!agent) throw new Error("Agent not found");

//     // 2️⃣ Generate embeddings using LangChain Gemini Embeddings
//     const vectors = await step.run("generate-embeddings", async () => {
//       const textArray = texts as string[];
//       console.log(`Generating embeddings for ${textArray.length} texts`);
//       console.log("Text Array sample:", textArray);

//       const results = await Promise.all(
//         textArray.map(async (text, idx) => {
//           const vector = await geminiEmbeddings.embedQuery(text);
//           console.log(`Generated embedding for text index ${idx}, length: ${vector.length}`, vector);

//           return {
//             id: `${agentId}-${idx}`,
//             vector,
//             payload: { agentId, text: text.substring(0, 1000), textIndex: idx }, // Truncate text to first 1000 chars
//           };
//         })
//       );

//       return results;
//     });

//     // 3️⃣ Store embeddings in Qdrant
//     await step.run("store-embeddings", async () => {
//       try {

//         const points = vectors.map(e => ({
//           id: e.id,
//           vector: e.vector,
//           payload: e.payload,
//         }));
//         console.log(`📦 Preparing to upsert ${points.length} points`);
//         console.log(`📏 Sample vector dimension: ${points[0].vector.length}`);
//         console.log("📝 Sample payload:", points[0].payload);
//         console.log("🔢 Sample point:", points[0]);
//         console.log("🚀 Upserting points to Qdrant...", points);



//         await qdrant.upsert("agents", { points, wait: true });
//         console.log(`✅ Stored ${points.length} embeddings for agent ${agentId}`);
//       } catch (error) {
//         console.error("❌ Error storing embeddings in Qdrant:", error);
//       }
//     });

//     return { success: true, pointsStored: vectors.length, agentId };
//   }
// );

export const generateAndStoreEmbeddings = inngest.createFunction(
  { id: "generate-and-store-embeddings" },
  { event: "agents/generate-embeddings" },
  async ({ event, step }) => {
    const { agentId, texts } = event.data;
    console.log("🔹 Generating embeddings for agent:", agentId);

    // Ensure collection exists with correct dimensions
    await ensureCollection();

    // 1️⃣ Fetch agent info
    const agent = await step.run("fetch-agent", async () => {
      const res = await db.select().from(agents).where(eq(agents.id, agentId));
      return res[0];
    });

    if (!agent) throw new Error("Agent not found");

    // 2️⃣ Generate embeddings using LangChain Gemini Embeddings
    const vectors = await step.run("generate-embeddings", async () => {
      const textArray = texts as string[];
      console.log(`Generating embeddings for ${textArray.length} texts`);
      console.log("Text Array sample:", textArray.slice(0, 2)); // Only log first 2 for brevity

      const results = await Promise.all(
        textArray.map(async (text, idx) => {
          const vector = await geminiEmbeddings.embedQuery(text);
          
          // Validate vector dimension
          if (vector.length !== VECTOR_SIZE) {
            throw new Error(
              `Vector dimension mismatch! Expected ${VECTOR_SIZE}, got ${vector.length}`
            );
          }
          
          console.log(`✅ Generated embedding ${idx + 1}/${textArray.length}, dimension: ${vector.length}`);

          return {
            // id: `${agentId}-${idx}`,
            id: randomUUID(),
            vector,
            payload: { 
              agentId, 
              text: text.substring(0, 1000), // Truncate text to first 1000 chars
              textIndex: idx 
            },
          };
        })
      );

      console.log(`✅ Generated ${results.length} embeddings`);
      return results;
    });

    // 3️⃣ Store embeddings in Qdrant
    const result = await step.run("store-embeddings", async () => {
      try {
        // Verify collection configuration
        const collectionInfo = await qdrant.getCollection("agents");
        const collectionVectorSize = 
          (collectionInfo as any).vectors?.size ??
          (collectionInfo as any).config?.vectors?.size ??
          (collectionInfo as any).config?.params?.vectors?.size;

        console.log(`📊 Collection vector size: ${collectionVectorSize}`);
        
        if (collectionVectorSize !== VECTOR_SIZE) {
          throw new Error(
            `Collection dimension mismatch! Collection has ${collectionVectorSize}, embeddings have ${VECTOR_SIZE}`
          );
        }

        const points = vectors.map(e => ({
          id: e.id,
          vector: e.vector,
          payload: e.payload,
        }));

        console.log(`📦 Upserting ${points.length} points to Qdrant`);
        console.log(`📏 First vector dimension: ${points[0].vector.length}`);
        console.log(`📝 Sample payload:`, points[0].payload);

        const upsertResult = await qdrant.upsert("agents", { 
          points, 
          wait: true 
        });
        
        console.log(`✅ Successfully stored ${points.length} embeddings for agent ${agentId}`);
        console.log(`📊 Upsert result:`, upsertResult);
        
        return { success: true, pointsStored: points.length };
      } catch (error: any) {
        console.error("❌ Error storing embeddings in Qdrant:");
        console.error("❌ Error message:", error.message);
        console.error("❌ Error status:", error.status);
        console.error("❌ Error data:", JSON.stringify(error.data, null, 2));
        console.error("❌ Full error:", error);
        
        // Re-throw to mark step as failed
        throw new Error(`Failed to store embeddings: ${error.message}`);
      }
    });

    return { 
      success: true, 
      pointsStored: result.pointsStored, 
      agentId 
    };
  }
);