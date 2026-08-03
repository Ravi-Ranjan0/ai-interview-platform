import z from "zod";

export const roomsInsertSchema = z.object({
    topic: z.string().min(1, "Topic is required"),
});

export const sendRoomMessageSchema = z.object({
    roomId: z.string().min(1),
    content: z.string().min(1),
});

export const proposeSlotSchema = z.object({
    roomId: z.string().min(1),
    slotTime: z.coerce.date().refine((date) => date.getTime() > Date.now(), {
        message: "Proposed time must be in the future",
    }),
});
