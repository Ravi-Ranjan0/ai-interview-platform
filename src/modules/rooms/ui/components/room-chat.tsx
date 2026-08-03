"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2Icon, SendHorizonalIcon, MessagesSquareIcon } from "lucide-react";
import { toast } from "sonner";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";

const POLL_INTERVAL_MS = 4000;

interface Props {
  roomId: string;
  disabled?: boolean;
}

export const RoomChat = ({ roomId, disabled }: Props) => {
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages, refetch } = useQuery({
    ...trpc.rooms.listMessages.queryOptions({ roomId }),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const sendMessage = useMutation(
    trpc.rooms.sendMessage.mutationOptions({
      onSuccess: () => refetch(),
      onError: (e) => toast.error(e.message),
    })
  );

  const handleSend = async () => {
    const content = input.trim();
    if (!content || sendMessage.isPending) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await sendMessage.mutateAsync({ roomId, content });
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
  const canSend = !disabled && !!input.trim() && !sendMessage.isPending;

  return (
    <div className="bg-card rounded-lg border flex flex-col h-[500px] overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!messages && (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {messages && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-y-3">
            <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
              <MessagesSquareIcon className="size-6 text-primary" />
            </div>
            <p className="text-sm font-medium">No messages yet</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              Say hello and start discussing the topic with the group.
            </p>
          </div>
        )}

        {rows.map((m) => {
          const isSelf = m.userId === session?.user.id;
          return (
            <div
              key={m.id}
              className={cn(
                "flex gap-x-2 animate-in fade-in slide-in-from-bottom-1 duration-200",
                isSelf ? "justify-end" : "justify-start"
              )}
            >
              {!isSelf && (
                <GeneratedAvatar
                  variant="bottsNeutral"
                  seed={m.senderName}
                  className="size-7 mt-0.5 shrink-0"
                />
              )}
              <div className={cn("flex flex-col gap-y-1 max-w-[75%]", isSelf ? "items-end" : "items-start")}>
                {!isSelf && (
                  <span className="text-xs text-muted-foreground px-1">{m.senderName}</span>
                )}
                <div
                  className={cn(
                    "px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap",
                    isSelf
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  )}
                >
                  {m.content}
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-x-2 rounded-2xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={disabled ? "This room is no longer open" : "Message the group…"}
            value={input}
            disabled={disabled || sendMessage.isPending}
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
