import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { db } from "@/db";
import { messages, conversations, user } from "@/db/schema";
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
      sender: z.enum(["user", "agent"]),
      content: z.string(),
      userId: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {

    // 1) Insert the user's message into DB
    console.log("Adding message from user:", input.userId);
    await db.insert(messages).values({
      conversationId: input.conversationId,
      userId: ctx.auth.user.id,
      sender: input.sender,
      content: input.content,
    });

    // 2) Fetch conversation to know which agent should reply
    const conv = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);

    if (conv.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
    }
    console.log("Fetched conversation:", conv);

    const agentId = conv[0].agentId;

    // 3) Trigger Inngest workflow → makes the agent respond
    console.log("Triggering Inngest workflow for agent:", agentId);
    if (input.sender === "user" && agentId) {
    await inngest.send({
      name: "agent/message",
      data: {
        agentId,
        conversationId: input.conversationId,
        userId: ctx.auth.user.id,
        content: input.content, // the user question
      },
    });
    }
    return { success: true };
  }),

});
