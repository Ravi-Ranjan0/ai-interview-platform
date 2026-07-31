"use client";

import { useTRPC } from "@/trpc/clients";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState } from "react";
import { useUploadThing } from "@/lib/uploadthing-client";
import { Loader2Icon, TrashIcon, FileIcon } from "lucide-react";
import humanizeDuration from "humanize-duration";

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

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-700",
  processing: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

interface Props {
  agentId: string;
}

export const KnowledgeBase = ({ agentId }: Props) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const documentsQuery = trpc.documents.getByAgent.queryOptions({ agentId });
  const { data: docs } = useSuspenseQuery({
    ...documentsQuery,
    // ponytail: cheap poll instead of a websocket for now. Upgrade path:
    // subscribe to Inngest events or Postgres LISTEN/NOTIFY.
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      return rows.some(
        (d: { status: string }) => d.status === "pending" || d.status === "processing"
      )
        ? 3000
        : false;
    },
  });

  const { startUpload } = useUploadThing("documentUploader");

  const createDoc = useMutation(trpc.documents.create.mutationOptions({}));
  const removeDoc = useMutation(
    trpc.documents.remove.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(documentsQuery);
        toast.success("Document removed.");
      },
      onError: (e) => toast.error(e.message),
    })
  );

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await startUpload(files);
      if (!uploaded) throw new Error("Upload returned no files");
      for (const f of uploaded) {
        await createDoc.mutateAsync({
          agentId,
          fileName: f.name,
          fileUrl: f.url,
          fileSize: f.size,
          mimeType: getMimeType(f.name),
        });
      }
      toast.success(`${uploaded.length} document(s) queued for processing`);
      await queryClient.invalidateQueries(documentsQuery);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload documents"
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border p-4 flex flex-col gap-y-4">
      <div className="flex flex-col gap-y-2">
        <label className="text-sm font-medium">Add documents</label>
        <Input
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          multiple
          disabled={uploading}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void handleFiles(files);
          }}
        />
        <p className="text-xs text-muted-foreground">
          PDF, DOCX, TXT (max 16MB each). Up to 10 files per upload.
        </p>
        {uploading && (
          <div className="flex items-center gap-x-2 text-xs text-blue-600">
            <Loader2Icon className="size-3 animate-spin" />
            Uploading…
          </div>
        )}
      </div>

      <div className="flex flex-col gap-y-2">
        <p className="text-sm font-medium">
          Documents ({docs.length})
        </p>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No documents yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-x-3 py-2"
              >
                <div className="flex items-center gap-x-2 min-w-0">
                  <FileIcon className="size-4 shrink-0 text-neutral-500" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm truncate">{d.fileName}</span>
                    <span className="text-xs text-muted-foreground">
                      {humanizeDuration(
                        Date.now() - new Date(d.createdAt).getTime(),
                        { largest: 1, round: true }
                      )}{" "}
                      ago
                      {d.chunkCount ? ` · ${d.chunkCount} chunks` : ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-x-2">
                  <Badge
                    variant="outline"
                    className={STATUS_STYLES[d.status] ?? ""}
                  >
                    {d.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={removeDoc.isPending}
                    onClick={() => removeDoc.mutate({ id: d.id })}
                  >
                    <TrashIcon className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
