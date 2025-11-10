"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { ConversationsSearchFilter } from "./conversations-search-filters";
import { AgentIdFilter } from "@/modules/meetings/ui/components/agent-id-filter";
import { useConversationsFilters } from "../../hooks/use-conversations-filters";
import { DEFAULT_PAGE } from "@/constant";
import { PlusIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import { NewConversationDialog } from "./new-conversation-dialog";

export const ConversationsListHeader = () => {
  const [filters, setFilters] = useConversationsFilters();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const isAnyFilterModified = !!filters.search || !!filters.agentId;

  const onClearFilters = () => {
    setFilters({
      search: "",
      page: DEFAULT_PAGE,
      agentId: "",
    });
  };
  return (
    <>
      <NewConversationDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
      />
      <div className="py-4 px-4 md:px-8 flex flex-col gap-y-4">
        <div className="flex items-center justify-between">
          <h5 className="text-xl font-medium">Conversations</h5>
          <Button
            onClick={() => {
              setIsDialogOpen(true);
            }}
          >
            <PlusIcon className="size-4 mr-2" />
            New Conversation
          </Button>
        </div>
        <ScrollArea>
          <div className="flex items-center gap-x-2 p-1">
            <ConversationsSearchFilter />
            <AgentIdFilter />
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
