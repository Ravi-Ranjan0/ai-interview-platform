import { StreamTheme, useCall } from "@stream-io/video-react-sdk";
import { useState } from "react";
import { RoomCallLobby } from "./room-call-lobby";
import { RoomCallActive } from "./room-call-active";
import { RoomCallEnded } from "./room-call-ended";

interface Props {
  roomId: string;
  roomTopic: string;
}

export const RoomCallUI = ({ roomId, roomTopic }: Props) => {
  const call = useCall();
  const [show, setShow] = useState<"lobby" | "call" | "ended">("lobby");

  const handleJoin = async () => {
    if (!call) return;
    await call.join();
    setShow("call");
  };

  const handleLeave = async () => {
    if (!call) return;

    // Unlike the 1:1 interview call, a discussion room is a group call —
    // one member leaving shouldn't end it for everyone else.
    await call.leave();
    setShow("ended");
  };

  return (
    <StreamTheme className="h-full bg-black">
      {show === "lobby" && <RoomCallLobby roomId={roomId} onJoin={handleJoin} />}
      {show === "call" && <RoomCallActive onLeave={handleLeave} roomTopic={roomTopic} />}
      {show === "ended" && <RoomCallEnded roomId={roomId} />}
    </StreamTheme>
  );
};
