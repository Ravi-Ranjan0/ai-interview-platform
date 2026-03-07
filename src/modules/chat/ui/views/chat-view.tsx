'use client'
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/clients";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ChatProvider } from "../components/chat-provider";

interface Props {
  conversationId: string;
}

export const ChatView = ({ conversationId }: Props) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(
    trpc.conversations.getOne.queryOptions({
      id: conversationId,
    })
  );
  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState
          title="Loading conversation..."
          description="Please wait while we load the conversation."
        />
      </div>
    );
  }
  return (
    <ChatProvider
      conversationId={conversationId}
      conversationName={data.title}
    />
  );
};
