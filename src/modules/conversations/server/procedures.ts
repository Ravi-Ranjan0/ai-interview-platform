import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/constant";
import { db } from "@/db";
import { agents, conversations } from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, getTableColumns, ilike, ne } from "drizzle-orm";
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
                        ne(conversations.title, "__test__"),
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
                        ne(conversations.title, "__test__"),
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

    // Returns an existing chat conversation for this user+agent, or creates
    // one. Used by the Chat panel on the agent detail page. The title marker
    // "__test__" is a legacy internal identifier kept for data compatibility;
    // it's invisible to users (filtered from getMany) and never renamed.
    getOrCreateChat: protectedProcedure
        .input(z.object({ agentId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            await assertAgentOwned(input.agentId, ctx.auth.user.id);

            const title = "__test__";
            const [existing] = await db
                .select({ id: conversations.id })
                .from(conversations)
                .where(
                    and(
                        eq(conversations.userId, ctx.auth.user.id),
                        eq(conversations.agentId, input.agentId),
                        eq(conversations.title, title),
                    )
                )
                .limit(1);

            if (existing) return { id: existing.id };

            const [created] = await db
                .insert(conversations)
                .values({
                    title,
                    userId: ctx.auth.user.id,
                    agentId: input.agentId,
                })
                .returning({ id: conversations.id });

            return { id: created.id };
        }),

});