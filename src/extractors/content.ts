import type { CheerioAPI } from 'cheerio';
import type { ContentBlock } from '../core/snapshot';

/**
 * Extract meaningful text content from the page.
 * Returns structured blocks with type classification.
 * 
 * Handles both traditional HTML content (headings, paragraphs, lists)
 * and modern app content (tweets, messages, cards, posts).
 */
export function extractContent($: CheerioAPI): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const seen = new Set<string>();

  // ─── Traditional HTML Content ────────────────────────────

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
    if ($el.closest('nav, footer, form, header').length) return;

    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 10 || text.length > 2000) return;
    
    const key = text.substring(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

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

  // ─── Modern App Content (SPA / Social / Chat) ───────────
  // These use data-testid, role, and ARIA patterns instead of semantic HTML.
  // We extract them as 'post' type blocks.

  // X.com / Twitter — tweets
  $('[data-testid="tweetText"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;

    const key = 'tweet:' + text.substring(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    // Try to get author from the tweet's article ancestor
    const $article = $(el).closest('article, [data-testid="tweet"]');
    let author = '';
    if ($article.length) {
      // X puts the display name + handle in nested spans/links
      const $userLink = $article.find('[data-testid="User-Name"] a').first();
      if ($userLink.length) {
        author = $userLink.text().replace(/\s+/g, ' ').trim();
      }
    }

    const prefix = author ? `@${author}: ` : '';
    blocks.push({ type: 'post', text: `${prefix}${text}`.substring(0, 500), tag: 'tweet' });
  });

  // X.com — user bios on profile pages
  $('[data-testid="UserDescription"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 5) return;

    const key = 'bio:' + text.substring(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    blocks.push({ type: 'paragraph', text: `Bio: ${text}`.substring(0, 500), tag: 'bio' });
  });

  // Facebook — compose dialog / modal editor detection
  // When compose modal is open, extract info about it
  $('[role="dialog"] [role="textbox"][contenteditable="true"]').each((_, el) => {
    const placeholder = $(el).attr('aria-placeholder') || $(el).attr('data-placeholder') || $(el).attr('placeholder') || '';
    const text = $(el).text().replace(/\s+/g, ' ').trim();

    const key = 'fb-editor:' + (placeholder || 'compose');
    if (seen.has(key)) return;
    seen.add(key);

    const content = text ? `Compose editor (contains: "${text}")` : `Compose editor${placeholder ? ` — "${placeholder}"` : ''}`;
    blocks.push({ type: 'post', text: content, tag: 'fb-editor' });
  });

  // Discord-style messages
  $('[class*="messageContent"], [class*="message-content"], [data-testid*="message"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;

    const key = 'msg:' + text.substring(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    blocks.push({ type: 'post', text: text.substring(0, 500), tag: 'message' });
  });

  // Facebook — posts (uses data-ad-comet-preview="message" for text, h4 > a for authors)
  $('[data-ad-comet-preview="message"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 3) return;

    const key = 'fb:' + text.substring(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    // Walk up to find author — Facebook puts author in h4 > a within same post container
    let author = '';
    let $parent = $(el).parent();
    for (let i = 0; i < 30 && $parent.length; i++) {
      const $h4a = $parent.find('h4 a').first();
      if ($h4a.length) {
        author = $h4a.text().replace(/\s+/g, ' ').trim();
        break;
      }
      $parent = $parent.parent();
    }

    const prefix = author ? `${author}: ` : '';
    blocks.push({ type: 'post', text: `${prefix}${text}`.substring(0, 500), tag: 'fb-post' });
  });

  // Facebook — posts that are shares/reels (may not have data-ad-comet-preview)
  // Use the h4 author headings in the feed section as anchors
  $('h4').each((_, el) => {
    const $h4 = $(el);
    const $link = $h4.find('a').first();
    if (!$link.length) return;

    const author = $link.text().replace(/\s+/g, ' ').trim();
    if (!author || author.length < 2) return;

    // Check if we already captured this post via data-ad-comet-preview
    const key = 'fbh4:' + author;
    if (seen.has(key)) return;

    // Walk up to find a container with post text
    let $container = $h4.parent();
    let text = '';
    for (let i = 0; i < 30 && $container.length; i++) {
      const $msg = $container.find('[data-ad-comet-preview="message"]').first();
      if ($msg.length) {
        text = $msg.text().replace(/\s+/g, ' ').trim();
        break;
      }
      // Also try dir="auto" divs with text-align (FB post text fallback)
      const $dirAuto = $container.find('div[dir="auto"][style*="text-align"]').first();
      if ($dirAuto.length && !$dirAuto.closest('h3, h4, nav, header').length) {
        const candidate = $dirAuto.text().replace(/\s+/g, ' ').trim();
        if (candidate.length > 10) { text = candidate; break; }
      }
      $container = $container.parent();
    }

    // Skip if we already captured this text
    if (text && seen.has('fb:' + text.substring(0, 80))) return;
    seen.add(key);

    if (text) {
      blocks.push({ type: 'post', text: `${author}: ${text}`.substring(0, 500), tag: 'fb-post' });
    }
  });

  // Generic card/post patterns (LinkedIn, Reddit, etc.)
  $('[data-testid*="post"], [data-testid*="Post"], [class*="post-content"], [class*="PostContent"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 10) return;

    const key = 'post:' + text.substring(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    blocks.push({ type: 'post', text: text.substring(0, 500), tag: 'post' });
  });

  // ARIA article roles (used by many apps for feed items)
  $('article').each((_, el) => {
    const $el = $(el);
    // Skip if we already captured content from data-testid extractors above
    if ($el.find('[data-testid="tweetText"]').length) return;
    if ($el.find('[class*="messageContent"]').length) return;

    // Get a compact text representation
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 20 || text.length > 1000) return;

    const key = 'article:' + text.substring(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    blocks.push({ type: 'post', text: text.substring(0, 500), tag: 'article' });
  });

  return blocks;
}

function classifyText(text: string): ContentBlock['type'] {
  if (/^[\s]*[\+]?[\d\s\-\(\)\.]{7,20}[\s]*$/.test(text)) return 'phone';
  if (/\(\d{3}\)\s*\d{3}[-.]?\d{4}/.test(text) && text.length < 30) return 'phone';
  if (/^[\s]*[^\s@]+@[^\s@]+\.[^\s@]+[\s]*$/.test(text)) return 'email';
  if (/\b(street|st\.|avenue|ave\.|boulevard|blvd|road|rd\.|drive|dr\.|lane|ln\.|suite|ste\.)\b/i.test(text) && text.length < 200) return 'address';
  if (/\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(text) && text.length < 200) return 'address';

  return 'paragraph';
}
