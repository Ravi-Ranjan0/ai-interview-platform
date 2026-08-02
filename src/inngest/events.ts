// Central source of truth for Inngest event payload shapes.
// Handlers parse() at entry; dispatchers get inferred types via EventData<K>.
// Adding a new event: add its schema here, then every handler and every
// dispatcher agrees on the payload by construction.

import { z } from "zod";

const meetingsProcessing = z.object({
  meetingId: z.string(),
  transcriptUrl: z.string(),
});

const agentsQuestions = z.object({
  agentId: z.string(),
});

const agentsGenerateEmbeddings = z.object({
  agentId: z.string(),
  pages: z.array(z.object({ url: z.string(), text: z.string() })),
  url: z.string().optional(),
});

const agentsCrawlUrls = z.object({
  agentId: z.string(),
  urls: z.array(z.string()),
});

const agentMessage = z.object({
  agentId: z.string(),
  conversationId: z.string(),
  userId: z.string(),
  content: z.string(),
});

const documentsProcess = z.object({
  documentId: z.string(),
  agentId: z.string(),
  fileUrl: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
});

export const EventSchemas = {
  "meetings/processing": meetingsProcessing,
  "agents/questions": agentsQuestions,
  "agents/generate-embeddings": agentsGenerateEmbeddings,
  "agents/crawl-urls": agentsCrawlUrls,
  "agent/message": agentMessage,
  "documents/process": documentsProcess,
} as const;

export type EventName = keyof typeof EventSchemas;
export type EventData<K extends EventName> = z.infer<typeof EventSchemas[K]>;

// Runtime parse for handlers. Throws inside the Inngest step on drift → the
// dashboard surfaces it and normal retry/backoff applies.
export function parseEvent<K extends EventName>(name: K, data: unknown): EventData<K> {
  return EventSchemas[name].parse(data) as EventData<K>;
}
