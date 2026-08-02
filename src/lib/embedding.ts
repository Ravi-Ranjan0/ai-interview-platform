import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { env } from "./env";

export const VECTOR_SIZE = 3072; // Gemini Embedding 001 output dimension

export const geminiEmbeddings = new GoogleGenerativeAIEmbeddings({
  modelName: "gemini-embedding-001",
  apiKey: env.GEMINI_API_KEY,
});
