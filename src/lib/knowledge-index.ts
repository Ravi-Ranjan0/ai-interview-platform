import "server-only";
import { createHash, randomUUID } from "crypto";
import { db } from "@/db";
import { knowledgeChunks, embeddingCache } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { qdrant, ensureAgentCollection } from "@/lib/qdrant";
import { geminiEmbeddings, VECTOR_SIZE } from "@/lib/embedding";
import type { AgentVectorPayload } from "@/inngest/functions";

const EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_CONCURRENCY = 5;

export type SourceType = "document" | "url" | "quiz" | "interview";
export type IndexableChunk = { heading?: string; text: string; chunkIndex: number };

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function bufferToVector(buf: Buffer): number[] {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

function vectorToBuffer(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

// Cache is global (not agent-scoped) — identical content reused across
// agents/candidates (e.g. a boilerplate resume section) skips the Gemini
// call entirely on every subsequent sighting, not just the first agent's.
async function embedWithCache(text: string, contentHash: string): Promise<{ vector: number[]; cached: boolean }> {
  const [existing] = await db
    .select({ vector: embeddingCache.vector })
    .from(embeddingCache)
    .where(and(eq(embeddingCache.contentHash, contentHash), eq(embeddingCache.model, EMBEDDING_MODEL)));

  if (existing) {
    return { vector: bufferToVector(existing.vector), cached: true };
  }

  const vector = await geminiEmbeddings.embedQuery(text);
  if (vector.length !== VECTOR_SIZE) {
    throw new Error(`Vector dimension mismatch! Expected ${VECTOR_SIZE}, got ${vector.length}`);
  }

  await db
    .insert(embeddingCache)
    .values({ contentHash, model: EMBEDDING_MODEL, vector: vectorToBuffer(vector) })
    .onConflictDoNothing();

  return { vector, cached: false };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Indexes a source's current chunk set against what's already stored for it,
// so a re-run (recrawl, reprocessed document, etc.) only pays for real
// deltas instead of blindly re-chunking and re-embedding everything:
//   - A chunk whose exact text (contentHash) already has a row for this
//     exact (sourceType, sourceId) is skipped entirely — no embed, no upsert.
//   - A genuinely new/changed chunk is embedded (via the cache above) and
//     upserted as a fresh Qdrant point (a fresh UUID — Qdrant point ids must
//     be an unsigned int or UUID, never an arbitrary hash string).
//   - Any previously-indexed chunk for this source whose hash is no longer
//     present in the current set is stale and gets removed from both Qdrant
//     and the bookkeeping table.
export async function indexChunksForSource(params: {
  agentId: string;
  sourceType: SourceType;
  sourceId: string;
  candidateId?: string;
  label?: string;
  payloadExtra?: Partial<AgentVectorPayload>;
  chunks: IndexableChunk[];
  concurrency?: number;
}): Promise<{ indexed: number; cached: number; skippedUnchanged: number; removed: number }> {
  const { agentId, sourceType, sourceId, candidateId, label, payloadExtra, chunks } = params;
  const concurrency = params.concurrency ?? DEFAULT_CONCURRENCY;

  await ensureAgentCollection();

  const existingRows = await db
    .select()
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.sourceType, sourceType), eq(knowledgeChunks.sourceId, sourceId)));
  const existingHashes = new Set(existingRows.map((r) => r.contentHash));

  const currentHashes = new Set<string>();
  const newChunks = chunks.filter((c) => {
    const hash = hashText(c.text);
    currentHashes.add(hash);
    return !existingHashes.has(hash);
  });

  let cachedCount = 0;
  await mapWithConcurrency(newChunks, concurrency, async (chunk) => {
    const contentHash = hashText(chunk.text);
    const { vector, cached } = await embedWithCache(chunk.text, contentHash);
    if (cached) cachedCount++;

    const qdrantPointId = randomUUID();
    const payload: AgentVectorPayload = {
      agentId,
      text: chunk.text,
      chunkIndex: chunk.chunkIndex,
      ...(candidateId ? { candidateId } : {}),
      ...(label ? { source: label } : {}),
      ...(chunk.heading ? { section: chunk.heading } : {}),
      ...payloadExtra,
    };

    await qdrant.upsert("agents", { points: [{ id: qdrantPointId, vector, payload }], wait: true });
    await db.insert(knowledgeChunks).values({
      agentId,
      sourceType,
      sourceId,
      candidateId,
      label,
      contentHash,
      qdrantPointId,
      heading: chunk.heading,
      text: chunk.text,
      chunkIndex: chunk.chunkIndex,
    });
  });

  const staleRows = existingRows.filter((r) => !currentHashes.has(r.contentHash));
  if (staleRows.length > 0) {
    try {
      await qdrant.delete("agents", { points: staleRows.map((r) => r.qdrantPointId), wait: true });
    } catch (err) {
      console.error(`[knowledge-index-cleanup-failed] agent=${agentId} source=${sourceType}:${sourceId}`, err);
    }
    await db.delete(knowledgeChunks).where(inArray(knowledgeChunks.id, staleRows.map((r) => r.id)));
  }

  return {
    indexed: newChunks.length,
    cached: cachedCount,
    skippedUnchanged: chunks.length - newChunks.length,
    removed: staleRows.length,
  };
}

// Used when a source is deleted or dropped outright (not re-processed) — a
// document row being removed, or a URL no longer in the agent's crawl list —
// so both the Qdrant points and the bookkeeping rows for it are cleaned up
// together, rather than leaving one side orphaned.
export async function removeSource(sourceType: SourceType, sourceId: string): Promise<{ removed: number }> {
  const rows = await db
    .select({ id: knowledgeChunks.id, qdrantPointId: knowledgeChunks.qdrantPointId })
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.sourceType, sourceType), eq(knowledgeChunks.sourceId, sourceId)));

  if (rows.length === 0) return { removed: 0 };

  try {
    await qdrant.delete("agents", { points: rows.map((r) => r.qdrantPointId), wait: true });
  } catch (err) {
    console.error(`[knowledge-index-remove-source-failed] ${sourceType}:${sourceId}`, err);
  }
  await db.delete(knowledgeChunks).where(inArray(knowledgeChunks.id, rows.map((r) => r.id)));
  return { removed: rows.length };
}

// The distinct sourceIds currently indexed for an agent+sourceType — used to
// find sources that disappeared entirely between runs (e.g. a URL dropped
// from the crawl list) so they can be pruned via removeSource above.
export async function listIndexedSourceIds(agentId: string, sourceType: SourceType): Promise<string[]> {
  const rows = await db
    .selectDistinct({ sourceId: knowledgeChunks.sourceId })
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.agentId, agentId), eq(knowledgeChunks.sourceType, sourceType)));
  return rows.map((r) => r.sourceId);
}
