import { CallControls, SpeakerLayout } from "@stream-io/video-react-sdk";
import Link from "next/link";

interface Props {
  onLeave: () => void;
  roomTopic: string;
}

export const RoomCallActive = ({ onLeave, roomTopic }: Props) => {
  return (
    <div className="flex flex-col justify-between h-full p-6 bg-gradient-to-b from-gray-900 to-black text-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-bold text-blue-400 hover:underline">
            AI Interview Platform
          </Link>
          <h4 className="text-lg font-medium text-gray-300">{roomTopic}</h4>
        </div>
      </div>

      <div className="flex-1 mt-6 flex flex-col items-center gap-6">
        <SpeakerLayout />
      </div>

      <div className="mt-6">
        <CallControls onLeave={onLeave} />
      </div>
    </div>
  );
};
