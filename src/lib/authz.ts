import "server-only";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// Trust-boundary helpers. Every writer that accepts a foreign-key id from the
// client MUST run the matching assert before referencing it. Adding a new
// resource? Add its assert here so the pattern stays one call site per writer.

export async function assertAgentOwned(agentId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found." });
  }
}
