import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { db } from "@/db";
import { quizAttempts, quizAttemptQuestions } from "@/db/schema";
import { z } from "zod";
import { eq, and, desc, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { inngest } from "@/inngest/client";
import { assertAgentOwned } from "@/lib/authz";
import { quizSubmitAnswerSchema } from "../schema";
import { selectQuestionsForAttempt } from "./question-selection";
import { QUIZ_DURATION_MS } from "@/constant";

async function assertAttemptOwned(attemptId: string, userId: string) {
  const [attempt] = await db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.userId, userId)));
  if (!attempt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Quiz attempt not found." });
  }
  return attempt;
}

// An attempt past its expiry is treated as expired from here on, even if no
// client happened to be open to auto-complete it at the exact moment.
async function expireIfPastDeadline(attempt: typeof quizAttempts.$inferSelect) {
  if (attempt.status === "in_progress" && attempt.expiresAt.getTime() < Date.now()) {
    const [updated] = await db
      .update(quizAttempts)
      .set({ status: "expired" })
      .where(eq(quizAttempts.id, attempt.id))
      .returning();
    return updated;
  }
  return attempt;
}

export const quizRouter = createTRPCRouter({
  start: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentOwned(input.agentId, ctx.auth.user.id);

      const [existing] = await db
        .select()
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.agentId, input.agentId),
            eq(quizAttempts.userId, ctx.auth.user.id),
            eq(quizAttempts.status, "in_progress")
          )
        );

      if (existing) {
        const current = await expireIfPastDeadline(existing);
        if (current.status === "in_progress") {
          return current;
        }
      }

      const questions = await selectQuestionsForAttempt(input.agentId, ctx.auth.user.id);

      const [attempt] = await db
        .insert(quizAttempts)
        .values({
          agentId: input.agentId,
          userId: ctx.auth.user.id,
          expiresAt: new Date(Date.now() + QUIZ_DURATION_MS),
        })
        .returning();

      await db.insert(quizAttemptQuestions).values(
        questions.map((q, index) => ({
          quizAttemptId: attempt.id,
          quizQuestionId: q.id,
          orderIndex: index,
          questionText: q.question,
        }))
      );

      return attempt;
    }),

  getActive: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [existing] = await db
        .select()
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.agentId, input.agentId),
            eq(quizAttempts.userId, ctx.auth.user.id),
            eq(quizAttempts.status, "in_progress")
          )
        );
      if (!existing) return null;
      const current = await expireIfPastDeadline(existing);
      return current.status === "in_progress" ? current : null;
    }),

  submitAnswer: protectedProcedure
    .input(quizSubmitAnswerSchema)
    .mutation(async ({ ctx, input }) => {
      const attempt = await assertAttemptOwned(input.attemptId, ctx.auth.user.id);
      const current = await expireIfPastDeadline(attempt);
      if (current.status !== "in_progress") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This quiz attempt is no longer in progress." });
      }

      const [question] = await db
        .select()
        .from(quizAttemptQuestions)
        .where(
          and(
            eq(quizAttemptQuestions.id, input.quizAttemptQuestionId),
            eq(quizAttemptQuestions.quizAttemptId, input.attemptId)
          )
        );
      if (!question) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Quiz question not found for this attempt." });
      }

      const [updated] = await db
        .update(quizAttemptQuestions)
        .set({ answerText: input.answerText, answeredAt: new Date() })
        .where(eq(quizAttemptQuestions.id, input.quizAttemptQuestionId))
        .returning();

      return updated;
    }),

  complete: protectedProcedure
    .input(z.object({ attemptId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const attempt = await assertAttemptOwned(input.attemptId, ctx.auth.user.id);
      if (attempt.status === "completed") return attempt;

      const [updated] = await db
        .update(quizAttempts)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(quizAttempts.id, input.attemptId))
        .returning();

      await inngest.send({
        name: "quiz/attempt-completed",
        data: { quizAttemptId: input.attemptId },
      });

      return updated;
    }),

  getAttempt: protectedProcedure
    .input(z.object({ attemptId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const attempt = await assertAttemptOwned(input.attemptId, ctx.auth.user.id);
      const questions = await db
        .select()
        .from(quizAttemptQuestions)
        .where(eq(quizAttemptQuestions.quizAttemptId, input.attemptId))
        .orderBy(asc(quizAttemptQuestions.orderIndex));

      return { attempt, questions };
    }),

  listAttempts: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertAgentOwned(input.agentId, ctx.auth.user.id);
      return db
        .select()
        .from(quizAttempts)
        .where(and(eq(quizAttempts.agentId, input.agentId), eq(quizAttempts.userId, ctx.auth.user.id)))
        .orderBy(desc(quizAttempts.createdAt));
    }),
});
