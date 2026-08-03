import "server-only";
import { db } from "@/db";
import { agents, rooms, roomMembers } from "@/db/schema";
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

export async function assertRoomMember(roomId: string, userId: string): Promise<void> {
  const [room] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId));
  if (!room) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Room not found." });
  }
  const [membership] = await db
    .select({ id: roomMembers.id })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)));
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this room." });
  }
}
