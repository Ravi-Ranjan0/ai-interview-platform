import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/clients";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { roomsInsertSchema } from "../../schema";
import z from "zod";
import { toast } from "sonner";

interface RoomFormProps {
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}

export const RoomForm = ({ onSuccess, onCancel }: RoomFormProps) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const createRoom = useMutation(
    trpc.rooms.create.mutationOptions({
      onSuccess: async (data) => {
        await queryClient.invalidateQueries(trpc.rooms.getMany.queryOptions({}));
        onSuccess?.(data.id);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const form = useForm({
    resolver: zodResolver(roomsInsertSchema),
    defaultValues: { topic: "" },
  });

  const isPending = createRoom.isPending;

  const onSubmit = (values: z.infer<typeof roomsInsertSchema>) => {
    createRoom.mutate(values);
  };

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          name="topic"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Topic</FormLabel>
              <FormControl>
                <Input placeholder="e.g. System Design Interviews" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="flex justify-around gap-x-2">
          {onCancel && (
            <Button variant="ghost" disabled={isPending} type="button" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            Create
          </Button>
        </div>
      </form>
    </Form>
  );
};
