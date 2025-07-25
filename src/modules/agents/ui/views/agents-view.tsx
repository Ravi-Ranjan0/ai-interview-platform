'use client'

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/clients";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { DataTable } from "../components/data-table";
import { columns } from "../components/columns";
import { EmptyState } from "@/components/empty-state";
import { useAgentsFilters } from "../../hooks/use-agents-filters";
import { DataPagination } from "../components/data-pagination";
import { useRouter } from "next/navigation";

export const AgentsView = () => {
    const router = useRouter();
    const [filters, setFilters] = useAgentsFilters();
    


    const trpc = useTRPC();
    const {data} = useSuspenseQuery(trpc.agents.getMany.queryOptions({
        ...filters,
    }));
    
    return (
        <div className="flex-1 pb-4 px-4 md:px-8 flex flex-col gap-y-4">
            <DataTable columns={columns} data={data.items}
            onRowClick={(row) => router.push(`/agents/${row.id}`)} />
            <DataPagination 
                page ={filters.page}
                totalPages = {data.totalPages}
                onPageChange={(page) => setFilters({page})}
            />
            {data.items.length === 0 &&(
                <EmptyState
                    title="Create Your First Agent"
                    description="Create a new agent to get started. Each agent can be customized with different settings and capabilities."
                />
            )}
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

