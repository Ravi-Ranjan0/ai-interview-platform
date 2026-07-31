import * as cheerio from "cheerio";
import { GeminiAI } from "@/lib/gemini-client";

/**
 * Extract clean text content from raw HTML using Cheerio.
 * Strips navigation, footer, sidebar, ads, scripts, and other non-content elements.
 */
function extractCleanText(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $("script, style, noscript, iframe, svg, img, video, audio, canvas").remove();
  $("nav, footer, header, aside").remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
  $(
    '[class*="sidebar"], [class*="menu"], [class*="nav-"], [class*="footer"], [class*="header"], [class*="ad-"], [class*="advertisement"], [class*="cookie"], [class*="popup"], [class*="modal"], [class*="banner"]'
  ).remove();
  $(
    '[id*="sidebar"], [id*="menu"], [id*="nav"], [id*="footer"], [id*="header"], [id*="ad-"], [id*="cookie"]'
  ).remove();

  // Try to get main content area first
  let content = $(
    "main, article, [role='main'], .content, #content, .post-content, .article-body, .page-content"
  ).first();

  // Fallback to body if no content container found
  if (!content.length || !content.text().trim()) {
    content = $("body");
  }

  return content
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Use Gemini LLM to further clean and structure extracted text.
 * Removes remaining boilerplate and organizes content with markdown headings.
 */
async function llmCleanContent(rawText: string, url: string): Promise<string> {
  if (rawText.length < 50) return "";

  const truncated = rawText.substring(0, 8000);

  try {
    const model = GeminiAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(
      `You are a content extraction assistant. Given raw text extracted from ${url}, clean it up by:
1. Removing any remaining navigation, menu, footer, cookie notice, or ad content
2. Keeping ONLY the main informational content relevant to the page topic
3. Preserving the structure with markdown headings (## for sections)
4. Removing duplicate or boilerplate text
5. Keeping all factual information, data, and details intact

Return ONLY the cleaned content. If the text contains no meaningful content, return "EMPTY".

Raw text:
${truncated}`
    );

    const cleaned = result.response.text();
    if (cleaned === "EMPTY" || cleaned.length < 20) return "";
    return cleaned;
  } catch (error) {
    console.error(`LLM content cleaning failed for ${url}:`, error);
    return rawText; // Fallback to Cheerio-cleaned text
  }
}

/**
 * Recursively crawl a website using Playwright and extract clean text.
 */
export async function crawlWebsitePlaywright(
  url: string,
  allPages: { url: string; text: string }[],
  browser: any,
  maxDepth = 3,
  currentDepth = 0,
  visitedUrls: Set<string>,
  maxPages?: number
) {
  if (
    visitedUrls.has(url) ||
    currentDepth > maxDepth ||
    (maxPages && allPages.length >= maxPages)
  )
    return;

  visitedUrls.add(url);

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Get full HTML for Cheerio processing
    const html = await page.content();

    // Extract links before closing the page
    const links: string[] = await page.$$eval(
      "a[href]",
      (anchors: HTMLAnchorElement[]) =>
        anchors
          .map((a: HTMLAnchorElement) => a.getAttribute("href"))
          .filter((h): h is string => !!h)
    );

    await page.close();

    console.log(`Crawling (depth ${currentDepth}): ${url}`);

    // Stage 1: Cheerio HTML cleanup
    let cleanedText = extractCleanText(html);

    if (!cleanedText || cleanedText.length < 50) {
      console.log(`Skipping ${url}: insufficient content after cleanup`);
    } else {
      // Stage 2: LLM filter for quality
      cleanedText = await llmCleanContent(cleanedText, url);

      if (cleanedText && cleanedText.length > 20) {
        allPages.push({ url, text: cleanedText });
        console.log(
          `Extracted ${cleanedText.length} chars from ${url} (total pages: ${allPages.length})`
        );
      }
    }

    // Stop if maxPages reached
    if (maxPages && allPages.length >= maxPages) return;

    // Filter and crawl child links
    const baseOrigin = new URL(url).origin;
    const filteredLinks = links
      .map((href: string) => {
        try {
          return new URL(href, baseOrigin).href;
        } catch {
          return null;
        }
      })
      .filter(
        (link: string | null): link is string =>
          !!link && link.startsWith(baseOrigin) && !visitedUrls.has(link)
      );

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
    console.error(`Failed to crawl ${url}:`, (err as Error).message);
  }
}
