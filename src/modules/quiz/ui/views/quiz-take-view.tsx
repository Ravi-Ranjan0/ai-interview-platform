"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2Icon, ClockIcon } from "lucide-react";
import { toast } from "sonner";

interface Props {
  agentId: string;
}

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const QuizTakeView = ({ agentId }: Props) => {
  const trpc = useTRPC();
  const router = useRouter();

  const { data: agent } = useSuspenseQuery(trpc.agents.getOne.queryOptions({ id: agentId }));
  const activeQuery = useQuery(trpc.quiz.getActive.queryOptions({ agentId }));

  const startQuiz = useMutation(
    trpc.quiz.start.mutationOptions({
      onSuccess: () => activeQuery.refetch(),
      onError: (e) => toast.error(e.message),
    })
  );

  const attemptId = activeQuery.data?.id ?? null;

  const attemptQuery = useQuery({
    ...trpc.quiz.getAttempt.queryOptions({ attemptId: attemptId ?? "" }),
    enabled: !!attemptId,
  });

  const completeQuiz = useMutation(
    trpc.quiz.complete.mutationOptions({
      onSuccess: (attempt) => router.push(`/quiz/results/${attempt.id}`),
      onError: (e) => toast.error(e.message),
    })
  );

  const submitAnswer = useMutation(
    trpc.quiz.submitAnswer.mutationOptions({
      onError: (e) => toast.error(e.message),
    })
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const hasAutoCompletedRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const expiresAt = activeQuery.data?.expiresAt ? new Date(activeQuery.data.expiresAt).getTime() : null;
  const remainingMs = expiresAt !== null ? expiresAt - now : null;

  useEffect(() => {
    if (remainingMs !== null && remainingMs <= 0 && attemptId && !hasAutoCompletedRef.current) {
      hasAutoCompletedRef.current = true;
      completeQuiz.mutate({ attemptId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, attemptId]);

  const questions = attemptQuery.data?.questions ?? [];
  const currentQuestion = questions[currentIndex];

  useEffect(() => {
    setAnswer(currentQuestion?.answerText ?? "");
  }, [currentQuestion?.id]);

  const isLast = currentIndex === questions.length - 1;

  const handleSaveAndNext = async () => {
    if (!currentQuestion || !attemptId) return;
    if (!answer.trim()) {
      toast.error("Please write an answer before continuing.");
      return;
    }
    await submitAnswer.mutateAsync({
      attemptId,
      quizAttemptQuestionId: currentQuestion.id,
      answerText: answer.trim(),
    });
    if (isLast) {
      completeQuiz.mutate({ attemptId });
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  if (activeQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!attemptId) {
    return (
      <Card className="max-w-lg mx-auto">
        <CardHeader>
          <CardTitle>Pre-interview quiz</CardTitle>
          <CardDescription>
            Answer a handful of questions about your background for the {agent.name} role — about 30 minutes.
            Your answers are graded and help the AI interviewer ask you more relevant questions during the live call.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => startQuiz.mutate({ agentId })} disabled={startQuiz.isPending}>
            {startQuiz.isPending && <Loader2Icon className="size-4 animate-spin mr-2" />}
            Start quiz
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (attemptQuery.isLoading || !currentQuestion) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isSaving = submitAnswer.isPending || completeQuiz.isPending;

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            Question {currentIndex + 1} of {questions.length}
          </CardTitle>
          {remainingMs !== null && (
            <div className="flex items-center gap-x-1.5 text-sm text-muted-foreground">
              <ClockIcon className="size-4" />
              {formatRemaining(remainingMs)}
            </div>
          )}
        </div>
        <CardDescription className="text-base text-foreground pt-2">
          {currentQuestion.questionText}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-y-4">
        <Textarea
          rows={6}
          placeholder="Type your answer..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={isSaving}
        />
        <div className="flex justify-end">
          <Button onClick={handleSaveAndNext} disabled={isSaving}>
            {isSaving && <Loader2Icon className="size-4 animate-spin mr-2" />}
            {isLast ? "Finish quiz" : "Save & next"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export const QuizTakeViewLoading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
  </div>
);

export const QuizTakeViewError = () => (
  <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
    Failed to load the quiz. Please try again later.
  </div>
);
