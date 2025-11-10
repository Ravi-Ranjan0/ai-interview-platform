import { ResponsiveDialog } from "@/components/responsive-dialog";
import { useRouter } from "next/navigation";
import { ConversationForm } from "./conversation-form";

interface NewConversationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}
export const NewConversationDialog = ({ open, onOpenChange }: NewConversationDialogProps) => {
    const router = useRouter();
    return(
        <ResponsiveDialog
            title="New Conversation"
            description="Fill in the details to create a new conversation."
            open={open}
            onOpenChange={onOpenChange}
        >
            <ConversationForm
                onSuccess={() => {
                    onOpenChange(false);
                }}
                onCancel={() => {
                    onOpenChange(false);
                }}
            />
        </ResponsiveDialog>
    )
    
}