"use client";

import {
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2Icon, SendHorizonalIcon, FileIcon, LinkIcon, SparklesIcon, AlertTriangleIcon } from "lucide-react";
import { toast } from "sonner";
import Markdown from "react-markdown";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { cn } from "@/lib/utils";

type Source = {
  fileName?: string;
  url?: string;
  section?: string;
  source?: string;
  score?: number;
  matchedLexical?: boolean;
};

type ReplyMeta = {
  sources: Source[];
  retrievalError: string | null;
};

function parseMeta(metadata: string | null | undefined): ReplyMeta {
  if (!metadata) return { sources: [], retrievalError: null };
  try {
    const parsed = JSON.parse(metadata) as {
      sources?: Source[];
      retrievalError?: string;
    };
    return {
      sources: parsed.sources ?? [],
      retrievalError: parsed.retrievalError ?? null,
    };
  } catch {
    return { sources: [], retrievalError: null };
  }
}

function sourceLabel(s: Source): string {
  if (s.fileName) return s.fileName;
  if (s.url) {
    try {
      return new URL(s.url).hostname.replace(/^www\./, "");
    } catch {
      return s.url;
    }
  }
  if (!s.source) return "knowledge base";
  if (s.source === "quiz") return "your quiz answers";
  if (s.source === "interview") return "a past interview summary";
  // Hybrid retrieval now sends everything through `source` (fileName or the
  // page URL) rather than separate fileName/url fields — parse it as a URL
  // when it is one, otherwise show it as-is (e.g. a document's fileName).
  try {
    return new URL(s.source).hostname.replace(/^www\./, "");
  } catch {
    return s.source;
  }
}

function isLinkSource(s: Source): boolean {
  if (s.url) return true;
  if (!s.source) return false;
  return /^https?:\/\//i.test(s.source);
}

const MARKDOWN_COMPONENTS = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="text-lg font-semibold mt-2 mb-2" {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="text-base font-semibold mt-2 mb-2" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-sm font-semibold mt-2 mb-1" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="leading-relaxed [&:not(:last-child)]:mb-2" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="list-disc list-inside space-y-1 [&:not(:last-child)]:mb-2" {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="list-decimal list-inside space-y-1 [&:not(:last-child)]:mb-2" {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold" {...props} />
  ),
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code className="bg-muted-foreground/10 px-1.5 py-0.5 rounded text-[0.85em] font-mono" {...props} />
  ),
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="bg-muted-foreground/10 p-3 rounded-md overflow-x-auto text-[0.85em] font-mono [&:not(:last-child)]:mb-2" {...props} />
  ),
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="border-l-2 border-muted-foreground/40 pl-3 italic my-2" {...props} />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="underline underline-offset-2 hover:text-primary" target="_blank" rel="noreferrer" {...props} />
  ),
};

interface Props {
  agentId: string;
  agentName: string;
}

export const AgentChat = ({ agentId, agentName }: Props) => {
  const trpc = useTRPC();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [showSourcesFor, setShowSourcesFor] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getOrCreate = useMutation(
    trpc.conversations.getOrCreateChat.mutationOptions({
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
    // Poll while waiting on the agent (last message is user's).
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
    if (!content || !conversationId || sendMessage.isPending) return;
    setInput("");
    // Reset textarea height after send
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await sendMessage.mutateAsync({ conversationId, content });
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const rows = messages ?? [];
  const waitingForReply = useMemo(() => {
    if (rows.length === 0) return false;
    return rows[rows.length - 1].sender === "user";
  }, [rows]);

  const canSend = !!conversationId && !!input.trim() && !sendMessage.isPending;

  return (
    <div className="bg-card rounded-lg border flex flex-col h-[600px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-x-3 px-4 py-3 border-b">
        <GeneratedAvatar
          variant="bottsNeutral"
          seed={agentName}
          className="size-8"
        />
        <div className="flex flex-col min-w-0">
          <p className="text-sm font-medium truncate">Chat with {agentName}</p>
          <p className="text-xs text-muted-foreground">
            Ask a question — this agent answers from its uploaded documents and crawled URLs.
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!conversationId && (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {conversationId && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-y-3">
            <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
              <SparklesIcon className="size-6 text-primary" />
            </div>
            <div className="flex flex-col gap-y-1 max-w-sm">
              <p className="text-sm font-medium">Chat with {agentName}</p>
              <p className="text-xs text-muted-foreground">
                Ask something — this agent answers from the documents you've uploaded and the URLs you've crawled.
              </p>
            </div>
          </div>
        )}

        {rows.map((m, i) => {
          const isUser = m.sender === "user";
          const meta = !isUser ? parseMeta(m.metadata) : { sources: [], retrievalError: null };
          const { sources, retrievalError } = meta;
          const sourcesOpen = showSourcesFor === i;

          return (
            <div
              key={i}
              className={cn(
                "flex gap-x-2 animate-in fade-in slide-in-from-bottom-1 duration-200",
                isUser ? "justify-end" : "justify-start"
              )}
            >
              {!isUser && (
                <GeneratedAvatar
                  variant="bottsNeutral"
                  seed={agentName}
                  className="size-7 mt-0.5 shrink-0"
                />
              )}
              <div
                className={cn(
                  "flex flex-col gap-y-1.5 max-w-[85%]",
                  isUser ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap",
                    isUser
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  )}
                >
                  {isUser ? (
                    m.message
                  ) : (
                    <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                      <Markdown components={MARKDOWN_COMPONENTS}>
                        {m.message}
                      </Markdown>
                    </div>
                  )}
                </div>

                {retrievalError && (
                  <div className="flex items-center gap-x-1 text-xs text-amber-600">
                    <AlertTriangleIcon className="size-3 shrink-0" />
                    <span>Sources unavailable — reply is from instructions only.</span>
                  </div>
                )}
                {sources.length > 0 && (
                  <div className="flex flex-col gap-y-1.5 max-w-full">
                    <button
                      type="button"
                      onClick={() =>
                        setShowSourcesFor(sourcesOpen ? null : i)
                      }
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-x-1 self-start"
                    >
                      <span>
                        {sourcesOpen ? "Hide" : "Show"} {sources.length} source
                        {sources.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    {sourcesOpen && (
                      <div className="flex flex-wrap gap-1.5">
                        {sources.map((s, si) => {
                          const Icon = isLinkSource(s) ? LinkIcon : FileIcon;
                          return (
                            <Badge
                              key={si}
                              variant="outline"
                              className="gap-x-1 font-normal max-w-full"
                            >
                              <Icon className="size-3 shrink-0" />
                              <span className="truncate">
                                {sourceLabel(s)}
                                {s.section ? ` · ${s.section}` : ""}
                              </span>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {waitingForReply && (
          <div className="flex gap-x-2 animate-in fade-in duration-200">
            <GeneratedAvatar
              variant="bottsNeutral"
              seed={agentName}
              className="size-7 mt-0.5 shrink-0"
            />
            <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-muted flex items-center gap-x-1">
              <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
              <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
              <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex items-end gap-x-2 rounded-2xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={`Ask ${agentName} anything…`}
            value={input}
            disabled={!conversationId || sendMessage.isPending}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize(e.currentTarget);
            }}
            onKeyDown={handleKey}
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50 max-h-40"
          />
          <Button
            type="button"
            size="icon"
            disabled={!canSend}
            onClick={handleSend}
            className="shrink-0 size-8 rounded-full"
          >
            <SendHorizonalIcon className="size-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground px-1">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
};
