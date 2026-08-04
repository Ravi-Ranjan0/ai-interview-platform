"use client";

import { ErrorState } from "@/components/error-state";
import { useTRPC } from "@/trpc/clients";
import { useSuspenseQuery } from "@tanstack/react-query";
import { RoomCallProvider } from "../components/room-call-provider";
import { RoomStatus } from "../../type";

interface Props {
  roomId: string;
}

export const RoomCallView = ({ roomId }: Props) => {
  const trpc = useTRPC();
  const { data: room } = useSuspenseQuery(trpc.rooms.getOne.queryOptions({ id: roomId }));

  if (!room.isMember) {
    return (
      <div className="flex h-screen items-center justify-center">
        <ErrorState
          title="Join the room first"
          description="You need to be a member of this room before joining its call."
        />
      </div>
    );
  }

  if (room.status !== RoomStatus.Scheduled) {
    return (
      <div className="flex h-screen items-center justify-center">
        <ErrorState
          title="No call to join"
          description="This room doesn't have an active scheduled call right now."
        />
      </div>
    );
  }

  return <RoomCallProvider roomId={roomId} roomTopic={room.topic} />;
};
