'use client'

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/clients";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";

export const AgentsView = () => {
    const trpc = useTRPC();
    const {data} = useSuspenseQuery(trpc.agents.getMany.queryOptions());

    return (
        <div>
            
            {JSON.stringify(data, null, 2)}
        </div>
    );
};

export const AgentsViewLoading = () => {
    return (
        <LoadingState title="Loading Agents" description="Please wait while we fetch the agents." />
    );
}

export const AgentsViewError = () => {
    return (
        <ErrorState title="Failed to load Agents" description="There was an error while fetching the agents. Please try again later." />
    );
};

