import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/env";

const GeminiAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// LLM cleaning is embarrassingly parallel across pages (each call is
// independent), so it's run through the same bounded-concurrency pattern
// used for embedding generation, instead of one call per page in series.
const CRAWL_CLEAN_CONCURRENCY = 5;
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Extract clean text content from raw HTML using Cheerio's DOM heuristics.
 * Strips navigation, footer, sidebar, ads, scripts, and other non-content
 * elements, then picks the largest known content container (falling back to
 * <body>). Used only when Readability (below) can't confidently extract an
 * article — this heuristic is a safety net, not the primary path, since
 * hand-picked selectors miss plenty of real-world layouts and previously
 * fell back to the whole <body> (nav/widgets/related-content and all) far
 * more often than intended.
 */
function extractCleanTextCheerio(html: string): string {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg, img, video, audio, canvas, form, button").remove();
  $("nav, footer, header, aside").remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]').remove();
  $(
    '[class*="sidebar"], [class*="menu"], [class*="nav-"], [class*="footer"], [class*="header"], ' +
    '[class*="ad-"], [class*="advertisement"], [class*="cookie"], [class*="popup"], [class*="modal"], ' +
    '[class*="banner"], [class*="related"], [class*="comment"], [class*="widget"], [class*="social"], ' +
    '[class*="share"], [class*="newsletter"], [class*="subscribe"], [class*="breadcrumb"], ' +
    '[class*="pagination"], [class*="testimonial"], [class*="cta-"]'
  ).remove();
  $(
    '[id*="sidebar"], [id*="menu"], [id*="nav"], [id*="footer"], [id*="ad-"], [id*="cookie"], ' +
    '[id*="comment"], [id*="related"], [id*="newsletter"]'
  ).remove();

  const candidateSelectors = [
    "main", "article", "[role='main']",
    ".content", "#content", ".post-content", ".article-body", ".page-content",
    ".entry-content", ".entry", ".post", "[itemprop='articleBody']", ".prose", ".markdown-body",
  ];

  // Pick the largest matching candidate by text length rather than the first
  // one found — the first match in DOM order isn't always the real content
  // (e.g. a small "featured snippet" box before the actual article body).
  let best = "";
  for (const selector of candidateSelectors) {
    $(selector).each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > best.length) best = text;
    });
  }

  if (!best) {
    best = $("body").text().trim();
  }

  return normalizeWhitespace(best);
}

/**
 * Extract the main article content using Mozilla's Readability (the same
 * extraction Firefox's reader mode uses) — purpose-built for "find the real
 * content, discard chrome/boilerplate," and considerably more reliable than
 * hand-picked selectors across arbitrary real-world sites. Returns null if
 * Readability can't confidently parse the page (e.g. non-article pages like
 * a homepage or dashboard), in which case the caller falls back to the
 * Cheerio heuristic.
 */
function extractCleanText(html: string, url: string): string {
  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (article?.textContent && article.textContent.trim().length >= 100) {
      return normalizeWhitespace(article.textContent);
    }
  } catch (err) {
    console.warn(`Readability parse failed for ${url}, falling back to Cheerio:`, (err as Error).message);
  }
  return extractCleanTextCheerio(html);
}

