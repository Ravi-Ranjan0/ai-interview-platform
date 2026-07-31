import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

export const VECTOR_SIZE = 3072; // Gemini Embedding 001 output dimension

export const geminiEmbeddings = new GoogleGenerativeAIEmbeddings({
  modelName: "gemini-embedding-001",
  apiKey: process.env.GEMINI_API_KEY!,
});
