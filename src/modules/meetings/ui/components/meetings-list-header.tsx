'use client';
import { Button } from "@/components/ui/button";
import { PlusIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import { DEFAULT_PAGE } from "@/constant";
import { NewMeetingDialog } from "./new-meeting-dialog";

export const MeetingsListHeader = () => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);


  return (
    <>
    <NewMeetingDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
    <div className="py-4 px-4 md:px-8 flex flex-col gap-y-4 ">
        <div className="flex items-center justify-between">
            <h5 className="text-xl font-medium">Meetings</h5>
            <Button onClick={() => {setIsDialogOpen(true)}}>
                <PlusIcon className="size-4 mr-2" />
                New Meeting
            </Button>

        </div>
        <div className="flex items-center gap-x-2 p-1">
          {/* <AgentsSearchFilter />
          {isAnyFilterModified && (
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              <XCircleIcon/>
              Clear Filters
            </Button>
          )}
          */}
        </div>
    </div>
    </>
  );
}