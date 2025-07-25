import { db } from "@/db";
import { meetings } from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import z from "zod";
import { eq, getTableColumns, count, sql, and, ilike, desc } from "drizzle-orm";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/constant";
import { TRPCError } from "@trpc/server";
import { meetingsInsertSchema, meetingsUpdateSchema } from "../schema";


export const meetingsRouter = createTRPCRouter({

    getOne: protectedProcedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
            const [existingMeeting] = await db
                .select({
                    ...getTableColumns(meetings),
                })
                .from(meetings)
                .where(
                    and(eq(meetings.id, input.id),
                        eq(meetings.userId, ctx.auth.user.id),
                    ));

            if (!existingMeeting) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Meeting not found",
                });
            }

            return existingMeeting;

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
                        ...getTableColumns(meetings),
                    }
                )
                .from(meetings)
                .where(
                    and(
                        eq(meetings.userId, ctx.auth.user.id),
                        search ? ilike(meetings.name, `%${search}%`) : undefined,
                    )
                )
                .orderBy(desc(meetings.createdAt), desc(meetings.id))
                .limit(pageSize)
                .offset((page - 1) * pageSize);


            const [totalCount] = await db
                .select({ count: count() })
                .from(meetings)
                .where(
                    and(
                        eq(meetings.userId, ctx.auth.user.id),
                        search ? ilike(meetings.name, `%${search}%`) : undefined,
                    )
                );

            const totalPages = Math.ceil(totalCount.count / pageSize);


            return {
                items: data,
                totalCount: totalCount.count,
                totalPages,
            };
        }),

    create: protectedProcedure.input(meetingsInsertSchema)
        .mutation(async ({ input, ctx }) => {
            const [createdMeeting] = await db
                .insert(meetings)
                .values({
                    ...input,
                    userId: ctx.auth.user.id,
                })
                .returning();

                //Create Stream Call

            return createdMeeting;
        }),

    update: protectedProcedure.input(meetingsUpdateSchema)
        .mutation(async ({ input, ctx }) => {
            const [updatedMeeting] = await db
                .update(meetings)
                .set({
                    ...input,
                })
                .where(
                    and(
                        eq(meetings.id, input.id),
                        eq(meetings.userId, ctx.auth.user.id),
                    )
                )
                .returning();

            if (!updatedMeeting) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Meeting not found",
                });
            }

            return updatedMeeting;
        }),
});
