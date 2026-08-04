"use client";

import { authClient } from "@/lib/auth-client";
import { Loader2Icon } from "lucide-react";
import { RoomCallConnect } from "./room-call-connect";
import { generateAvatarUri } from "@/lib/avatar";

interface Props {
  roomId: string;
  roomTopic: string;
}

export const RoomCallProvider = ({ roomId, roomTopic }: Props) => {
  const { data, isPending } = authClient.useSession();

  if (!data || isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-radial from-sidebar-accent to-sidebar">
        <Loader2Icon className="size-6 animate-spin text-white" />
      </div>
    );
  }

  return (
    <RoomCallConnect
      roomId={roomId}
      roomTopic={roomTopic}
      userId={data.user.id}
      userName={data.user.name}
      userImage={data.user.image ?? generateAvatarUri({ seed: data.user.name, variant: "initials" })}
    />
  );
};
