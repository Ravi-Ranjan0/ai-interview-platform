import { authClient } from "@/lib/auth-client";
import { generateAvatarUri } from "@/lib/avatar";
import { Loader2Icon } from "lucide-react";
import { ChatConnect } from "./chat-connect";

interface Props {
  conversationId: string;
  conversationName: string;
}

export const ChatProvider = ({ conversationId, conversationName }: Props) => {
  const { data, isPending } = authClient.useSession();

  if (!data || isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-radial from-sidebar-accent to-sidebar">
        <Loader2Icon className="size-6 animate-spin text-white" />
      </div>
    );
  }
  return (
    // Replace the following div with the actual ChatConnect component when available
    <ChatConnect
      conversationId={conversationId}
      conversationName={conversationName}
      userId={data.user.id}
      userName={data.user.name}
      userImage={
        data.user.image ??
        generateAvatarUri({ seed: data.user.name, variant: "initials" })
      }
    />
  );
};
