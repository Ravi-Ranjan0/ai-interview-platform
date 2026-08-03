import { inferRouterOutputs } from "@trpc/server";

import { AppRouter } from "@/trpc/routers/_app";

export type RoomGetMany = inferRouterOutputs<AppRouter>["rooms"]["getMany"]["items"];

export enum RoomStatus {
    Open = "open",
    Scheduled = "scheduled",
    Completed = "completed",
    Cancelled = "cancelled",
}

export const ROOM_STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
    [RoomStatus.Open]: "secondary",
    [RoomStatus.Scheduled]: "default",
    [RoomStatus.Completed]: "outline",
    [RoomStatus.Cancelled]: "outline",
};
