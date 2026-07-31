import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { agentsInsertSchema, agentsUpdateSchema } from "../schema";
import z from "zod";
import { eq, getTableColumns, count, sql, and, ilike, desc } from "drizzle-orm";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/constant";
import { TRPCError } from "@trpc/server";
import { inngest } from "@/inngest/client";
import { assertAgentOwned } from "@/lib/authz";


export const agentsRouter = createTRPCRouter({

    update: protectedProcedure
        .input(agentsUpdateSchema)
        .mutation(async ({ ctx, input }) => {
            const { id: _id, urls, ...rest } = input;
            const updatePayload = {
                ...rest,
                ...(urls !== undefined ? { urls: JSON.stringify(urls) } : {}),
                updatedAt: new Date(),
            };
            const [updatedAgent] = await db
                .update(agents)
                .set(updatePayload)
                .where(
                    and(eq(agents.id, input.id),
                        eq(agents.userId, ctx.auth.user.id),
                    )
                )
                .returning();

            if (!updatedAgent) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Agent not found",
                });
            }

            return updatedAgent;
        }),

    remove: protectedProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {

            const [removeAgent] = await db
                .delete(agents)
                .where(
                    and(eq(agents.id, input.id),
                        eq(agents.userId, ctx.auth.user.id),
                    )
                )
                .returning();

            if (!removeAgent) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Agent not found",
                });
            }

            return removeAgent;
        }),

    getOne: protectedProcedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
            const [existingAgent] = await db
                .select({
                    meetingCount: sql<number>`(SELECT COUNT(*)::int FROM ${meetings} WHERE ${meetings.agentId} = ${agents.id})`,
                    last_Response: agents.lastResponse,
                    ...getTableColumns(agents),
                })
                .from(agents)
                .where(
                    and(eq(agents.id, input.id),
                        eq(agents.userId, ctx.auth.user.id),
                    ));

            if (!existingAgent) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Agent not found",
                });
            }

            return existingAgent;

        }),
    getMany: protectedProcedure
        .input(
            z.object({
                page: z.number().default(DEFAULT_PAGE),
                pageSize: z
                    .number()
                    .min(1)
                    .max(MAX_PAGE_SIZE)
                    .default(DEFAULT_PAGE_SIZE),
                search: z.string().nullish(),
            })
        )
        .query(async ({ ctx, input }) => {

            const { page, pageSize, search } = input;
            const data = await db
                .select(
                    {
                        meetingCount: sql<number>`(SELECT COUNT(*)::int FROM ${meetings} WHERE ${meetings.agentId} = ${agents.id})`,
                        ...getTableColumns(agents),
                    }
                )
                .from(agents)
                .where(
                    and(
                        eq(agents.userId, ctx.auth.user.id),
                        search ? ilike(agents.name, `%${search}%`) : undefined,
                    )
                )
                .orderBy(desc(agents.createdAt), desc(agents.id))
                .limit(pageSize)
                .offset((page - 1) * pageSize);


            const [totalCount] = await db
                .select({ count: count() })
                .from(agents)
                .where(
                    and(
                        eq(agents.userId, ctx.auth.user.id),
                        search ? ilike(agents.name, `%${search}%`) : undefined,
                    )
                );

            const totalPages = Math.ceil(totalCount.count / pageSize);


            return {
                items: data,
                totalCount: totalCount.count,
                totalPages,
            };
        }),

    create: protectedProcedure
        .input(agentsInsertSchema)
        .mutation(async ({ input, ctx }) => {
            const hasUrls = !!input.urls && input.urls.length > 0;
            const [createdAgent] = await db
                .insert(agents)
                .values({
                    ...input,
                    urls: hasUrls ? JSON.stringify(input.urls) : null,
                    urlsStatus: hasUrls ? "pending" : "idle",
                    userId: ctx.auth.user.id,
                })
                .returning();

            if (hasUrls) {
                // A10 fix: crawl runs in background, not inline in the mutation.
                await inngest.send({
                    name: "agents/crawl-urls",
                    data: { agentId: createdAgent.id, urls: input.urls! },
                });
            }

            await inngest.send({
                name: "agents/questions",
                data: { agentId: createdAgent.id },
            });

            return createdAgent;
        }),

    recrawlUrls: protectedProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            await assertAgentOwned(input.id, ctx.auth.user.id);

            const [agent] = await db
                .select({ id: agents.id, urls: agents.urls })
                .from(agents)
                .where(eq(agents.id, input.id));

            if (!agent) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
            }

            const urls: string[] = agent.urls
                ? (() => {
                    try {
                        const parsed = JSON.parse(agent.urls!);
                        return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
                    } catch {
                        return [];
                    }
                })()
                : [];

            if (urls.length === 0) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "This agent has no URLs to crawl.",
                });
            }

            await db
                .update(agents)
                .set({ urlsStatus: "pending", urlsError: null, updatedAt: new Date() })
                .where(eq(agents.id, input.id));

            await inngest.send({
                name: "agents/crawl-urls",
                data: { agentId: input.id, urls },
            });

            return { success: true, urls };
        }),
});
