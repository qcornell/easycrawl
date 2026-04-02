import type { CheerioAPI } from 'cheerio';
import type { ContentBlock } from '../core/snapshot';

/**
 * Extract meaningful text content from the page.
 * Returns structured blocks with type classification.
 */
export function extractContent($: CheerioAPI): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const seen = new Set<string>();

  // Headings
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2 || text.length > 300) return;
    if (seen.has(text)) return;
    seen.add(text);

    const level = parseInt(el.tagName?.replace('h', '') || '2');
    blocks.push({ type: 'heading', text, level, tag: el.tagName });
  });

  // Paragraphs
  $('p').each((_, el) => {
    const $el = $(el);
    // Skip if inside nav/footer/form
    if ($el.closest('nav, footer, form, header').length) return;

    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 10 || text.length > 2000) return;
    
    // Dedup by first 80 chars
    const key = text.substring(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    // Detect special content types
    const type = classifyText(text);
    blocks.push({ type, text: text.substring(0, 500), tag: 'p' });
  });

  // List items (outside nav)
  $('ul:not(nav ul):not(header ul):not(footer ul) > li, ol:not(nav ol) > li').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 5 || text.length > 500) return;
    
    const key = 'li:' + text.substring(0, 50);
    if (seen.has(key)) return;
    seen.add(key);

    blocks.push({ type: 'list-item', text, tag: 'li' });
  });

  // Blockquotes / testimonials
  $('blockquote, [class*="testimonial"], [class*="quote"], [class*="review"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 10 || text.length > 500) return;
    
    const key = 'q:' + text.substring(0, 50);
    if (seen.has(key)) return;
    seen.add(key);

    blocks.push({ type: 'quote', text, tag: el.tagName });
  });

  return blocks;
}

function classifyText(text: string): ContentBlock['type'] {
  // Phone numbers
  if (/^[\s]*[\+]?[\d\s\-\(\)\.]{7,20}[\s]*$/.test(text)) return 'phone';
  if (/\(\d{3}\)\s*\d{3}[-.]?\d{4}/.test(text) && text.length < 30) return 'phone';

  // Email addresses
  if (/^[\s]*[^\s@]+@[^\s@]+\.[^\s@]+[\s]*$/.test(text)) return 'email';

  // Addresses (heuristic: contains state abbreviation + zip, or "Street/Ave/Blvd")
  if (/\b(street|st\.|avenue|ave\.|boulevard|blvd|road|rd\.|drive|dr\.|lane|ln\.|suite|ste\.)\b/i.test(text) && text.length < 200) return 'address';
  if (/\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(text) && text.length < 200) return 'address';

  return 'paragraph';
}
