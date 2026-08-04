import z from "zod";

export const quizSubmitAnswerSchema = z.object({
  attemptId: z.string().min(1),
  quizAttemptQuestionId: z.string().min(1),
  answerText: z.string().min(1, "Answer is required"),
});
