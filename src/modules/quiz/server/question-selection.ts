import "server-only";
import { db } from "@/db";
import { quizQuestions, quizAttempts, quizAttemptQuestions } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { QUIZ_QUESTIONS_PER_ATTEMPT, QUIZ_TOPUP_COUNT, QUIZ_TOPUP_THRESHOLD } from "@/constant";

// Picks the question set for a new attempt. Never repeats a question within
// the attempt. Across attempts it prefers questions this candidate has never
// seen for this agent, and only reuses previously-seen ones (oldest-used
// first) once the never-used pool runs dry — composition actually changes
// attempt to attempt instead of just reshuffling a fixed list. When the
// never-used pool gets low, it also kicks off a background top-up so the
// *next* attempt has fresh material again.
export async function selectQuestionsForAttempt(agentId: string, userId: string) {
  const bank = await db
    .select()
    .from(quizQuestions)
    .where(and(eq(quizQuestions.agentId, agentId), eq(quizQuestions.isActive, true)));

  if (bank.length === 0) {
    throw new Error("No quiz questions available for this agent yet.");
  }

  const usage = await db
    .select({
      id: quizAttemptQuestions.quizQuestionId,
      lastUsed: sql<Date>`max(${quizAttemptQuestions.createdAt})`,
    })
    .from(quizAttemptQuestions)
    .innerJoin(quizAttempts, eq(quizAttemptQuestions.quizAttemptId, quizAttempts.id))
    .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.agentId, agentId)))
    .groupBy(quizAttemptQuestions.quizQuestionId);

  const usedAt = new Map(usage.map((u) => [u.id, new Date(u.lastUsed)]));
  const neverUsed = bank.filter((q) => !usedAt.has(q.id));
  const reusable = bank
    .filter((q) => usedAt.has(q.id))
    .sort((a, b) => usedAt.get(a.id)!.getTime() - usedAt.get(b.id)!.getTime());

  const selected = neverUsed
    .slice(0, QUIZ_QUESTIONS_PER_ATTEMPT)
    .concat(reusable.slice(0, Math.max(0, QUIZ_QUESTIONS_PER_ATTEMPT - neverUsed.length)));

  if (neverUsed.length < QUIZ_TOPUP_THRESHOLD) {
    // Fire-and-forget: doesn't block the current attempt, just grows the
    // bank so future attempts keep drawing genuinely new questions.
    await inngest.send({
      name: "agents/generate-quiz-questions",
      data: { agentId, count: QUIZ_TOPUP_COUNT },
    });
  }

  return selected;
}
