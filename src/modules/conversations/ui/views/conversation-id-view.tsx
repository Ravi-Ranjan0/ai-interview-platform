'use client';
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/clients";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

interface Props {
  conversationId: string;
}

export const ConversationIdView = ({ conversationId }: Props) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data } = useSuspenseQuery(
    trpc.conversations.getOne.queryOptions({
      id: conversationId,
    })
  );
  return (
    <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-4">
      <h1>Conversation: {data.title}</h1>
    </div>
  );
};

export const ConversationIdViewLoading = () => {
  return (
    <LoadingState
      title="Loading conversation..."
      description="Please wait while we load the conversation details."
    />
  );
};

export const ConversationIdViewError = () => {
  return (
    <ErrorState
      title="Failed to load conversation"
      description="There was an error loading the conversation details. Please try again."
    />
  );
};
