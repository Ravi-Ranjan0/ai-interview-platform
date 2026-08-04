import {
  QuizTakeView,
  QuizTakeViewError,
  QuizTakeViewLoading,
} from "@/modules/quiz/ui/views/quiz-take-view";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import React, { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

interface Props {
  params: Promise<{ agentId: string }>;
}

const Page = async ({ params }: Props) => {
  const { agentId } = await params;

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.agents.getOne.queryOptions({ id: agentId }));
  void queryClient.prefetchQuery(trpc.quiz.getActive.queryOptions({ agentId }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="flex-1 py-4 px-4 md:px-8">
        <Suspense fallback={<QuizTakeViewLoading />}>
          <ErrorBoundary fallback={<QuizTakeViewError />}>
            <QuizTakeView agentId={agentId} />
          </ErrorBoundary>
        </Suspense>
      </div>
    </HydrationBoundary>
  );
};

export default Page;
