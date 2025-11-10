import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NewAgentDialog } from "@/modules/agents/ui/components/new-agent-dialog";
import { useTRPC } from "@/trpc/clients";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { conversationsInsertSchema } from "../../schema";
import { CommandSelect } from "@/components/command-select";
import { GeneratedAvatar } from "@/components/generated-avatar";
import z from "zod";
import { toast } from "sonner";

interface ConversationFormProps {
  onSuccess?: (id?: string) => void;
  onCancel?: () => void;
  initialValues?: any; //ConversationGetOne;
}

export const ConversationForm = ({
  onSuccess,
  onCancel,
  initialValues,
}: ConversationFormProps) => {
  const trpc = useTRPC();

  const queryClient = useQueryClient();

  const [openNewAgentDialog, setOpenNewAgentDialog] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");

  const agents = useQuery(
    trpc.agents.getMany.queryOptions({
      pageSize: 100,
      search: agentSearch,
    })
  );

  const createConversation = useMutation(
    trpc.conversations.create.mutationOptions({
      onSuccess: async (data) => {
        await queryClient.invalidateQueries(
          trpc.conversations.getMany.queryOptions({})
        );
        if(initialValues?.id) {
          await queryClient.invalidateQueries(
            trpc.conversations.getOne.queryOptions({ id: initialValues.id })
          );
        }
        onSuccess?.(data.id);
      },
      onError: (error) => {
        toast.error(error.message);

        //TODO :Check if error code is "FORBIDDEN," redirect to "/upgrade"
      },
    })
  );

  const form = useForm({
    resolver: zodResolver(conversationsInsertSchema),
    defaultValues: {
      title: initialValues?.title || "",
      agentId: initialValues?.agentId || "",
    },
  });

  const isEdit = !!initialValues?.id;
  const isPending = createConversation.isPending;

  const onSubmit = async (
    values: z.infer<typeof conversationsInsertSchema>
  ) => {
    if (isEdit) {
      console.log("Update Conversation not implemented yet");
    } else {
      createConversation.mutate(values);
      console.log("Create Conversation not implemented yet", values);
    }
  };

  return (
    <>
      <NewAgentDialog
        open={openNewAgentDialog}
        onOpenChange={setOpenNewAgentDialog}
      />
      <Form {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            name="title"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input placeholder="Conversation Title" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            name="agentId"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Agent</FormLabel>
                <FormControl>
                  <CommandSelect
                    options={(agents.data?.items ?? []).map((agent) => ({
                      id: agent.id,
                      value: agent.id,
                      children: (
                        <div className="flex items-center gap-x-2">
                          <GeneratedAvatar
                            seed={agent.name}
                            variant="bottsNeutral"
                            className="border size-6"
                          />
                          <span className="">{agent.name}</span>
                        </div>
                      ),
                    }))}
                    onSelect={field.onChange}
                    onSearch={setAgentSearch}
                    value={field.value}
                    placeholder="Select an agent"
                    isSearchable
                  />
                </FormControl>
                <FormDescription>
                  Not found what you&#39;re looking for?{" "}
                  <Button
                    className="text-primary hover:underline"
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => setOpenNewAgentDialog(true)}
                  >
                    Create a new agent
                  </Button>
                </FormDescription>
              </FormItem>
            )}
          />
          <div className="flex justify-around gap-x-2">
            {onCancel && (
              <Button
                variant="ghost"
                disabled={isPending}
                type="button"
                onClick={() => onCancel()}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={isPending}>
              {isEdit ? "" : "Create"}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
};
