"use client";

import { useTRPC } from "@/trpc/clients";
import { AgentGetOne } from "../../type";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { agentsInsertSchema } from "../../schema";
import z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState } from "react";
import { useUploadThing } from "@/lib/uploadthing-client";
import { Loader2Icon } from "lucide-react";

interface AgentFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  initialValues?: AgentGetOne;
}

function getMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

export const AgentForm = ({
  onSuccess,
  onCancel,
  initialValues,
}: AgentFormProps) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);

  const { startUpload } = useUploadThing("documentUploader");

  const createDocument = useMutation(
    trpc.documents.create.mutationOptions({})
  );

  const createAgent = useMutation(
    trpc.agents.create.mutationOptions({
      onSuccess: async (createdAgent) => {
        await queryClient.invalidateQueries(
          trpc.agents.getMany.queryOptions({})
        );

        // Upload pending files after agent creation
        if (pendingFiles.length > 0) {
          setIsUploadingFiles(true);
          try {
            const uploaded = await startUpload(pendingFiles);
            if (uploaded) {
              for (const file of uploaded) {
                await createDocument.mutateAsync({
                  agentId: createdAgent.id,
                  fileName: file.name,
                  fileUrl: file.url,
                  fileSize: file.size,
                  mimeType: getMimeType(file.name),
                });
              }
              toast.success(
                `${uploaded.length} document(s) uploaded and queued for processing`
              );
            }
          } catch (error) {
            toast.error("Failed to upload documents. You can upload them later from the Knowledge Base tab.");
          } finally {
            setIsUploadingFiles(false);
            setPendingFiles([]);
          }
        }

        onSuccess?.();
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const updateAgent = useMutation(
    trpc.agents.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.agents.getMany.queryOptions({})
        );
        onSuccess?.();
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const form = useForm<z.infer<typeof agentsInsertSchema>>({
    resolver: zodResolver(agentsInsertSchema),
    defaultValues: {
      name: initialValues?.name || "",
      instructions: initialValues?.instructions || "",
      urls:
        Array.isArray(initialValues?.urls)
          ? initialValues.urls
          : typeof initialValues?.urls === "string"
          ? initialValues.urls
              .split(/[\n,]+/)
              .map((u) => u.trim())
              .filter(Boolean)
          : [],
    },
  });

  const isEdit = !!initialValues?.id;
  const isPending =
    createAgent.isPending || updateAgent.isPending || isUploadingFiles;

  const onSubmit = (values: z.infer<typeof agentsInsertSchema>) => {
    if (isEdit) {
      updateAgent.mutate({ ...values, id: initialValues.id });
    } else {
      createAgent.mutate(values);
    }
  };

  return (
    <>
      <Form {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <GeneratedAvatar
            seed={form.watch("name")}
            variant="bottsNeutral"
            className="border size-16"
          />
          <FormField
            name="name"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Enter agent name" />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            name="instructions"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Instructions</FormLabel>
                <FormControl>
                  <Textarea {...field} placeholder="Enter agent instructions" />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            name="urls"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Web URLs (optional)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Enter one or more URLs (comma or newline separated)"
                    onChange={(e) => {
                      const urls = e.target.value
                        .split(/[\n,]+/)
                        .map((url) => url.trim())
                        .filter(Boolean);
                      field.onChange(urls);
                    }}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          {!isEdit && (
            <FormItem>
              <FormLabel>Upload Documents (optional)</FormLabel>
              <FormControl>
                <Input
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setPendingFiles(files);
                  }}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Supported: PDF, DOCX, TXT (max 16MB each). You can also upload
                more files later from the Knowledge Base tab.
              </p>
              {pendingFiles.length > 0 && (
                <p className="text-xs text-blue-600">
                  {pendingFiles.length} file(s) selected - will be uploaded
                  after agent creation
                </p>
              )}
            </FormItem>
          )}
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
              {isPending && (
                <Loader2Icon className="size-4 animate-spin mr-2" />
              )}
              {isEdit ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
};
