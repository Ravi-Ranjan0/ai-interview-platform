import { QdrantClient } from "@qdrant/js-client-rest";
import { VECTOR_SIZE } from "./embedding";
import { env } from "./env";

export const qdrant = new QdrantClient({
  url: env.QDRANT_URL,
  apiKey: env.QDRANT_API_KEY,
});

export async function ensureAgentCollection() {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(c => c.name === "agents");

  if (exists) {
    const info = await qdrant.getCollection("agents");

    const currentVectorSize =
      (info as any).vectors?.size ??
      (info as any).config?.vectors?.size ??
      (info as any).config?.params?.vectors?.size ??
      null;

    if (currentVectorSize !== null && currentVectorSize !== VECTOR_SIZE) {
      // Every agent's vectors live in this one collection. Auto-deleting it
      // on a size mismatch (e.g. an embedding model swap) would silently wipe
      // every agent's knowledge base platform-wide. Require a deliberate
      // migration instead of a silent nuke.
      throw new Error(
        `Qdrant collection 'agents' has vector size ${currentVectorSize}, but the ` +
          `configured embedding model needs ${VECTOR_SIZE}. Refusing to auto-recreate ` +
          `(this would delete every agent's vectors). Migrate or drop the collection ` +
          `manually, then retry.`
      );
    }

    if (currentVectorSize === VECTOR_SIZE) return;

    console.warn(
      `Could not determine vector size for 'agents' collection; leaving it as-is ` +
        `and assuming it already matches size ${VECTOR_SIZE}.`
    );
    return;
  }

  await qdrant.createCollection("agents", {
    vectors: { size: VECTOR_SIZE, distance: "Cosine" },
  });

  console.log(`Collection 'agents' created with vector size ${VECTOR_SIZE}`);
}
