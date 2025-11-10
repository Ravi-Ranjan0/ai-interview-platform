"use client";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/clients";
import { useSuspenseQuery } from "@tanstack/react-query";
import { columns } from "../components/columns";
import { EmptyState } from "@/components/empty-state";
import { useConversationsFilters } from "../../hooks/use-conversations-filters";
import { DataPagination } from "@/components/data-pagination";
import { useRouter } from "next/navigation"
import { DataTable } from "@/components/data-table";

export const ConversationsView = () => {
    const router = useRouter();
    const [filters, setFilters] = useConversationsFilters();
    const trpc = useTRPC();
    const { data } = useSuspenseQuery(trpc.conversations.getMany.queryOptions({
        ...filters,
    }));
    return(
        <div className="flex-1 pb-4 px-4 md:px-8 flex flex-col gap-y-4">
            <DataTable data={data.items} columns={columns} onRowClick={(row) => router.push(`/conversations/${row.id}`)} />
            <DataPagination
                page={filters.page}
                totalPages={data.totalPages}
                onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
            />
            {data.items.length === 0 && (
                <EmptyState
                    title="Create Your First Conversation"
                    description="Create a new conversation to get started. Each conversation can be customized with different settings and capabilities."
                />
            )}
        </div>
    );
};

export const ConversationsViewLoading = () => {
    return(
        <LoadingState
            title="Loading Conversations"
            description="Please wait while we fetch the conversations."
        />
    )
}

export const ConversationsViewError = () => {
    return(
        <ErrorState
            title="Error Loading Conversations"
            description="There was an error loading your conversations. Please try again later."
        />
    )
}