"use client";

import { ResponsiveDialog } from "@/components/responsive-dialog";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserXIcon } from "lucide-react";
import { toast } from "sonner";

interface Member {
  userId: string;
  name: string;
  image: string | null;
}

interface Props {
  roomId: string;
  creatorId: string;
  members: Member[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ManageMembersDialog = ({ roomId, creatorId, members, open, onOpenChange }: Props) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const removeMember = useMutation(
    trpc.rooms.removeMember.mutationOptions({
      onSuccess: async () => {
        toast.success("Member removed.");
        await queryClient.invalidateQueries(trpc.rooms.getOne.queryOptions({ id: roomId }));
      },
      onError: (e) => toast.error(e.message),
    })
  );

  return (
    <ResponsiveDialog
      title="Manage Members"
      description="Remove a member from this discussion room."
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-y-2">
        {members.map((member) => (
          <div key={member.userId} className="flex items-center gap-x-3 rounded-lg border px-3 py-2">
            <GeneratedAvatar variant="bottsNeutral" seed={member.name} className="size-7 shrink-0" />
            <span className="flex-1 text-sm font-medium truncate">
              {member.name}
              {member.userId === creatorId && (
                <span className="text-muted-foreground font-normal"> (creator)</span>
              )}
            </span>
            {member.userId !== creatorId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={removeMember.isPending}
                onClick={() => removeMember.mutate({ roomId, userId: member.userId })}
              >
                <UserXIcon className="size-4 mr-1" />
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>
    </ResponsiveDialog>
  );
};
