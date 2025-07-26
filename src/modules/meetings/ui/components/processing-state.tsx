import { EmptyState } from "@/components/empty-state"



export const ProcessingState = () => {
    return(
        <div className="bg-white rounded-lg px-4 py-5 flex flex-col gap-y-8 items-center">
            <EmptyState
            image="https://www.shutterstock.com/image-vector/time-date-reschedule-concept-illustration-600nw-2024194010.jpg"
            title="Meeting Completed"
            description="Meeting was completed but is currently being processed. Please wait for a few moments."
            />

        </div>
    )
}   