import { EmptyState } from "@/components/empty-state"



export const CancelledState = () => {
    return(
        <div className="bg-white rounded-lg px-4 py-5 flex flex-col gap-y-8 items-center">
            <EmptyState
            image="https://www.shutterstock.com/image-vector/time-date-reschedule-concept-illustration-600nw-2024194010.jpg"
            title="Meeting Cancelled"
            description="Meeting has been cancelled"
            />

        </div>
    )
}