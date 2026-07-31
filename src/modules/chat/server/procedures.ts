import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { db } from "@/db";
import { messages, conversations } from "@/db/schema";
import { eq, asc, and } from "drizzle-orm";
import z from "zod";
import { TRPCError } from "@trpc/server";
import { inngest } from "@/inngest/client";

export const messagesRouter = createTRPCRouter({
  getMessages: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      // ✅ Check conversation belongs to this user
      const conv = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.userId, ctx.auth.user.id)
          )
        )
        .limit(1);

      if (conv.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      // ✅ Fetch messages
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, input.conversationId))
        .orderBy(asc(messages.createdAt));

      return rows.map((msg) => ({
        fromSelf: msg.userId === ctx.auth.user.id,
        message: msg.content,
        createdAt: msg.createdAt,
      }));
    }),

  addMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        content: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ownership check + fetch agentId in one query
      const [conv] = await db
        .select({ id: conversations.id, agentId: conversations.agentId })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.userId, ctx.auth.user.id)
          )
        )
        .limit(1);

      if (!conv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      await db.insert(messages).values({
        conversationId: input.conversationId,
        userId: ctx.auth.user.id,
        sender: "user",
        content: input.content,
      });

      await inngest.send({
        name: "agent/message",
        data: {
          agentId: conv.agentId,
          conversationId: input.conversationId,
          userId: ctx.auth.user.id,
          content: input.content,
        },
      });

      return { success: true };
    }),

});
