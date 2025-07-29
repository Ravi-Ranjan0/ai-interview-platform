import { StreamTranscriptItem } from "@/modules/meetings/type";
import { inngest } from "./client";
import JSONL from "jsonl-parse-stringify";
import { db } from "@/db";
import { agents, meetings, user } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {createAgent, openai,gemini, TextMessage} from "@inngest/agent-kit";


const summarizer = createAgent({
  name: "summarizer",
  system:`You are an expert summarizer. You write readable, concise, simple content. You are given a transcript of a meeting and you need to summarize it.

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


    const {output} = await summarizer.run(
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