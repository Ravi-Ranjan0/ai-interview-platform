import { AppRouter } from "@/trpc/routers/_app";
import { inferRouterOutputs } from "@trpc/server";

export type ConversationGetOne = inferRouterOutputs<AppRouter>["conversations"]["getOne"];
export type ConversationGetMany = inferRouterOutputs<AppRouter>["conversations"]["getMany"]["items"];