// Path segments/patterns that are almost never the content a knowledge base
// should index — following these wasted crawl budget on boilerplate pages
// and diluted retrieval with irrelevant matches (login forms, legal text,
// paginated archives, etc. crowding out the actual content).
const NON_CONTENT_URL_PATTERN =
  /\/(login|signin|sign-in|signup|sign-up|register|logout|log-out|cart|checkout|account|privacy|terms|tos|cookie[s]?|tag|tags|category|categories|page\/\d+|feed|rss|wp-admin|wp-login)(\/|$|[?#])/i;
const NON_HTML_EXTENSION_PATTERN = /\.(pdf|zip|rar|jpg|jpeg|png|gif|svg|webp|css|js|xml|json|mp4|mp3|ico)(\?|$)/i;

function isLikelyContentUrl(url: string): boolean {
  return !NON_CONTENT_URL_PATTERN.test(url) && !NON_HTML_EXTENSION_PATTERN.test(url);
}

/** Strip the fragment so `#section` anchors on the same page aren't treated as distinct URLs. */
function stripFragment(url: string): string {
  const idx = url.indexOf("#");
  return idx === -1 ? url : url.slice(0, idx);
}

const LLM_INPUT_CAP = 8000;

/**
 * Use Gemini LLM to further clean and structure extracted text.
 * Only the first LLM_INPUT_CAP chars are sent to the model (cost/latency);
 * anything beyond that is appended raw rather than dropped, so long pages
 * never lose content — they just get partial polish instead of full polish.
 */
async function llmCleanContent(rawText: string, url: string): Promise<string> {
  if (rawText.length < 50) return "";

  const truncated = rawText.slice(0, LLM_INPUT_CAP);
  const remainder = rawText.slice(LLM_INPUT_CAP);

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
    if (cleaned === "EMPTY" || cleaned.length < 20) {
      // Nothing meaningful in the truncated prefix doesn't mean the rest of
      // the page is empty too — fall back to the full raw text instead of
      // discarding it.
      return remainder ? rawText : "";
    }
    return remainder ? `${cleaned}\n\n${remainder}` : cleaned;
  } catch (error) {
    console.error(`LLM content cleaning failed for ${url}:`, error);
    return rawText; // Fallback to Cheerio-cleaned text, unchanged
  }
}

type RawPage = { url: string; rawText: string };

/**
 * Recursively walk a website with Playwright, collecting Cheerio-cleaned raw
 * text per page (no LLM call here — that happens afterward, in bulk, with
 * concurrency). Respects maxDepth, maxPages (shared across all seed URLs via
 * the caller-supplied array), and a wall-clock deadline so one slow/hung site
 * can't blow out the whole crawl's time budget.
 */
async function collectPages(
  url: string,
  allPages: RawPage[],
  browser: any,
  maxDepth: number,
  currentDepth: number,
  visitedUrls: Set<string>,
  maxPages: number,
  deadline: number,
  failedUrls: string[]
): Promise<void> {
  if (
    visitedUrls.has(url) ||
    currentDepth > maxDepth ||
    allPages.length >= maxPages ||
    Date.now() >= deadline
  )
    return;

  visitedUrls.add(url);

  let html = "";
  let links: string[] = [];

  try {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      html = await page.content();
      links = await page.$$eval(
        "a[href]",
        (anchors: HTMLAnchorElement[]) =>
          anchors
            .map((a: HTMLAnchorElement) => a.getAttribute("href"))
            .filter((h): h is string => !!h)
      );
    } finally {
      await page.close().catch(() => {});
    }

    console.log(`Crawling (depth ${currentDepth}): ${url}`);

    const cleanedText = extractCleanText(html, url);

    if (!cleanedText || cleanedText.length < 50) {
      console.log(`Skipping ${url}: insufficient content after cleanup`);
    } else {
      allPages.push({ url, rawText: cleanedText });
    }

    if (allPages.length >= maxPages || Date.now() >= deadline) return;

    const baseOrigin = new URL(url).origin;
    const filteredLinks = links
      .map((href: string) => {
        try {
          return stripFragment(new URL(href, baseOrigin).href);
        } catch {
          return null;
        }
      })
      .filter(
        (link: string | null): link is string =>
          !!link &&
          link.startsWith(baseOrigin) &&
          !visitedUrls.has(link) &&
          isLikelyContentUrl(link)
      );

    for (const link of filteredLinks) {
      if (allPages.length >= maxPages || Date.now() >= deadline) break;
      await collectPages(
        link,
        allPages,
        browser,
        maxDepth,
        currentDepth + 1,
        visitedUrls,
        maxPages,
        deadline,
        failedUrls
      );
    }
  } catch (err) {
    console.error(`Failed to crawl ${url}:`, (err as Error).message);
    failedUrls.push(url);
  }
}

/**
 * Crawl a list of seed URLs (same-origin links followed per seed, up to
 * maxDepth) and return cleaned page text ready for chunking/embedding.
 * Page collection is sequential (Playwright navigation is inherently so per
 * browser instance), but the LLM cleaning pass over all collected pages runs
 * with bounded concurrency, since that's the dominant per-page latency cost
 * and was previously fully serial (one Gemini round-trip at a time).
 */
export async function crawlAndCleanUrls(
  urls: string[],
  browser: any,
  options: { maxDepth?: number; maxPagesPerUrl?: number; timeBudgetMs?: number } = {}
): Promise<{ pages: { url: string; text: string }[]; failedUrls: string[] }> {
  const maxDepth = options.maxDepth ?? 3;
  const maxPagesPerUrl = options.maxPagesPerUrl ?? 10;
  const timeBudgetMs = options.timeBudgetMs ?? 3 * 60 * 1000;
  const deadline = Date.now() + timeBudgetMs;

  const visitedUrls = new Set<string>();
  const failedUrls: string[] = [];
  const rawPages: RawPage[] = [];

  for (const seedUrl of urls) {
    if (Date.now() >= deadline) {
      console.warn(`Crawl time budget exceeded before reaching seed URL: ${seedUrl}`);
      break;
    }
    // maxPages is enforced per seed URL (a fresh slice), so one large site
    // among several seeds can't starve the others of any pages at all.
    const perSeedPages: RawPage[] = [];
    await collectPages(
      seedUrl,
      perSeedPages,
      browser,
      maxDepth,
      0,
      visitedUrls,
      maxPagesPerUrl,
      deadline,
      failedUrls
    );
    rawPages.push(...perSeedPages);
  }

  const cleaned = await mapWithConcurrency(rawPages, CRAWL_CLEAN_CONCURRENCY, async (p) => {
    const text = await llmCleanContent(p.rawText, p.url);
    // Never let a weak/failed LLM pass drop a page that had usable raw text.
    return { url: p.url, text: text && text.length > 20 ? text : p.rawText };
  });

  return {
    pages: cleaned.filter((p) => p.text && p.text.trim().length > 20),
    failedUrls,
  };
}
