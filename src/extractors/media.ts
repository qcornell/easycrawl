import type { CheerioAPI } from 'cheerio';
import type { ImageInfo } from '../core/snapshot';

/**
 * Extract images with context classification.
 * Identifies hero images, thumbnails, icons, content images, backgrounds.
 */
export function extractMedia($: CheerioAPI, baseUrl: string): ImageInfo[] {
  const images: ImageInfo[] = [];
  const seen = new Set<string>();
  let counter = 0;

  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy') || '';
    if (!src || src.startsWith('data:')) return;

    const resolved = resolveUrl(src, baseUrl);
    if (seen.has(resolved)) return;
    seen.add(resolved);

    // Skip tiny tracking pixels and spacers
    const width = parseInt($el.attr('width') || '0');
    const height = parseInt($el.attr('height') || '0');
    if ((width > 0 && width < 10) || (height > 0 && height < 10)) return;

    counter++;
    const alt = ($el.attr('alt') || '').trim();
    const context = classifyImageContext($el, $, width, height);

    images.push({
      id: `img${counter}`,
      src: resolved,
      alt,
      context,
      ...(width > 0 ? { width } : {}),
      ...(height > 0 ? { height } : {}),
    });
  });

  // Also find background images in style attributes
  $('[style*="background-image"]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const match = style.match(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
    if (!match) return;

    const src = match[1];
    if (src.startsWith('data:')) return;

    const resolved = resolveUrl(src, baseUrl);
    if (seen.has(resolved)) return;
    seen.add(resolved);

    counter++;
    images.push({
      id: `img${counter}`,
      src: resolved,
      alt: '',
      context: 'background',
    });
  });

  return images;
}

function classifyImageContext(
  $el: ReturnType<CheerioAPI>,
  $: CheerioAPI,
  width: number,
  height: number
): string {
  const classes = ($el.attr('class') || '').toLowerCase();
  const parent = $el.parent();
  const parentClasses = (parent.attr('class') || '').toLowerCase();
  const grandparent = parent.parent();
  const gpClasses = (grandparent.attr('class') || '').toLowerCase();

  // Logo
  if (/logo/i.test(classes) || /logo/i.test($el.attr('alt') || '')) return 'logo';

  // Icon
  if (/icon/i.test(classes) || (width > 0 && width <= 48 && height > 0 && height <= 48)) return 'icon';

  // Hero / banner
  if (/hero|banner|cover|jumbotron|splash/i.test(classes + ' ' + parentClasses + ' ' + gpClasses)) return 'hero';

  // Check if it's in the first section/div (likely hero)
  const sections = $('main > section, main > div, body > section, body > div').toArray();
  if (sections.length > 0) {
    const firstSection = sections[0];
    if ($el.closest(firstSection).length) return 'hero';
  }

  // Thumbnail / gallery
  if (/thumb|gallery|grid|portfolio/i.test(classes + ' ' + parentClasses)) return 'thumbnail';

  // Avatar / profile
  if (/avatar|profile|author|user/i.test(classes)) return 'avatar';

  // Default: content image
  return 'content';
}

function resolveUrl(src: string, base: string): string {
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}
