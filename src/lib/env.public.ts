import { z } from "zod";

// Public env. Inlined at build time by Next; safe to import from client
// components. Never put server-only secrets here.

const schema = z.object({
  NEXT_PUBLIC_STREAM_VIDEO_API_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
});

const parsed = schema.safeParse({
  // Explicit reads — Next only replaces literal `process.env.NEXT_PUBLIC_*`
  // access; a spread of `process.env` would come back undefined on the client.
  NEXT_PUBLIC_STREAM_VIDEO_API_KEY: process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid public environment variables:\n${issues}`);
}

export const publicEnv = parsed.data;
