import { db } from "@/db";
import { agents } from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { agentsInsertSchema, agentsUpdateSchema } from "../schema";
import z from "zod";
import { eq, getTableColumns, count, sql, and, ilike, desc } from "drizzle-orm";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/constant";
import { TRPCError } from "@trpc/server";
import { inngest } from "@/inngest/client";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { PlaywrightWebBaseLoader } from "@langchain/community/document_loaders/web/playwright";
import { chromium } from "playwright";
import { crawlWebsitePlaywright } from "@/utils/web-crawler";


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

    create: protectedProcedure
        .input(agentsInsertSchema)
        .mutation(async ({ input, ctx }) => {
            const insertPayload = {
                ...input,
                urls: input.urls ? JSON.stringify(input.urls) : null,
                userId: ctx.auth.user.id, // Assuming user.id is available in the context
            };

            const [createdAgent] = await db
                .insert(agents)
                .values(insertPayload)
                .returning();
            // if (input.urls && input.urls.length > 0) {
            //     try {
            //         console.log("🌍 Loading content from URLs:", input.urls);

            //         const allTexts: string[] = [];
            //         for (const url of input.urls) {
            //             try {
            //                 const loader = new PlaywrightWebBaseLoader(url, {
            //                     launchOptions: {
            //                         headless: true,
            //                     },
            //                     gotoOptions: {
            //                         waitUntil: "domcontentloaded", // Wait for JS to load
            //                     },
            //                     evaluate: async (page) => {
            //                         // Extract ONLY readable text from the main content area
            //                         return await page.$eval("main", (el) => el.innerText);
            //                     },
            //                 });

            //                 console.log(`🔗 Loading content (JS-enabled): ${url}`);
            //                 const docs = await loader.load();

            //                 console.log(`📄 Retrieved documents from ${url}`, docs);

            //                 const urlTexts = docs.map((d: any) => d.pageContent).filter(Boolean);
            //                 console.log(`✅ Extracted ${urlTexts.length} text chunks from ${url}`);

            //                 allTexts.push(...urlTexts);
            //             } catch (err) {
            //                 console.error(`❌ Failed to scrape ${url}:`, err);
            //             }
            //         }




            //         if (allTexts.length > 0) {
            //             console.log(`📚 Total extracted text chunks from all URLs: ${allTexts.length}`);
            //             await inngest.send({
            //                 name: "agents/generate-embeddings",
            //                 data: {
            //                     agentId: createdAgent.id,
            //                     texts: allTexts,
            //                     url: input.urls[0], // Pass the first URL for reference
            //                 },
            //             });
            //             console.log("🚀 Triggered embeddings generation via Inngest (Web URLs)");
            //         } else {
            //             console.warn("⚠️ No valid text extracted from provided URLs");
            //         }
            //     } catch (err) {
            //         console.error("❌ Error while processing URLs:", err);
            //         throw new TRPCError({
            //             code: "INTERNAL_SERVER_ERROR",
            //             message: "Failed to process and embed the provided URLs",
            //         });
            //     }
            // }

            if (input.urls && input.urls.length > 0) {
                // const allTexts: string[] = [];
                const allPages: { url: string; text: string }[] = [];
                const visitedUrls = new Set<string>();

                const browser = await chromium.launch({ headless: true });

                try {
                    for (const url of input.urls) {
                        await crawlWebsitePlaywright(
                            url,
                            allPages,
                            browser,
                            3, // maxDepth
                            0, // currentDepth
                            visitedUrls,
                            10
                        );
                    }
                } finally {
                    await browser.close();
                }

                console.log(`📚 Total extracted text chunks from all URLs: ${allPages.length}`);
                console.log(`🔗 Crawled URLs:`, Array.from(visitedUrls));
                console.log(`🔗 Crawled a total of ${visitedUrls.size} unique URLs`);
                console.log(`📚 Extracted a total of ${allPages.length} text chunks from crawled URLs`);

                if (allPages.length > 0) {
                    await inngest.send({
                        name: "agents/generate-embeddings",
                        data: {
                            agentId: createdAgent.id,
                            // texts: allTexts,
                            pages: allPages.map(page => ({ url: page.url, text: page.text })),
                            url: input.urls[0], // reference first URL
                        },
                    });
                    console.log("🚀 Triggered embeddings generation via Inngest");
                } else {
                    console.warn("⚠️ No valid text extracted from provided URLs");
                }
            }


            await inngest.send({
                name: "agents/questions",
                data: {
                    agentId: createdAgent.id
                },
            })

            return createdAgent;
        }),
});
