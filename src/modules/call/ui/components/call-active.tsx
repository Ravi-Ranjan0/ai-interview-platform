import { CallControls, SpeakerLayout } from "@stream-io/video-react-sdk";
import { Link } from "lucide-react";

interface Props{
    onLeave: () => void;
    meetingName: string;
}

export const CallActive = ({ onLeave, meetingName }: Props) => {
    return(
        <div className="flex flex-col justify-between p-4 h-full text-white">
            <div className="bg-[#101213] rounded-full p-4 flex items-center gap-4">
                <Link href="/" className="flex items-center justify-center p-1 bg-white/10 rounded-full w-fit">
                <p className="w-20 h-20">Ai-Interview Platform</p>
                </Link>
                <h4 className="text-base font-semibold">{meetingName}</h4>
            </div>
            <SpeakerLayout/>
            <div className="bg-[#101213] rounded-full px-4">
               <CallControls
                   onLeave={onLeave}
               />
            </div>

        </div>
    )
}