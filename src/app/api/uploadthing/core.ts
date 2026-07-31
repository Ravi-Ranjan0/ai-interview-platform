import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const f = createUploadthing();

export const ourFileRouter = {
  documentUploader: f({
    pdf: { maxFileSize: "16MB", maxFileCount: 10 },
    text: { maxFileSize: "16MB", maxFileCount: 10 },
    blob: { maxFileSize: "16MB", maxFileCount: 10 }, // catches docx
  })
    .middleware(async () => {
      const session = await auth.api.getSession({ headers: await headers() });
      if (!session) throw new UploadThingError("Unauthorized");
      return { userId: session.user.id };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      return { url: file.url, uploadedBy: metadata.userId };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
