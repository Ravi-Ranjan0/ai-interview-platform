'use client';
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { MeetingIdViewHeader } from "../components/meeting-id-view-headers";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useConfirm } from "../../hooks/use-confirm";
import { UpdateMeetingDialog } from "../components/update-meeting-dialog";
import { useState } from "react";
import { UpcomingState } from "../components/upcoming-state";
import { ActiveState } from "../components/active-state";
import { CancelledState } from "../components/cancelled-state";
import { ProcessingState } from "../components/processing-state";
import { CompletedState } from "../components/completed-state";

interface Props {
  meetingId: string;
}

const MeetingIdView = ({ meetingId }: Props) => {

    const trpc = useTRPC();
    const router = useRouter();
    const queryClient = useQueryClient();
    const {data} = useSuspenseQuery(
        trpc.meetings.getOne.queryOptions({
            id: meetingId,
        })
    )


    const[updateMeetingDialogOpen, setUpdateMeetingDialogOpen] = useState(false);
    const [RemoveConfirmation, confirmRemove] = useConfirm("Are you sure?", `This action will remove all this meetings. Please confirm if you want to proceed.`);
    

    const removeMeeting = useMutation(
      trpc.meetings.remove.mutationOptions({
        onSuccess: () => {
          queryClient.invalidateQueries(trpc.meetings.getMany.queryOptions({}));
          router.push("/meetings");
        },
      })
    );

    const handleRemoveMeeting = async() => {
      const ok = await confirmRemove();
      if (!ok) return;
      await removeMeeting.mutateAsync({ id: meetingId });
    }

    const isActive = data.status === "active";
    const isUpcoming = data.status === "upcoming";
    const isCompleted = data.status === "completed";
    const isCancelled = data.status === "cancelled";
    const isProcessing = data.status === "processing";


  return (
    <>
    <RemoveConfirmation />
    <UpdateMeetingDialog
      open={updateMeetingDialogOpen}
      onOpenChange={setUpdateMeetingDialogOpen}
      initialValues={data}
    />
    <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-4">
      <MeetingIdViewHeader
        meetingId={meetingId}
        meetingName={data.name}
        onEdit={() => setUpdateMeetingDialogOpen(true)}
        onRemove={handleRemoveMeeting}
      />
      {isCancelled && (
        <CancelledState />
      )}
      {isCompleted && <CompletedState data={data} />}
      {isUpcoming && (<UpcomingState 
                meetingId={meetingId} 
                onCancelMeeting={() => {}} 
                isCancelling={false} />
      )}
      {isActive && (<ActiveState meetingId={meetingId} />)}
      {isProcessing && (<ProcessingState />)}
    </div>
    </>
  );
};

export default MeetingIdView;


export const MeetingIdViewLoading = () => {
  return (
    <LoadingState
      title="Loading Meeting"
      description="Please wait while we fetch the meeting."
    />
  );
};

export const MeetingIdViewError = () => {
  return (
    <ErrorState
      title="Failed to load Meeting"
      description="There was an error while fetching the meeting. Please try again later."
    />
  );
};
