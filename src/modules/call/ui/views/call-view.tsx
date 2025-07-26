'use client';
import { ErrorState } from "@/components/error-state";
import { useTRPC } from "@/trpc/clients";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CallProvider } from "../components/call-provider";

interface Props{
    meetingId: string;
}

export const CallView = ({ meetingId }: Props) => {
    const trpc = useTRPC();
    const {data} = useSuspenseQuery(
        trpc.meetings.getOne.queryOptions({
            id: meetingId,
        })
    )

    if(data.status === "completed"){
        return(
            <div className="flex h-screen items-center justify-center">
                <ErrorState
                    title="Meeting has ended"
                    description="This meeting has already been completed. So, you cannot join it."
                />
            </div>
        )
    }
    return(
        <CallProvider meetingId={meetingId} meetingName={data.name} />
    )
}
