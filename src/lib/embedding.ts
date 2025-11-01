import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

export const geminiEmbeddings = new GoogleGenerativeAIEmbeddings({
  modelName: "gemini-embedding-001",
  apiKey: process.env.GEMINI_API_KEY!,
});
