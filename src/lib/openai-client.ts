import OpenAI from "openai";

// ✅ Ensure environment variable exists at runtime
if (!process.env.OPENAI_API_KEY) {
  throw new Error("❌ Missing OPENAI_API_KEY in environment variables");
}

/**
 * Singleton OpenAI client used across the app
 * Works for embeddings, completions, assistants, etc.
 */
export const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});