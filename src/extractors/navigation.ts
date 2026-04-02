import type { CheerioAPI } from 'cheerio';
import type { NavItem } from '../core/snapshot';

/**
 * Extract navigation links from the page.
 * Searches <nav>, <header>, role="navigation", and common nav class patterns.
 */
export function extractNavigation($: CheerioAPI, baseUrl: string): NavItem[] {
  const seen = new Set<string>();
  const navItems: NavItem[] = [];
  let counter = 0;

  const parsed = new URL(baseUrl);
  const currentPath = parsed.pathname.replace(/\/$/, '') || '/';
  const hostname = parsed.hostname;

  // Priority selectors — most specific to least
  const selectors = [
    'nav:not(footer nav) a[href]',
    'header a[href]',
    '[role="navigation"] a[href]',
    '.nav a[href]',
    '.navbar a[href]',
    '.main-nav a[href]',
    '.site-nav a[href]',
    '#nav a[href]',
    '#navigation a[href]',
    '.menu:not(.footer-menu) a[href]',
    '.header-menu a[href]',
  ];

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const $el = $(el);
      let href = ($el.attr('href') || '').trim();
      if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      // Remove hash and query
      const cleanHref = href.split('#')[0].split('?')[0];
      if (!cleanHref) return;

      // Resolve and check same-origin
      let resolved: URL;
      try {
        resolved = new URL(cleanHref, baseUrl);
      } catch {
        return;
      }

      if (resolved.hostname !== hostname && resolved.hostname !== 'www.' + hostname && hostname !== 'www.' + resolved.hostname) return;

      const navPath = resolved.pathname.replace(/\/$/, '') || '/';

      // Dedup
      if (seen.has(navPath)) return;
      seen.add(navPath);

      // Get clean text
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (!text || text.length > 50 || text.length < 1) return;

      // Skip junk nav items
      if (/login|signup|sign.in|register|cart|checkout|account|admin/i.test(text) && !text.includes(' ')) return;

      counter++;
      navItems.push({
        id: `nav${counter}`,
        text,
        href: navPath,
        active: navPath === currentPath,
      });
    });

    // If we found nav items with the first matching selector, stop
    if (navItems.length >= 2) break;
  }

  return navItems;
}
