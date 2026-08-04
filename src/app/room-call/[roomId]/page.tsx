import { auth } from "@/lib/auth";
import { RoomCallView } from "@/modules/rooms/ui/views/room-call-view";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

interface Props {
    params: Promise<{
        roomId: string;
    }>;
}

const Page = async ({ params }: Props) => {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    if (!session) {
        redirect("/sign-in");
    }
    const { roomId } = await params;

    const queryClient = getQueryClient();
    void queryClient.prefetchQuery(
        trpc.rooms.getOne.queryOptions({
            id: roomId,
        })
    );

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <RoomCallView roomId={roomId} />
        </HydrationBoundary>
    )
};

export default Page;
