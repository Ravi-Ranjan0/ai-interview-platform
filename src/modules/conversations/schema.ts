import z from "zod";

export const conversationsInsertSchema = z.object({
    title: z.string().min(1, "Title is required"),
    agentId: z.string().min(1, "Agent ID is required"),
});

export const conversationsUpdateSchema = conversationsInsertSchema.extend({
    id: z.string().min(1, {
        message: "ID is required",
    }) 
});