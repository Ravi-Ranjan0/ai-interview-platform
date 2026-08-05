import "server-only";
import { db } from "@/db";
import { knowledgeChunks } from "@/db/schema";
import { and, eq, isNull, or, sql, desc } from "drizzle-orm";
import { qdrant } from "@/lib/qdrant";
import { geminiEmbeddings } from "@/lib/embedding";
import type { AgentVectorPayload } from "@/inngest/functions";

const RRF_K = 60;
const LEG_FANOUT = 20;

export type HybridHit = {
  qdrantPointId: string;
  text: string;
  heading: string | null;
  label: string | null;
  score: number; // fused RRF score — useful for ordering, not a calibrated confidence value
  denseScore: number | null; // raw cosine score, only set if this chunk came from the dense leg
  matchedLexical: boolean; // true if the lexical (exact-term) leg matched this chunk
};

type LegHit = { qdrantPointId: string; text: string; heading: string | null; label: string | null };

async function denseLeg(
  agentId: string,
  candidateId: string,
  vector: number[],
  limit: number
): Promise<(LegHit & { denseScore: number })[]> {
  const raw = await qdrant.search("agents", {
    vector,
    limit,
    filter: {
      must: [{ key: "agentId", match: { value: agentId } }],
      should: [
        { is_empty: { key: "candidateId" } },
        { key: "candidateId", match: { value: candidateId } },
      ],
    },
  });
  return raw.map((r) => {
    const payload = r.payload as Partial<AgentVectorPayload>;
    return {
      qdrantPointId: String(r.id),
      text: payload.text ?? "",
      heading: payload.section ?? null,
      label: payload.source ?? payload.fileName ?? payload.url ?? null,
      denseScore: r.score ?? 0,
    };
  });
}

async function lexicalLeg(agentId: string, candidateId: string, query: string, limit: number): Promise<LegHit[]> {
  const tsQuery = sql`plainto_tsquery('english', ${query})`;
  const rank = sql<number>`ts_rank(${knowledgeChunks.searchVector}, ${tsQuery})`;
  return db
    .select({
      qdrantPointId: knowledgeChunks.qdrantPointId,
      text: knowledgeChunks.text,
      heading: knowledgeChunks.heading,
      label: knowledgeChunks.label,
    })
    .from(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.agentId, agentId),
        or(isNull(knowledgeChunks.candidateId), eq(knowledgeChunks.candidateId, candidateId)),
        sql`${knowledgeChunks.searchVector} @@ ${tsQuery}`
      )
    )
    .orderBy(desc(rank))
    .limit(limit);
}

// Fuses independent dense (semantic) and lexical (exact-term, via a Postgres
// full-text mirror of the same chunks) retrieval via Reciprocal Rank Fusion,
// so an exact keyword/name match a pure embedding search might rank low
// still surfaces. RRF scores aren't on the same 0-1 scale as Qdrant's cosine
// scores — callers that need a confidence gate should use `denseScore`
// and/or `matchedLexical` (an exact lexical hit is meaningful on its own,
// even without a strong cosine score), not `score`.
export async function hybridSearch(params: {
  agentId: string;
  candidateId: string;
  query: string;
  limit: number;
}): Promise<HybridHit[]> {
  const { agentId, candidateId, query, limit } = params;

  const [queryVector, lexicalHits] = await Promise.all([
    geminiEmbeddings.embedQuery(query),
    lexicalLeg(agentId, candidateId, query, LEG_FANOUT),
  ]);
  const denseHits = await denseLeg(agentId, candidateId, queryVector, LEG_FANOUT);

  const scores = new Map<string, number>();
  const meta = new Map<string, Omit<HybridHit, "qdrantPointId" | "score">>();

  denseHits.forEach((hit, rank) => {
    scores.set(hit.qdrantPointId, (scores.get(hit.qdrantPointId) ?? 0) + 1 / (RRF_K + rank + 1));
    meta.set(hit.qdrantPointId, {
      text: hit.text,
      heading: hit.heading,
      label: hit.label,
      denseScore: hit.denseScore,
      matchedLexical: false,
    });
  });
  lexicalHits.forEach((hit, rank) => {
    scores.set(hit.qdrantPointId, (scores.get(hit.qdrantPointId) ?? 0) + 1 / (RRF_K + rank + 1));
    const existing = meta.get(hit.qdrantPointId);
    if (existing) {
      existing.matchedLexical = true;
    } else {
      meta.set(hit.qdrantPointId, {
        text: hit.text,
        heading: hit.heading,
        label: hit.label,
        denseScore: null,
        matchedLexical: true,
      });
    }
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([qdrantPointId, score]) => ({ qdrantPointId, score, ...meta.get(qdrantPointId)! }));
}
