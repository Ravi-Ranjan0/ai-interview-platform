import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { db } from "@/db";
import { agents, documents } from "@/db/schema";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { inngest } from "@/inngest/client";
import { qdrant } from "@/lib/qdrant";

async function assertAgentOwned(agentId: string, userId: string) {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found." });
  }
}

export const documentsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      agentId: z.string(),
      fileName: z.string(),
      fileUrl: z.string(),
      fileSize: z.number().optional(),
      mimeType: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentOwned(input.agentId, ctx.auth.user.id);

      const [doc] = await db.insert(documents).values({
        agentId: input.agentId,
        userId: ctx.auth.user.id,
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        status: "pending",
      }).returning();

      await inngest.send({
        name: "documents/process",
        data: {
          documentId: doc.id,
          agentId: input.agentId,
          fileUrl: input.fileUrl,
          fileName: input.fileName,
          mimeType: input.mimeType,
        }
      });

      return doc;
    }),

  getByAgent: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.agentId, input.agentId),
            eq(documents.userId, ctx.auth.user.id)
          )
        )
        .orderBy(desc(documents.createdAt));
    }),

  getMany: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.agentId, input.agentId),
            eq(documents.userId, ctx.auth.user.id)
          )
        );
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.userId, ctx.auth.user.id)
          )
        );

      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found." });
      }

      // ponytail: best-effort Qdrant cleanup; DB delete still proceeds on failure
      // so a stale index doesn't wedge the UI. Upgrade path: retry queue.
      try {
        await qdrant.delete("agents", {
          filter: { must: [{ key: "documentId", match: { value: input.id } }] },
          wait: true,
        });
      } catch (err) {
        console.error(`Qdrant cleanup failed for document ${input.id}:`, err);
      }

      await db
        .delete(documents)
        .where(and(eq(documents.id, input.id), eq(documents.userId, ctx.auth.user.id)));
      return { success: true };
    })
});
