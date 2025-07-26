


import { Button } from "@/components/ui/button";
import "@stream-io/video-react-sdk/dist/css/styles.css";
import { LogInIcon } from "lucide-react";
import Link from "next/link";



export const CallEnded = () => {
    return (
        <div className="flex flex-col items-center justify-center h-full bg-radial from-sidebar-accent to-sidebar ">
            <div className="py-4 px-8 flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center justify-center gap-y-6 bg-background rounded-lg p-10 shadow-sm">
                    <div className="flex flex-col text-center gap-y-2">
                        <h6 className="text-lg font-medium">You have ended the call</h6>
                        <p className="text-sm">Summary of the call will be updated shortly</p>
                    </div>
                    <Button asChild>
                        <Link href="/meetings">
                            <LogInIcon />
                            Back to Meetings
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
};