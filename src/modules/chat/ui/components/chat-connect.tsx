"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Send } from "lucide-react";
import { useTRPC } from "@/trpc/clients";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";

interface Props {
  conversationId: string;
  conversationName: string;
  userId: string;
  userName: string;
  userImage: string;
}

export const ChatConnect = ({
  conversationId,
  conversationName,
  userId,
  userName,
  userImage,
}: Props) => {
  const trpc = useTRPC();

  const [message, setMessage] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, refetch } = useSuspenseQuery(
    trpc.messages.getMessages.queryOptions({
      conversationId,
    })
  );

  const { mutateAsync: sendMessage } = useMutation(
    trpc.messages.addMessage.mutationOptions({
      onSuccess: () => refetch(),
    })
  );

  const handleSend = async () => {
    if (!message.trim()) return;

    await sendMessage({
      conversationId,
      sender: "user",
      content: message,
      userId, // ✅ IMPORTANT
    });

    setMessage("");
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col w-full max-w-2xl border rounded-xl overflow-hidden bg-white shadow-sm">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-gray-50">
        <Avatar>
          <AvatarImage src={userImage} />
          <AvatarFallback>{userName?.charAt(0)}</AvatarFallback>
        </Avatar>

        <div>
          <p className="font-semibold text-sm">{conversationName}</p>
          <p className="text-xs text-gray-500">Chat ID: {conversationId}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-gray-400 text-center">
            No messages yet. Say hello 👋
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.fromSelf ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                m.fromSelf
                  ? "bg-blue-500 text-white"
                  : "bg-gray-200 text-gray-800"
              }`}
            >
              {m.message}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 border-t p-3">
        <Input
          placeholder="Type your message…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="flex-1"
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <Button onClick={handleSend}>
          <Send size={18} />
        </Button>
      </div>
    </div>
  );
};
