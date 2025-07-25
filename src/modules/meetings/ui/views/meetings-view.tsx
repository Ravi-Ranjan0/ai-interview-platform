'use client'

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/clients";
import { useSuspenseQuery } from "@tanstack/react-query";

export const MeetingsView = () => {
    const trpc = useTRPC();
    const {data} = useSuspenseQuery(trpc.meetings.getMany.queryOptions({}));
  return (
    <div>
        {JSON.stringify(data, null, 2)}
    </div>
  );
}

export const MeetingsViewLoading = () => {
    return (
        <LoadingState title="Loading Meetings" description="Please wait while we fetch the meetings." />
    );
}

export const MeetingsViewError = () => {
    return (
        <ErrorState title="Failed to load Meetings" description="There was an error while fetching the meetings. Please try again later." />
    );
};
