"use client";

import { ResponsiveDialog } from "@/components/responsive-dialog";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { useTRPC } from "@/trpc/clients";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon, TrophyIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const BonusLeaderboardDialog = ({ open, onOpenChange }: Props) => {
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const { data: leaderboard, isLoading } = useQuery({
    ...trpc.rooms.getBonusLeaderboard.queryOptions({ limit: 10 }),
    enabled: open,
  });

  return (
    <ResponsiveDialog
      title="Bonus Leaderboard"
      description="Top candidates by discussion room bonus points."
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-y-2">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && leaderboard?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No bonus points awarded yet. Complete a room with your group to be the first.
          </p>
        )}

        {leaderboard?.map((entry, i) => (
          <div
            key={entry.userId}
            className={cn(
              "flex items-center gap-x-3 rounded-lg border px-3 py-2",
              entry.userId === session?.user.id && "bg-accent"
            )}
          >
            <span className="w-5 text-sm font-medium text-muted-foreground shrink-0">
              {i === 0 ? <TrophyIcon className="size-4 text-yellow-500" /> : i + 1}
            </span>
            <GeneratedAvatar variant="bottsNeutral" seed={entry.name} className="size-7 shrink-0" />
            <span className="flex-1 text-sm font-medium truncate">
              {entry.name}
              {entry.userId === session?.user.id && (
                <span className="text-muted-foreground font-normal"> (you)</span>
              )}
            </span>
            <span className="text-sm font-semibold shrink-0">{entry.total} pts</span>
          </div>
        ))}
      </div>
    </ResponsiveDialog>
  );
};
