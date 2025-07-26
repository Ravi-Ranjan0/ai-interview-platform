import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { VideoIcon } from "lucide-react"
import Link from "next/link"

interface Props{
    meetingId: string;
}

export const ActiveState = ({ meetingId }: Props) => {
    return(
        <div className="bg-white rounded-lg px-4 py-5 flex flex-col gap-y-8 items-center">
            <EmptyState
            image="https://www.shutterstock.com/image-vector/time-date-reschedule-concept-illustration-600nw-2024194010.jpg"
            title="Meeting is Active"
            description="Meeting will end once all participants leave the call."
            />
            <div className="flex flex-col-reverse lg:flex-row lg:justify-center items-center gap-2">
            <Button asChild className="w-full lg:w-auto">
                <Link href={`/call/${meetingId}`}>
                    <VideoIcon />
                    Join Meeting
                </Link>
            </Button>
            </div>

        </div>
    )
}