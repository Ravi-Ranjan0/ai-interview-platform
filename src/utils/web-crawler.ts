import { PlaywrightWebBaseLoader } from "@langchain/community/document_loaders/web/playwright";


/**
 * Recursively crawl a website using Playwright and extract text chunks.
 * @param url - URL to crawl
 * @param allTexts - array to collect text chunks
 * @param browser - Playwright browser instance
 * @param maxDepth - maximum recursion depth
 * @param currentDepth - current recursion depth
 * @param visitedUrls - Set to track visited URLs per crawl
 */
// export async function crawlWebsitePlaywright(
//   url: string,
//   allTexts: string[],
//   browser: any,
//   maxDepth = 3,
//   currentDepth = 0,
//   visitedUrls: Set<string>
// ) {
//   if (visitedUrls.has(url) || currentDepth > maxDepth) return;
//   visitedUrls.add(url);

//   try {
//     // Load page content using LangChain Playwright loader
//     const loader = new PlaywrightWebBaseLoader(url, {
//       launchOptions: { browser, headless: true },
//       gotoOptions: { waitUntil: "domcontentloaded" },
//       evaluate: async (page) =>
//         page.$eval("main", (el) => el.innerText).catch(() => ""),
//     });

//     console.log(`🔗 Crawling (depth ${currentDepth}): ${url}`);
//     const docs = await loader.load();
//     const urlTexts = docs.map((d: any) => d.pageContent).filter(Boolean);
//     allTexts.push(...urlTexts);
//     console.log(`✅ Extracted ${urlTexts.length} chunks from ${url}`);

//     // Extract links from the page
//     const page = await browser.newPage();
//     await page.goto(url, { waitUntil: "domcontentloaded" });

//     const links = await page.$$eval("a[href]", (anchors) =>
//       anchors.map((a) => a.getAttribute("href")).filter(Boolean)
//     );
//     await page.close();

//     const baseOrigin = new URL(url).origin;
//     const filteredLinks = links
//       .map((href) => {
//         try {
//           return new URL(href!, baseOrigin).href;
//         } catch {
//           return null;
//         }
//       })
//       .filter(
//         (link) => link && link.startsWith(baseOrigin) && !visitedUrls.has(link)
//       ) as string[];

//     // Recursively crawl filtered links
//     for (const link of filteredLinks) {
//       await crawlWebsitePlaywright(
//         link,
//         allTexts,
//         browser,
//         maxDepth,
//         currentDepth + 1,
//         visitedUrls
//       );
//     }
//   } catch (err) {
//     console.error(`❌ Failed to crawl ${url}:`, (err as Error).message);
//   }
// }
export async function crawlWebsitePlaywright(
  url: string,
  allPages: { url: string; text: string }[],
  browser: any,
  maxDepth = 3,
  currentDepth = 0,
  visitedUrls: Set<string>,
  maxPages?: number
) {
  // Stop if already visited, max depth exceeded, or maxPages reached
  if (
    visitedUrls.has(url) ||
    currentDepth > maxDepth ||
    (maxPages && allPages.length >= maxPages)
  )
    return;

  visitedUrls.add(url);

  try {
    // Load page content using LangChain Playwright loader
    const loader = new PlaywrightWebBaseLoader(url, {
      launchOptions: { browser, headless: true },
      gotoOptions: { waitUntil: "domcontentloaded" },
      evaluate: async (page) =>
        page.$eval("main", (el) => el.innerText).catch(() => ""),
    });

    console.log(`🔗 Crawling (depth ${currentDepth}): ${url}`);
    const docs = await loader.load();
    const pageText = docs.map((d: any) => d.pageContent).filter(Boolean).join("\n");

    if (pageText) {
      allPages.push({ url, text: pageText });
      console.log(`✅ Extracted content from ${url} (allPages: ${allPages.length})`);
    }

    // Stop if maxPages reached
    if (maxPages && allPages.length >= maxPages) return;

    // Extract links from the page
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const links = await page.$$eval("a[href]", (anchors) =>
      anchors.map((a) => a.getAttribute("href")).filter(Boolean)
    );
    await page.close();

    const baseOrigin = new URL(url).origin;
    const filteredLinks = links
      .map((href) => {
        try {
          return new URL(href!, baseOrigin).href;
        } catch {
          return null;
        }
      })
      .filter(
        (link) => link && link.startsWith(baseOrigin) && !visitedUrls.has(link)
      ) as string[];

    // Recursively crawl filtered links
    for (const link of filteredLinks) {
      if (maxPages && allPages.length >= maxPages) break;
      await crawlWebsitePlaywright(
        link,
        allPages,
        browser,
        maxDepth,
        currentDepth + 1,
        visitedUrls,
        maxPages
      );
    }
  } catch (err) {
    console.error(`❌ Failed to crawl ${url}:`, (err as Error).message);
  }
}