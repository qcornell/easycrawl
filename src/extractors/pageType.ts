import type { CheerioAPI } from 'cheerio';
import type { ContentBlock, FormInfo } from '../core/snapshot';

/**
 * Classify the page type based on content, forms, URL, and DOM structure.
 */
export function classifyPage(
  $: CheerioAPI,
  url: string,
  content: ContentBlock[],
  forms: FormInfo[]
): string {
  const pathname = new URL(url).pathname.toLowerCase();
  const bodyText = $('body').text().toLowerCase();
  const bodyClasses = ($('body').attr('class') || '').toLowerCase();

  // URL-based signals (strongest)
  if (pathname === '/' || pathname === '/index.html' || pathname === '/home') return 'home';
  if (/\/(about|about-us|team|who-we-are|our-story)/.test(pathname)) return 'about';
  if (/\/(contact|contact-us|get-in-touch|reach-us)/.test(pathname)) return 'contact';
  if (/\/(blog|news|articles|posts|journal)(\/|$)/.test(pathname)) {
    // Blog post vs blog listing
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 2) return 'blog-post';
    return 'blog';
  }
  if (/\/(pricing|plans|packages)/.test(pathname)) return 'pricing';
  if (/\/(faq|help|support|frequently-asked)/.test(pathname)) return 'faq';
  if (/\/(login|signin|sign-in)/.test(pathname)) return 'login';
  if (/\/(signup|register|sign-up|create-account)/.test(pathname)) return 'signup';
  if (/\/(cart|basket)/.test(pathname)) return 'cart';
  if (/\/(checkout|payment)/.test(pathname)) return 'checkout';
  if (/\/(product|item|shop)\/[^/]+/.test(pathname)) return 'product';
  if (/\/(products|shop|store|catalog|collection)/.test(pathname)) return 'product-listing';
  if (/\/(portfolio|work|projects|gallery|galleries)/.test(pathname)) return 'portfolio';
  if (/\/(services|what-we-do|offerings)/.test(pathname)) return 'services';
  if (/\/(privacy|terms|legal|tos|cookie)/.test(pathname)) return 'legal';
  if (/\/(careers|jobs|hiring|openings)/.test(pathname)) return 'careers';
  if (/\/(search|results)/.test(pathname)) return 'search-results';

  // Form-based signals
  if (forms.some(f => f.purpose === 'contact')) return 'contact';
  if (forms.some(f => f.purpose === 'login') && content.length < 10) return 'login';
  if (forms.some(f => f.purpose === 'signup')) return 'signup';
  if (forms.some(f => f.purpose === 'search') && content.length < 5) return 'search';
  if (forms.some(f => f.purpose === 'checkout')) return 'checkout';

  // Content-based signals
  if ($('[class*="product"]').length > 3 || $('[data-product]').length > 0) return 'product-listing';
  if ($('.price, [class*="price"]').length > 0 && $('[class*="add-to-cart"], .add-to-cart').length > 0) return 'product';

  // Body class signals (CMS/theme-generated)
  if (/home|front-page|page-home/i.test(bodyClasses)) return 'home';
  if (/single-post|blog-post|article/i.test(bodyClasses)) return 'blog-post';
  if (/archive|blog|category/i.test(bodyClasses)) return 'blog';

  // Default
  return 'page';
}
