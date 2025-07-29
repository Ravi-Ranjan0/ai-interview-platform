import { db } from "@/db";
import { agents } from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { agentsInsertSchema, agentsUpdateSchema } from "../schema";
import z from "zod";
import { eq, getTableColumns, count, sql, and, ilike, desc } from "drizzle-orm";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/constant";
import { TRPCError } from "@trpc/server";
import { inngest } from "@/inngest/client";


export const agentsRouter = createTRPCRouter({

    update: protectedProcedure
    .input(agentsUpdateSchema)
    .mutation(async ({ ctx, input }) => {
        const [updatedAgent] = await db
            .update(agents)
            .set(input)
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

            if(!removeAgent) {
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
                    meetingCount: sql<number>`5`,
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
                    .min(MIN_PAGE_SIZE)
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
                        meetingCount: sql<number>`5`,
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

    create: protectedProcedure.input(agentsInsertSchema)
        .mutation(async ({ input, ctx }) => {
            const [createdAgent] = await db
                .insert(agents)
                .values({
                    ...input,
                    userId: ctx.auth.user.id, // Assuming user.id is available in the context
                })
                .returning();

                await inngest.send({
                    name:"agents/questions",
                    data: {
                        agentId: createdAgent.id
                    },
                })

            return createdAgent;
        }),
});
