import "server-only";
import { z } from "zod";

// Server env. Validated once at module load — a missing required var
// throws here at boot, not at first request that happens to need it.
// OAuth provider vars are optional (login just loses that provider);
// core infra (DB, LLMs, Stream, Qdrant) is required.

const schema = z.object({
  DATABASE_URL: z.string().url(),

  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url().optional(),

  GEMINI_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),

  STREAM_VIDEO_SECRET_KEY: z.string().min(1),

  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().optional(),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid server environment variables:\n${issues}\n` +
      `Copy .env.example to .env and fill in the missing values.`
  );
}

export const env = parsed.data;
