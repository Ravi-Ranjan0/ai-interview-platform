import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { inngest } from "@/inngest/client";
import { removeSource } from "@/lib/knowledge-index";
import { assertAgentOwned } from "@/lib/authz";

export const documentsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      agentId: z.string().min(1),
      fileName: z.string().min(1),
      fileUrl: z.string().url(),
      fileSize: z.number().int().nonnegative().optional(),
      mimeType: z.string().min(1),
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

      // Cleans up both the Qdrant points and the knowledge_chunks bookkeeping
      // rows together; best-effort on the Qdrant side (logged, not thrown) so
      // a transient Qdrant failure doesn't block the document row deletion.
      await removeSource("document", input.id);

      await db
        .delete(documents)
        .where(and(eq(documents.id, input.id), eq(documents.userId, ctx.auth.user.id)));
      return { success: true };
    })
});
