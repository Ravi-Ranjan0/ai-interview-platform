import { QdrantClient } from "@qdrant/js-client-rest";
import { VECTOR_SIZE } from "./embedding";

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY,
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

    if (currentVectorSize === null) {
      console.warn(
        `Could not determine vector size for 'agents' collection, recreating with size ${VECTOR_SIZE}`
      );
      await qdrant.deleteCollection("agents");
    } else if (currentVectorSize !== VECTOR_SIZE) {
      console.warn(
        `Recreating 'agents' collection: found size ${currentVectorSize}, need ${VECTOR_SIZE}`
      );
      await qdrant.deleteCollection("agents");
    } else {
      return;
    }
  }

  await qdrant.createCollection("agents", {
    vectors: { size: VECTOR_SIZE, distance: "Cosine" },
  });

  console.log(`Collection 'agents' created with vector size ${VECTOR_SIZE}`);
}
