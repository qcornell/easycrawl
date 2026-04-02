import * as cheerio from 'cheerio';
import { extractNavigation } from '../extractors/navigation';
import { extractForms } from '../extractors/forms';
import { extractContent } from '../extractors/content';
import { extractMedia } from '../extractors/media';
import { classifyPage } from '../extractors/pageType';
import { buildActionMap, type ActionItem } from './actionMap';

// ─── Types ───────────────────────────────────────────────────

export interface PageSnapshot {
  url: string;
  title: string;
  pageType: string;
  summary: string;
  navigation: NavItem[];
  actions: ActionItem[];
  content: ContentBlock[];
  images: ImageInfo[];
  forms: FormInfo[];
  meta: PageMeta;
  raw?: {
    html: string;
    statusCode: number;
    fetchMs: number;
  };
}

export interface NavItem {
  id: string;
  text: string;
  href: string;
  active?: boolean;
}

export interface ContentBlock {
  type: 'heading' | 'paragraph' | 'list' | 'list-item' | 'quote' | 'address' | 'phone' | 'email' | 'code' | 'table' | 'other';
  text: string;
  level?: number; // for headings: 1-6
  tag?: string;
}

export interface ImageInfo {
  id: string;
  src: string;
  alt: string;
  context: string; // "hero", "thumbnail", "icon", "background", "content"
  width?: number;
  height?: number;
}

export interface FormField {
  id: string;
  type: string; // text, email, password, tel, number, textarea, select, checkbox, radio, file, hidden
  label: string;
  name: string;
  required: boolean;
  placeholder?: string;
  options?: string[]; // for select/radio
  value?: string;
}

export interface FormInfo {
  id: string;
  action: string;
  method: string;
  purpose: string; // contact, login, signup, search, subscribe, checkout, other
  fields: FormField[];
}

export interface PageMeta {
  hasForm: boolean;
  formPurpose?: string;
  isEcommerce: boolean;
  loginRequired: boolean;
  hasSearch: boolean;
  hasPagination: boolean;
  language: string;
  description: string;
}

// ─── Snapshot Builder ────────────────────────────────────────

export interface SnapshotOptions {
  /** Include raw HTML in snapshot (for debugging) */
  includeRaw?: boolean;
  /** Custom fetch headers */
  headers?: Record<string, string>;
  /** Timeout in ms (default: 15000) */
  timeout?: number;
  /** Custom user agent */
  userAgent?: string;
  /** Pre-fetched HTML (skip fetch) */
  html?: string;
  /** Base URL for resolving relative links (required if html provided) */
  baseUrl?: string;
}

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export async function createSnapshot(url: string, options: SnapshotOptions = {}): Promise<PageSnapshot> {
  const startTime = Date.now();
  let html: string;
  let statusCode = 200;

  if (options.html) {
    // Use pre-fetched HTML
    html = options.html;
  } else {
    // Fetch the page
    const resp = await fetch(url, {
      headers: {
        'User-Agent': options.userAgent || DEFAULT_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(options.headers || {}),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeout || 15000),
    });
    statusCode = resp.status;
    html = await resp.text();
  }

  const fetchMs = Date.now() - startTime;
  const baseUrl = options.baseUrl || url;

  // Parse with Cheerio
  const $ = cheerio.load(html);

  // Remove noise
  $('script, style, noscript, svg, iframe').remove();

  // Extract everything in parallel
  const title = $('title').first().text().trim().split(/\s*[|–—]\s*/)[0] || '';
  const navigation = extractNavigation($, baseUrl);
  const forms = extractForms($, baseUrl);
  const content = extractContent($);
  const images = extractMedia($, baseUrl);
  const pageType = classifyPage($, url, content, forms);
  const description = $('meta[name="description"]').attr('content') || '';
  const language = $('html').attr('lang') || 'en';

  // Build the numbered action map from all interactive elements
  const actions = buildActionMap($, baseUrl, navigation, forms);

  // Detect page features
  const hasSearch = forms.some(f => f.purpose === 'search') || 
    $('input[type="search"]').length > 0 ||
    $('[class*="search"], [id*="search"]').length > 0;

  const hasPagination = $('nav[aria-label*="pagination"], .pagination, [class*="paginate"]').length > 0 ||
    $('a[href*="page="], a[href*="/page/"]').length > 0;

  const isEcommerce = $('[class*="cart"], [class*="price"], [class*="product"], [data-product]').length > 0 ||
    /shop|store|cart|checkout|product/i.test(url);

  const loginRequired = $('form[action*="login"], form[action*="signin"], input[type="password"]').length > 0 &&
    content.length < 5;

  // Generate summary
  const summary = generateSummary(title, pageType, content, forms, actions, images);

  const snapshot: PageSnapshot = {
    url,
    title,
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
    snapshot.raw = { html, statusCode, fetchMs };
  }

  return snapshot;
}

function generateSummary(
  title: string,
  pageType: string,
  content: ContentBlock[],
  forms: FormInfo[],
  actions: ActionItem[],
  images: ImageInfo[]
): string {
  const parts: string[] = [];

  if (title) parts.push(title);

  const typeLabel = pageType.charAt(0).toUpperCase() + pageType.slice(1);
  parts.push(`${typeLabel} page`);

  if (forms.length > 0) {
    const formPurposes = forms.map(f => f.purpose).join(', ');
    parts.push(`with ${forms.length} form(s) (${formPurposes})`);
  }

  const headings = content.filter(c => c.type === 'heading');
  if (headings.length > 0) {
    parts.push(`— "${headings[0].text}"`);
  }

  const actionCount = actions.filter(a => a.type !== 'nav').length;
  if (actionCount > 0) {
    parts.push(`• ${actionCount} interactive elements`);
  }

  if (images.length > 0) {
    parts.push(`• ${images.length} images`);
  }

  return parts.join(' ');
}
