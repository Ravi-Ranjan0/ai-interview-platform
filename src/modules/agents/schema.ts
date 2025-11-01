import z from "zod";

export const agentsInsertSchema = z.object({
    name: z.string().min(1, "Name is required"),
    instructions: z.string().min(1, "Instructions are required"),
    urls: z.array(z.string().url()).optional(),
    // pdf: z
    // .instanceof(File)
    // .optional()
    // .refine((file) => !file || file.type === "application/pdf", {
    //   message: "Only PDF files are allowed",
    // })
    // .refine((file) => !file || file.size <= 5 * 1024 * 1024, {
    //   message: "File size must be less than 5MB",
    // }),
});

export const agentsUpdateSchema = agentsInsertSchema.extend({
    id: z.string().min(1, {
        message: "ID is required",
    }) 
});