"use client";

import Link from "next/link";
import { useTRPC } from "@/trpc/clients";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2Icon, ClipboardListIcon } from "lucide-react";
import { format } from "date-fns";

interface Props {
  agentId: string;
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  completed: "Completed",
  expired: "Expired",
};

export const QuizSummary = ({ agentId }: Props) => {
  const trpc = useTRPC();
  const { data: attempts, isLoading } = useQuery(trpc.quiz.listAttempts.queryOptions({ agentId }));

  return (
    <div className="bg-white rounded-lg border">
      <div className="px-4 py-5 flex flex-col gap-y-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-y-1">
            <p className="text-lg font-medium">Pre-interview quiz</p>
            <p className="text-sm text-muted-foreground">
              Take a ~30-minute quiz about your background so the interviewer can ask more relevant questions.
            </p>
          </div>
          <Button asChild>
            <Link href={`/quiz/${agentId}`}>
              <ClipboardListIcon className="size-4 mr-2" />
              Take quiz
            </Link>
          </Button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && attempts && attempts.length > 0 && (
          <div className="flex flex-col gap-y-2 border-t pt-4">
            {attempts.map((attempt) => (
              <Link
                key={attempt.id}
                href={`/quiz/results/${attempt.id}`}
                className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-muted transition-colors"
              >
                <span className="text-sm text-muted-foreground">
                  {format(new Date(attempt.createdAt), "MMM d, yyyy h:mm a")}
                </span>
                <div className="flex items-center gap-x-2">
                  {attempt.status === "completed" && attempt.overallScore !== null && (
                    <Badge variant="outline">{attempt.overallScore}/100</Badge>
                  )}
                  <Badge variant="secondary">{STATUS_LABEL[attempt.status] ?? attempt.status}</Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
