import { ResponsiveDialog } from "@/components/responsive-dialog";
import { useRouter } from "next/navigation";
import { RoomForm } from "./room-form";

interface NewRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const NewRoomDialog = ({ open, onOpenChange }: NewRoomDialogProps) => {
  const router = useRouter();
  return (
    <ResponsiveDialog
      title="New Discussion Room"
      description="Start a room for others to discuss the same topic with you."
      open={open}
      onOpenChange={onOpenChange}
    >
      <RoomForm
        onSuccess={(id) => {
          onOpenChange(false);
          router.push(`/rooms/${id}`);
        }}
        onCancel={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
};
