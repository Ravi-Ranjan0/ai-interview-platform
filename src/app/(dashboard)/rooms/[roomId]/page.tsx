import {
  RoomIdView,
  RoomIdViewError,
  RoomIdViewLoading,
} from "@/modules/rooms/ui/views/room-id-view";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ roomId: string }>;
}

const Page = async ({ params }: Props) => {
  const { roomId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(
    trpc.rooms.getOne.queryOptions({ id: roomId })
  );

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<RoomIdViewLoading />}>
        <ErrorBoundary fallback={<RoomIdViewError />}>
          <RoomIdView roomId={roomId} />
        </ErrorBoundary>
      </Suspense>
    </HydrationBoundary>
  );
};

export default Page;
