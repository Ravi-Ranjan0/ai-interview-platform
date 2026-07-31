import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/constant";
import { db } from "@/db";
import { agents, conversations } from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, getTableColumns, ilike } from "drizzle-orm";
import z from "zod";
import { conversationsInsertSchema } from "../schema";
import { assertAgentOwned } from "@/lib/authz";

export const conversationsRouter = createTRPCRouter({
    // Define your procedures here
    getOne: protectedProcedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
            const [existingConversation] = await db
                .select({
                    ...getTableColumns(conversations),
                })
                .from(conversations)
                .innerJoin(agents, eq(conversations.agentId, agents.id))
                .where(
                    and(
                        eq(conversations.id, input.id),
                        eq(conversations.userId, ctx.auth.user.id),
                    )
                );
            if (!existingConversation) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Conversation not found",
                });
            }
            return existingConversation;
        }),
    getMany: protectedProcedure
        .input(
            z.object({
                page: z.number().default(DEFAULT_PAGE),
                pageSize: z.number().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
                search: z.string().nullish(),
                agentId: z.string().nullish(),
            })
        )
        .query(async ({ ctx, input }) => {
            const { page, pageSize, search, agentId } = input;
            const data = await db
                .select({
                    ...getTableColumns(conversations),
                    agent: agents,
                })
                .from(conversations)
                .innerJoin(agents, eq(conversations.agentId, agents.id))
                .where(
                    and(
                        eq(conversations.userId, ctx.auth.user.id),
                        search ? ilike(conversations.title, `%${search}%`) : undefined,
                        agentId ? eq(conversations.agentId, agentId) : undefined,
                    )
                )
                .orderBy(desc(conversations.createdAt), desc(conversations.id))
                .limit(pageSize)
                .offset((page - 1) * pageSize);

            const [totalCount] = await db
                .select({
                    count: count(),
                })
                .from(conversations)
                .innerJoin(agents, eq(conversations.agentId, agents.id))
                .where(
                    and(
                        eq(conversations.userId, ctx.auth.user.id),
                        agentId ? eq(conversations.agentId, agentId) : undefined,
                        search ? ilike(conversations.title, `%${search}%`) : undefined,
                    )
                );

            const totalPages = Math.ceil(totalCount.count / pageSize);
            return {
                items: data,
                totalCount: totalCount.count,
                totalPages
            };
        }),
    create: protectedProcedure.input(conversationsInsertSchema)
        .mutation(async ({ ctx, input }) => {
            await assertAgentOwned(input.agentId, ctx.auth.user.id);

            const [createdConversation] = await db
                .insert(conversations)
                .values({
                    ...input,
                    userId: ctx.auth.user.id,
                })
                .returning();

            return createdConversation;
        }),

});