"use client";

import { useState } from "react";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2Icon, CheckIcon, ThumbsUpIcon } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { RoomStatus } from "../../type";

interface Props {
  roomId: string;
  roomStatus: string;
}

export const SchedulePanel = ({ roomId, roomStatus }: Props) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [slotTime, setSlotTime] = useState("");

  const { data: slots } = useQuery({
    ...trpc.rooms.listSlots.queryOptions({ roomId }),
    refetchInterval: 5000,
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.rooms.listSlots.queryOptions({ roomId })),
      queryClient.invalidateQueries(trpc.rooms.getOne.queryOptions({ id: roomId })),
    ]);

  const proposeSlot = useMutation(
    trpc.rooms.proposeSlot.mutationOptions({
      onSuccess: async () => {
        setSlotTime("");
        await invalidate();
      },
      onError: (e) => toast.error(e.message),
    })
  );

  const voteSlot = useMutation(
    trpc.rooms.voteSlot.mutationOptions({
      onSuccess: () => invalidate(),
      onError: (e) => toast.error(e.message),
    })
  );

  const finalizeSlot = useMutation(
    trpc.rooms.finalizeSlot.mutationOptions({
      onSuccess: async () => {
        toast.success("Time slot finalized for the group.");
        await Promise.all([invalidate(), queryClient.invalidateQueries(trpc.rooms.getMany.queryOptions({}))]);
      },
      onError: (e) => toast.error(e.message),
    })
  );

  const isOpen = roomStatus === RoomStatus.Open;

  const handlePropose = () => {
    if (!slotTime) return;
    proposeSlot.mutate({ roomId, slotTime: new Date(slotTime) });
  };

  return (
    <div className="bg-card rounded-lg border flex flex-col gap-y-4 p-4">
      {isOpen && (
        <div className="flex flex-col gap-y-2">
          <p className="text-sm font-medium">Propose a time</p>
          <div className="flex items-center gap-x-2">
            <Input
              type="datetime-local"
              value={slotTime}
              min={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
              onChange={(e) => setSlotTime(e.target.value)}
              className="max-w-[240px]"
            />
            <Button size="sm" disabled={!slotTime || proposeSlot.isPending} onClick={handlePropose}>
              {proposeSlot.isPending ? <Loader2Icon className="size-4 animate-spin" /> : "Propose"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-y-2">
        <p className="text-sm font-medium">Proposed times</p>
        {!slots && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        {slots && slots.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No one has proposed a time yet. Be the first.
          </p>
        )}
        <div className="flex flex-col gap-y-2">
          {slots?.map((slot) => (
            <div
              key={slot.id}
              className="flex items-center justify-between gap-x-2 rounded-lg border px-3 py-2"
            >
              <div className="flex flex-col gap-y-0.5">
                <span className="text-sm font-medium">
                  {format(new Date(slot.slotTime), "EEE, MMM d · h:mm a")}
                </span>
                <span className="text-xs text-muted-foreground">
                  Proposed by {slot.proposerName}
                </span>
              </div>
              <div className="flex items-center gap-x-2 shrink-0">
                <Badge variant="secondary">{slot.voteCount} votes</Badge>
                <Button
                  size="sm"
                  variant={slot.votedByMe ? "default" : "outline"}
                  disabled={!isOpen || voteSlot.isPending}
                  onClick={() => voteSlot.mutate({ slotId: slot.id })}
                >
                  <ThumbsUpIcon className="size-3.5" />
                  {slot.votedByMe ? "Voted" : "Vote"}
                </Button>
                {isOpen && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={finalizeSlot.isPending}
                    onClick={() => finalizeSlot.mutate({ slotId: slot.id })}
                  >
                    <CheckIcon className="size-3.5" />
                    Finalize
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
