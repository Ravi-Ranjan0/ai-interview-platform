import { auth } from "@/lib/auth";
import { getQueryClient, trpc } from "@/trpc/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

interface Props{
    params: Promise<{
        conversationId: string;
    }>;
}

const Page = async ({params}: Props) => {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    if(!session){
        redirect("/sign-in");
    }

    const { conversationId } = await params;
    const queryClient = getQueryClient();
    void queryClient.prefetchQuery(
        // Prefetch conversation data here when the conversation router is implemented
        trpc.conversations.getOne.queryOptions({
            id: conversationId,
        })
    );

    return(
        // Return the conversation view component here when implemented
        <div>Conversation Page for ID: {conversationId}</div>
    );
}

export default Page;