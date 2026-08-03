"use client";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { EmptyState } from "@/components/empty-state";
import { DataPagination } from "@/components/data-pagination";
import { useTRPC } from "@/trpc/clients";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useRoomsFilters } from "../../hooks/use-rooms-filters";
import { RoomCard } from "../components/room-card";

export const RoomsView = () => {
  const [filters, setFilters] = useRoomsFilters();
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.rooms.getMany.queryOptions({ ...filters }));

  return (
    <div className="flex-1 pb-4 px-4 md:px-8 flex flex-col gap-y-4">
      {data.items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
      <DataPagination
        page={filters.page}
        totalPages={data.totalPages}
        onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
      />
      {data.items.length === 0 && (
        <EmptyState
          title="Start Your First Discussion Room"
          description="Create a room around a topic so other candidates working on the same thing can join, chat, and agree on a time to talk."
        />
      )}
    </div>
  );
};

export const RoomsViewLoading = () => {
  return (
    <LoadingState
      title="Loading Discussion Rooms"
      description="Please wait while we fetch the rooms."
    />
  );
};

export const RoomsViewError = () => {
  return (
    <ErrorState
      title="Error Loading Discussion Rooms"
      description="There was an error loading the rooms. Please try again later."
    />
  );
};
