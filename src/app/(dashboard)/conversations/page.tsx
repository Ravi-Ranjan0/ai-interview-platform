import {
  ConversationsView,
  ConversationsViewError,
  ConversationsViewLoading,
} from "@/modules/conversations/ui/views/conversations-view";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { Suspense } from "react";
import { ConversationsListHeader } from "@/modules/conversations/ui/components/conversations-list-header";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SearchParams } from "nuqs";
import { loadSearchParams } from "@/modules/conversations/params";

interface Props {
  searchParams: Promise<SearchParams>;
}
const Page = async ({ searchParams }: Props) => {
  const filters = await loadSearchParams(searchParams);

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(
    trpc.conversations.getMany.queryOptions({
      ...filters,
    })
  );
  return (
    <>
      <ConversationsListHeader />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<ConversationsViewLoading />}>
          <ErrorBoundary fallback={<ConversationsViewError />}>
            <ConversationsView />
          </ErrorBoundary>
        </Suspense>
      </HydrationBoundary>
    </>
  );
};

export default Page;
