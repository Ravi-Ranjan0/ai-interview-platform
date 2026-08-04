"use client";

import { useTRPC } from "@/trpc/clients";
import {
  Call,
  CallingState,
  StreamCall,
  StreamVideo,
  StreamVideoClient,
} from "@stream-io/video-react-sdk";

import "@stream-io/video-react-sdk/dist/css/styles.css";
import { useMutation } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { RoomCallUI } from "./room-call-ui";
import { publicEnv } from "@/lib/env.public";

interface Props {
  roomId: string;
  roomTopic: string;
  userId: string;
  userName: string;
  userImage: string;
}

export const RoomCallConnect = ({ roomId, roomTopic, userId, userName, userImage }: Props) => {
  const trpc = useTRPC();
  // Reuses the generic Stream token endpoint (registered under `meetings` but
  // not actually meeting-scoped — see meetings/server/procedures.ts).
  const { mutateAsync: generateToken } = useMutation(trpc.meetings.genrateToken.mutationOptions());
  const [client, setClient] = useState<StreamVideoClient>();

  useEffect(() => {
    const _client = new StreamVideoClient({
      apiKey: publicEnv.NEXT_PUBLIC_STREAM_VIDEO_API_KEY,
      user: { id: userId, name: userName, image: userImage },
      tokenProvider: generateToken,
    });
    setClient(_client);
    return () => {
      _client.disconnectUser();
      setClient(undefined);
    };
  }, [userId, userName, userImage, generateToken]);

  const [call, setCall] = useState<Call>();
  useEffect(() => {
    if (!client) return;
    const _call = client.call("default", roomId);
    _call.camera.disable();
    _call.microphone.disable();

    setCall(_call);

    return () => {
      if (_call.state.callingState !== CallingState.LEFT) {
        _call.leave();
        setCall(undefined);
      }
    };
  }, [client, roomId]);

  if (!client || !call) {
    return (
      <div className="flex h-screen items-center justify-center bg-radial from-sidebar-accent to-sidebar">
        <LoaderIcon className="size-6 animate-spin text-white" />
      </div>
    );
  }

  return (
    <StreamVideo client={client}>
      <StreamCall call={call}>
        <RoomCallUI roomId={roomId} roomTopic={roomTopic} />
      </StreamCall>
    </StreamVideo>
  );
};
