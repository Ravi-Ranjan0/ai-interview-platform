"use client";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarClockIcon, LogOutIcon, PartyPopperIcon, SettingsIcon, VideoIcon, XCircleIcon } from "lucide-react";
import { RoomChat } from "../components/room-chat";
import { SchedulePanel } from "../components/schedule-panel";
import { ManageMembersDialog } from "../components/manage-members-dialog";
import { ROOM_STATUS_BADGE_VARIANT, RoomStatus } from "../../type";
import { authClient } from "@/lib/auth-client";

interface Props {
  roomId: string;
}

export const RoomIdView = ({ roomId }: Props) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [isManageMembersOpen, setIsManageMembersOpen] = useState(false);

  const { data: room } = useSuspenseQuery(trpc.rooms.getOne.queryOptions({ id: roomId }));

  const invalidateRoom = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.rooms.getOne.queryOptions({ id: roomId })),
      queryClient.invalidateQueries(trpc.rooms.getMany.queryOptions({})),
    ]);

  const markComplete = useMutation(
    trpc.rooms.markComplete.mutationOptions({
      onSuccess: async (result) => {
        await invalidateRoom();
        await queryClient.invalidateQueries(trpc.rooms.getMyBonusTotal.queryOptions());
        if (result.bonusAwarded) {
          toast.success("Session complete! Bonus points awarded to everyone.");
        } else if (result.completed) {
          toast.success("Session already marked complete.");
        } else {
          toast.success("Marked as complete. Waiting on the rest of the group.");
        }
      },
      onError: (e) => toast.error(e.message),
    })
  );

  const leave = useMutation(
    trpc.rooms.leave.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.rooms.getMany.queryOptions({}));
        router.push("/rooms");
      },
      onError: (e) => toast.error(e.message),
    })
  );

  const join = useMutation(
    trpc.rooms.join.mutationOptions({
      onSuccess: () => invalidateRoom(),
      onError: (e) => toast.error(e.message),
    })
  );

  const cancel = useMutation(
    trpc.rooms.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidateRoom();
        toast.success("Room cancelled.");
      },
      onError: (e) => toast.error(e.message),
    })
  );

  const isClosed = room.status === RoomStatus.Completed || room.status === RoomStatus.Cancelled;
  const isCreator = room.createdBy === session?.user.id;

  return (
    <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-4">
      <div className="flex flex-col gap-y-3">
        <div className="flex items-center justify-between gap-x-2 flex-wrap gap-y-2">
          <div className="flex items-center gap-x-3">
            <h1 className="text-xl font-medium">{room.topic}</h1>
            <Badge variant={ROOM_STATUS_BADGE_VARIANT[room.status] ?? "outline"} className="capitalize">
              {room.status}
            </Badge>
          </div>
          <div className="flex items-center gap-x-2">
            {room.status === RoomStatus.Scheduled && (
              <Button size="sm" variant="default" asChild>
                <Link href={`/room-call/${roomId}`}>
                  <VideoIcon className="size-4 mr-1" />
                  Join Call
                </Link>
              </Button>
            )}
            {!isClosed && (
              <Button
                size="sm"
                variant={room.completedByMe ? "outline" : "default"}
                disabled={room.completedByMe || markComplete.isPending}
                onClick={() => markComplete.mutate({ roomId })}
              >
                <PartyPopperIcon className="size-4 mr-1" />
                {room.completedByMe ? "Marked complete" : "Mark session complete"}
              </Button>
            )}
            {isCreator && !isClosed && (
              <Button
                size="sm"
                variant="ghost"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ roomId })}
              >
                <XCircleIcon className="size-4 mr-1" />
                Cancel Room
              </Button>
            )}
            {!isCreator && (
              <Button
                size="sm"
                variant="ghost"
                disabled={leave.isPending}
                onClick={() => leave.mutate({ roomId })}
              >
                <LogOutIcon className="size-4 mr-1" />
                Leave
              </Button>
            )}
          </div>
        </div>

        {room.scheduledAt && (
          <div className="flex items-center gap-x-1.5 text-sm text-muted-foreground">
            <CalendarClockIcon className="size-4" />
            Scheduled for {format(new Date(room.scheduledAt), "EEEE, MMM d · h:mm a")}
          </div>
        )}

        <div className="flex items-center gap-x-2">
          <div className="flex -space-x-2">
            {room.members.slice(0, 6).map((m) => (
              <GeneratedAvatar
                key={m.userId}
                variant="bottsNeutral"
                seed={m.name}
                className="size-7 border-2 border-background"
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {room.memberCount} {room.memberCount === 1 ? "member" : "members"}
          </span>
          {isCreator && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setIsManageMembersOpen(true)}
              >
                <SettingsIcon className="size-3 mr-1" />
                Manage
              </Button>
              <ManageMembersDialog
                roomId={roomId}
                creatorId={room.createdBy}
                members={room.members}
                open={isManageMembersOpen}
                onOpenChange={setIsManageMembersOpen}
              />
            </>
          )}
        </div>
      </div>

      {room.isMember ? (
        <Tabs defaultValue="discussion">
          <TabsList>
            <TabsTrigger value="discussion">Discussion</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
          </TabsList>
          <TabsContent value="discussion">
            <RoomChat roomId={roomId} disabled={isClosed} />
          </TabsContent>
          <TabsContent value="schedule">
            <SchedulePanel roomId={roomId} roomStatus={room.status} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="bg-card rounded-lg border flex flex-col items-center justify-center gap-y-3 py-16">
          <p className="text-sm text-muted-foreground">
            Join this room to chat and take part in scheduling.
          </p>
          <Button
            disabled={isClosed || join.isPending}
            onClick={() => join.mutate({ roomId })}
          >
            Join Room
          </Button>
        </div>
      )}
    </div>
  );
};

export const RoomIdViewLoading = () => {
  return (
    <LoadingState title="Loading room..." description="Please wait while we load this room." />
  );
};

export const RoomIdViewError = () => {
  return (
    <ErrorState
      title="Failed to load room"
      description="There was an error loading this room. Please try again."
    />
  );
};
