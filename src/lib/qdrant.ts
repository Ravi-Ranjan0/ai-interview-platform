import { QdrantClient } from "@qdrant/js-client-rest";

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY,
});

export async function ensureAgentCollection() {
  const collections = await qdrant.getCollections();

  const exists = collections.collections.some(c => c.name === "agents");
  if (!exists) {
    await qdrant.createCollection("agents", {
      vectors: {
        size: 768,        // embedding dimension
        distance: "Cosine", // similarity metric
      },
    });
    console.log("✅ Collection 'agents' created");
  } else {
    console.log("ℹ️ Collection 'agents' already exists");
  }
}