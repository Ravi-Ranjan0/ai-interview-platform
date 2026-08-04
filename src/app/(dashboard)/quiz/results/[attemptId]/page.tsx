import {
  QuizResultsView,
  QuizResultsViewError,
  QuizResultsViewLoading,
} from "@/modules/quiz/ui/views/quiz-results-view";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import React, { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

interface Props {
  params: Promise<{ attemptId: string }>;
}

const Page = async ({ params }: Props) => {
  const { attemptId } = await params;

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.quiz.getAttempt.queryOptions({ attemptId }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="flex-1 py-4 px-4 md:px-8">
        <Suspense fallback={<QuizResultsViewLoading />}>
          <ErrorBoundary fallback={<QuizResultsViewError />}>
            <QuizResultsView attemptId={attemptId} />
          </ErrorBoundary>
        </Suspense>
      </div>
    </HydrationBoundary>
  );
};

export default Page;
