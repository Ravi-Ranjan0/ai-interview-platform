"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2Icon, Send, FileIcon } from "lucide-react";
import { toast } from "sonner";

type Source = {
  fileName?: string;
  url?: string;
  section?: string;
  score?: number;
};

function parseSources(metadata: string | null | undefined): Source[] {
  if (!metadata) return [];
  try {
    const parsed = JSON.parse(metadata) as { sources?: Source[] };
    return parsed.sources ?? [];
  } catch {
    return [];
  }
}

interface Props {
  agentId: string;
}

export const TestAgent = ({ agentId }: Props) => {
  const trpc = useTRPC();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const getOrCreate = useMutation(
    trpc.conversations.getOrCreateTest.mutationOptions({
      onSuccess: ({ id }) => setConversationId(id),
      onError: (e) => toast.error(e.message),
    })
  );

  useEffect(() => {
    if (!conversationId) getOrCreate.mutate({ agentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const messagesQuery = trpc.messages.getMessages.queryOptions(
    { conversationId: conversationId ?? "" },
    { enabled: !!conversationId }
  );
  const { data: messages, refetch } = useQuery({
    ...messagesQuery,
    // ponytail: poll only while waiting on the agent's reply (i.e. last msg is
    // ours). Upgrade path: subscribe via WS or event stream when we add one.
    refetchInterval: (q) => {
      const rows = q.state.data;
      if (!rows || rows.length === 0) return false;
      const last = rows[rows.length - 1];
      return last.sender === "user" ? 1500 : false;
    },
  });

  const sendMessage = useMutation(
    trpc.messages.addMessage.mutationOptions({
      onSuccess: () => refetch(),
      onError: (e) => toast.error(e.message),
    })
  );

  const handleSend = async () => {
    const content = input.trim();
    if (!content || !conversationId) return;
    setInput("");
    await sendMessage.mutateAsync({ conversationId, content });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const rows = messages ?? [];
  const waitingForReply = useMemo(() => {
    if (rows.length === 0) return false;
    return rows[rows.length - 1].sender === "user";
  }, [rows]);

  return (
    <div className="bg-white rounded-lg border flex flex-col h-[500px]">
      <div className="px-4 py-3 border-b">
        <p className="text-sm font-medium">Test this agent</p>
        <p className="text-xs text-muted-foreground">
          Send a message to exercise the RAG pipeline. Retrieved sources appear
          under each reply.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!conversationId && (
          <div className="flex items-center justify-center py-8">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {conversationId && rows.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No messages yet. Ask the agent something to see what it retrieves.
          </p>
        )}
        {rows.map((m, i) => {
          const sources = m.sender === "agent" ? parseSources(m.metadata) : [];
          return (
            <div
              key={i}
              className={`flex flex-col ${m.fromSelf ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                  m.fromSelf
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                {m.message}
              </div>
              {sources.length > 0 && (
                <div className="max-w-[85%] mt-1 text-xs text-muted-foreground">
                  <p className="mb-1">
                    Retrieved {sources.length} source{sources.length === 1 ? "" : "s"}:
                  </p>
                  <ul className="flex flex-col gap-y-1">
                    {sources.map((s, si) => (
                      <li key={si} className="flex items-center gap-x-1">
                        <FileIcon className="size-3 shrink-0" />
                        <span className="truncate">
                          {s.fileName ?? s.url ?? "knowledge base"}
                          {s.section ? ` · ${s.section}` : ""}
                          {typeof s.score === "number"
                            ? ` (${s.score.toFixed(2)})`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
        {waitingForReply && (
          <div className="flex items-center gap-x-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            Agent is thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 border-t p-3">
        <Input
          placeholder="Ask the agent about the uploaded documents…"
          value={input}
          disabled={!conversationId || sendMessage.isPending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
        />
        <Button
          type="button"
          disabled={!conversationId || !input.trim() || sendMessage.isPending}
          onClick={handleSend}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
};
