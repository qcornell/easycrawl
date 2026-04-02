/**
 * BrowserSnapshot — Creates PageSnapshots from live Playwright pages.
 * 
 * Unlike the fetch-based snapshot (Cheerio), this one:
 * - Sees JS-rendered content (React, Vue, SPA sites)
 * - Works on X.com, Discord, Gmail, etc.
 * - Can wait for dynamic content to load
 * - Uses the real DOM after JavaScript execution
 */

import type { Page } from 'playwright';
import * as cheerio from 'cheerio';
import { extractNavigation } from '../extractors/navigation';
import { extractForms } from '../extractors/forms';
import { extractContent } from '../extractors/content';
import { extractMedia } from '../extractors/media';
import { classifyPage } from '../extractors/pageType';
import { buildActionMap } from '../core/actionMap';
import type { PageSnapshot, SnapshotOptions } from '../core/snapshot';

export interface BrowserSnapshotOptions {
  /** Wait for network idle before snapshotting (default: true) */
  waitForNetworkIdle?: boolean;
  /** Additional wait time in ms after page load */
  extraWaitMs?: number;
  /** Wait for a specific selector to appear */
  waitForSelector?: string;
  /** Timeout for waiting (default: 30000) */
  timeout?: number;
  /** Include raw HTML in snapshot */
  includeRaw?: boolean;
  /** Scroll down to trigger lazy loading before snapshot */
  scrollFirst?: boolean;
}

/**
 * Create a PageSnapshot from a live Playwright page.
 * The page should already be navigated to the target URL.
 */
export async function createBrowserSnapshot(
  page: Page,
  options: BrowserSnapshotOptions = {}
): Promise<PageSnapshot> {
  const timeout = options.timeout ?? 30000;

  // Wait for page to be ready
  if (options.waitForNetworkIdle !== false) {
    try {
      await page.waitForLoadState('networkidle', { timeout });
    } catch {
      // networkidle can timeout on sites with constant connections (websockets, etc.)
      // Fall back to domcontentloaded which should already be done
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    }
  }

  // Wait for specific selector if requested
  if (options.waitForSelector) {
    await page.waitForSelector(options.waitForSelector, { timeout }).catch(() => {});
  }

  // Extra wait (for animations, lazy JS, etc.)
  if (options.extraWaitMs) {
    await page.waitForTimeout(options.extraWaitMs);
  }

  // Scroll to trigger lazy loading
  if (options.scrollFirst) {
    await autoScroll(page);
  }

  // Get the fully rendered HTML
  const html = await page.content();
  const url = page.url();
  const title = await page.title();

  // Parse with Cheerio (same extractors as fetch mode — consistency!)
  const $ = cheerio.load(html);

  // Remove noise
  $('script, style, noscript, svg').remove();
  // Keep iframes in browser mode — they might be visible content

  const navigation = extractNavigation($, url);
  const forms = extractForms($, url);
  const content = extractContent($);
  const images = extractMedia($, url);
  const pageType = classifyPage($, url, content, forms);
  const description = $('meta[name="description"]').attr('content') || '';
  const language = $('html').attr('lang') || 'en';

  const actions = buildActionMap($, url, navigation, forms);

  const hasSearch = forms.some(f => f.purpose === 'search') ||
    $('input[type="search"]').length > 0;

  const hasPagination = $('nav[aria-label*="pagination"], .pagination').length > 0;

  const isEcommerce = $('[class*="cart"], [class*="price"], [class*="product"]').length > 0;

  const loginRequired = $('form[action*="login"], input[type="password"]').length > 0 &&
    content.length < 5;

  const summary = [
    title,
    `${pageType} page`,
    `${actions.filter(a => a.type !== 'nav').length} interactive elements`,
    images.length > 0 ? `${images.length} images` : '',
  ].filter(Boolean).join(' • ');

  const snapshot: PageSnapshot = {
    url,
    title: title.split(/\s*[|–—]\s*/)[0] || title,
    pageType,
    summary,
    navigation,
    actions,
    content,
    images,
    forms,
    meta: {
      hasForm: forms.length > 0,
      formPurpose: forms[0]?.purpose,
      isEcommerce,
      loginRequired,
      hasSearch,
      hasPagination,
      language,
      description,
    },
  };

  if (options.includeRaw) {
    snapshot.raw = { html, statusCode: 200, fetchMs: 0 };
  }

  return snapshot;
}

/**
 * Scroll down a page to trigger lazy-loaded content.
 * Scrolls in increments with pauses, like a human would.
 */
async function autoScroll(page: Page, maxScrolls: number = 5): Promise<void> {
  await page.evaluate(async (max) => {
    await new Promise<void>((resolve) => {
      let scrolls = 0;
      const distance = window.innerHeight * 0.8;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        scrolls++;
        if (scrolls >= max || (window.innerHeight + window.scrollY >= document.body.scrollHeight)) {
          clearInterval(timer);
          // Scroll back to top
          window.scrollTo(0, 0);
          resolve();
        }
      }, 300);
    });
  }, maxScrolls);
}
