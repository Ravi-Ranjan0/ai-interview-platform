import {
  RoomsView,
  RoomsViewError,
  RoomsViewLoading,
} from "@/modules/rooms/ui/views/rooms-view";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { Suspense } from "react";
import { RoomsListHeader } from "@/modules/rooms/ui/components/rooms-list-header";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SearchParams } from "nuqs";
import { loadSearchParams } from "@/modules/rooms/params";

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
    trpc.rooms.getMany.queryOptions({
      ...filters,
    })
  );

  return (
    <>
      <RoomsListHeader />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<RoomsViewLoading />}>
          <ErrorBoundary fallback={<RoomsViewError />}>
            <RoomsView />
          </ErrorBoundary>
        </Suspense>
      </HydrationBoundary>
    </>
  );
};

export default Page;
