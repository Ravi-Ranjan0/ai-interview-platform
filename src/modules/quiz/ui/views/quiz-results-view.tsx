"use client";

import { useTRPC } from "@/trpc/clients";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2Icon } from "lucide-react";

interface Props {
  attemptId: string;
}

export const QuizResultsView = ({ attemptId }: Props) => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery({
    ...trpc.quiz.getAttempt.queryOptions({ attemptId }),
    // Grading runs asynchronously right after completion — poll until the
    // score lands instead of making the candidate refresh manually.
    refetchInterval: (query) => {
      const attempt = query.state.data?.attempt;
      if (!attempt) return false;
      return attempt.status === "completed" && attempt.overallScore === null ? 1500 : false;
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { attempt, questions } = data;
  const grading = attempt.status === "completed" && attempt.overallScore === null;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Quiz results</CardTitle>
          <CardDescription className="flex items-center gap-x-2">
            {attempt.status === "expired" ? (
              "This attempt expired before it was completed."
            ) : grading ? (
              <>
                <Loader2Icon className="size-3.5 animate-spin" />
                Grading in progress…
              </>
            ) : (
              `Overall score: ${attempt.overallScore}/100`
            )}
          </CardDescription>
        </CardHeader>
      </Card>

      {questions.map((q, i) => (
        <Card key={q.id}>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              {i + 1}. {q.questionText}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-y-3">
            <p className="text-sm whitespace-pre-wrap">
              {q.answerText || <span className="text-muted-foreground">No answer</span>}
            </p>
            {q.rating !== null && (
              <div className="flex items-start gap-x-2">
                <Badge variant="outline" className="shrink-0">{q.rating}/10</Badge>
                {q.feedback && <p className="text-xs text-muted-foreground">{q.feedback}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export const QuizResultsViewLoading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
  </div>
);

export const QuizResultsViewError = () => (
  <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
    Failed to load quiz results. Please try again later.
  </div>
);
