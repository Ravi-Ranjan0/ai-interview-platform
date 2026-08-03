"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClockIcon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ROOM_STATUS_BADGE_VARIANT, RoomGetMany } from "../../type";

interface RoomCardProps {
  room: RoomGetMany[number];
}

export const RoomCard = ({ room }: RoomCardProps) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const join = useMutation(
    trpc.rooms.join.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.rooms.getMany.queryOptions({}));
        router.push(`/rooms/${room.id}`);
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const handleOpen = () => {
    if (room.isMember) {
      router.push(`/rooms/${room.id}`);
    } else {
      join.mutate({ roomId: room.id });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-x-2">
          <CardTitle className="truncate">{room.topic}</CardTitle>
          <Badge variant={ROOM_STATUS_BADGE_VARIANT[room.status] ?? "outline"} className="capitalize shrink-0">
            {room.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-y-3">
        <div className="flex items-center gap-x-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-x-1">
            <UsersIcon className="size-3.5" />
            {room.memberCount} {room.memberCount === 1 ? "member" : "members"}
          </span>
          {room.scheduledAt && (
            <span className="flex items-center gap-x-1">
              <CalendarClockIcon className="size-3.5" />
              {format(new Date(room.scheduledAt), "MMM d, h:mm a")}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant={room.isMember ? "default" : "outline"}
          disabled={join.isPending}
          onClick={handleOpen}
        >
          {room.isMember ? "Open" : "Join & Open"}
        </Button>
      </CardContent>
    </Card>
  );
};
