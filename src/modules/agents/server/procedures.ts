import { db } from "@/db";
import { agents } from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { TRPCError } from "@trpc/server";
import { agentsInsertSchema } from "../schema";
import z from "zod";
import { eq } from "drizzle-orm";


export const agentsRouter = createTRPCRouter({

    getOne: protectedProcedure.input(z.object({id: z.string()})).query(async ({input}) => {
        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, input.id));

        return existingAgent ;

    }),
    getMany: protectedProcedure.query(async () => {
        const data = await db
            .select()
            .from(agents)


        return data;
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

            return createdAgent;
        }),
});
