"use client";

import { useTRPC } from "@/trpc/clients";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2Icon, LinkIcon, RefreshCwIcon } from "lucide-react";
import humanizeDuration from "humanize-duration";

const STATUS_STYLES: Record<string, string> = {
  idle: "bg-neutral-100 text-neutral-700",
  pending: "bg-neutral-100 text-neutral-700",
  processing: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

function parseUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

interface Props {
  agentId: string;
}

export const AgentUrls = ({ agentId }: Props) => {
  const trpc = useTRPC();

  const agentQuery = trpc.agents.getOne.queryOptions({ id: agentId });
  const { data: agent } = useQuery({
    ...agentQuery,
    // Poll while a crawl is in flight; stop otherwise.
    refetchInterval: (q) => {
      const s = q.state.data?.urlsStatus;
      return s === "pending" || s === "processing" ? 3000 : false;
    },
  });

  const recrawl = useMutation(
    trpc.agents.recrawlUrls.mutationOptions({
      onSuccess: () => toast.success("Re-crawl queued"),
      onError: (e) => toast.error(e.message),
    })
  );

  if (!agent) return null;

  const urls = parseUrls(agent.urls);
  const status = agent.urlsStatus ?? "idle";
  const inFlight = status === "pending" || status === "processing";
  const lastAt = agent.urlsUpdatedAt ? new Date(agent.urlsUpdatedAt) : null;

  return (
    <div className="bg-white rounded-lg border p-4 flex flex-col gap-y-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <p className="text-sm font-medium">Crawled URLs ({urls.length})</p>
          <p className="text-xs text-muted-foreground">
            Re-crawling replaces this agent's URL-sourced knowledge with fresh content.
          </p>
        </div>
        <div className="flex items-center gap-x-2">
          <Badge variant="outline" className={STATUS_STYLES[status] ?? ""}>
            {status}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={inFlight || urls.length === 0 || recrawl.isPending}
            onClick={() => recrawl.mutate({ id: agentId })}
          >
            {inFlight ? (
              <Loader2Icon className="size-4 animate-spin mr-2" />
            ) : (
              <RefreshCwIcon className="size-4 mr-2" />
            )}
            {inFlight ? "Crawling…" : "Re-crawl"}
          </Button>
        </div>
      </div>

      {urls.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2 text-center">
          No URLs configured. Add URLs by editing the agent.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {urls.map((u) => (
            <li key={u} className="flex items-center gap-x-2 py-2 min-w-0">
              <LinkIcon className="size-4 shrink-0 text-neutral-500" />
              <a
                href={u}
                target="_blank"
                rel="noreferrer"
                className="text-sm truncate hover:underline"
              >
                {u}
              </a>
            </li>
          ))}
        </ul>
      )}

      {status === "failed" && agent.urlsError && (
        <p className="text-xs text-red-600">Last crawl failed: {agent.urlsError}</p>
      )}
      {status === "completed" && agent.urlsError && (
        <p className="text-xs text-amber-600">{agent.urlsError}</p>
      )}
      {lastAt && (
        <p className="text-xs text-muted-foreground">
          Last crawled{" "}
          {humanizeDuration(Date.now() - lastAt.getTime(), {
            largest: 1,
            round: true,
          })}{" "}
          ago
        </p>
      )}
    </div>
  );
};
