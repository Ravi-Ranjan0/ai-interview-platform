"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { RoomsSearchFilter } from "./rooms-search-filter";
import { useRoomsFilters } from "../../hooks/use-rooms-filters";
import { DEFAULT_PAGE } from "@/constant";
import { PlusIcon, XCircleIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { NewRoomDialog } from "./new-room-dialog";
import { BonusLeaderboardDialog } from "./bonus-leaderboard-dialog";
import { RoomStatusFilter } from "./room-status-filter";
import { useTRPC } from "@/trpc/clients";
import { useQuery } from "@tanstack/react-query";

export const RoomsListHeader = () => {
  const [filters, setFilters] = useRoomsFilters();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const trpc = useTRPC();

  const { data: bonusTotal } = useQuery(trpc.rooms.getMyBonusTotal.queryOptions());

  const isAnyFilterModified = !!filters.search || !!filters.status;

  const onClearFilters = () => {
    setFilters({ search: "", page: DEFAULT_PAGE, status: null });
  };

  return (
    <>
      <NewRoomDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
      <BonusLeaderboardDialog open={isLeaderboardOpen} onOpenChange={setIsLeaderboardOpen} />
      <div className="py-4 px-4 md:px-8 flex flex-col gap-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-x-3">
            <h5 className="text-xl font-medium">Discussion Rooms</h5>
            <Badge
              variant="secondary"
              className="gap-x-1 cursor-pointer hover:bg-secondary/70"
              onClick={() => setIsLeaderboardOpen(true)}
            >
              <SparklesIcon className="size-3" />
              {bonusTotal ?? 0} bonus points
            </Badge>
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>
            <PlusIcon className="size-4 mr-2" />
            New Discussion
          </Button>
        </div>
        <ScrollArea>
          <div className="flex items-center gap-x-2 p-1">
            <RoomsSearchFilter />
            <RoomStatusFilter />
            {isAnyFilterModified && (
              <Button variant="outline" size="sm" onClick={onClearFilters}>
                <XCircleIcon className="size-4" />
                Clear Filters
              </Button>
            )}
            <ScrollBar orientation="horizontal" />
          </div>
        </ScrollArea>
      </div>
    </>
  );
};
