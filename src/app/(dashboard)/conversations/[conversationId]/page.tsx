import { ChatView } from "@/modules/chat/ui/views/chat-view";
import { ConversationIdView, ConversationIdViewError, ConversationIdViewLoading } from "@/modules/conversations/ui/views/conversation-id-view";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

interface Props{
    params: Promise<{ conversationId: string }>;
}

const Page = async ({ params }: Props) => {
    const { conversationId } = await params;

    const queryClient = getQueryClient();
    void queryClient.prefetchQuery(
        trpc.conversations.getOne.queryOptions({
            id: conversationId,
        })
    );
    return(
        <HydrationBoundary state={dehydrate(queryClient)}>
            <Suspense fallback={<ConversationIdViewLoading />}>
            <ErrorBoundary fallback={<ConversationIdViewError />}>
                {/* <ConversationIdView conversationId={conversationId} /> */}
                <ChatView conversationId={conversationId} />
            </ErrorBoundary>
            </Suspense>
        </HydrationBoundary>
    )
};

export default Page;

