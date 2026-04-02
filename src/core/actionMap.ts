import type { CheerioAPI } from 'cheerio';
import type { NavItem, FormInfo } from './snapshot';

// ─── Types ───────────────────────────────────────────────────

export interface ActionItem {
  /** Unique numbered ID: "a1", "a2", etc. */
  id: string;
  /** Action type */
  type: 'nav' | 'link' | 'button' | 'input' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file';
  /** Human-readable label */
  label: string;
  /** What this action does (for LLM context) */
  purpose?: string;
  /** For links/nav: destination URL */
  href?: string;
  /** For inputs: type attribute */
  inputType?: string;
  /** For inputs: whether required */
  required?: boolean;
  /** For inputs: placeholder text */
  placeholder?: string;
  /** For selects: available options */
  options?: string[];
  /** For inputs: current value */
  value?: string;
  /** CSS selector to find this element */
  selector: string;
  /** Parent form ID if inside a form */
  formId?: string;
}

// ─── Action Map Builder ──────────────────────────────────────

let actionCounter = 0;

function nextId(): string {
  return `a${++actionCounter}`;
}

export function buildActionMap(
  $: CheerioAPI,
  baseUrl: string,
  navigation: NavItem[],
  forms: FormInfo[]
): ActionItem[] {
  actionCounter = 0;
  const actions: ActionItem[] = [];
  const seen = new Set<string>();

  // 1. Navigation links (from pre-extracted nav)
  for (const nav of navigation) {
    const id = nextId();
    actions.push({
      id,
      type: 'nav',
      label: nav.text,
      href: nav.href,
      purpose: nav.active ? 'current page' : 'navigate',
      selector: `a[href="${nav.href}"]`,
    });
  }

  // 2. Form fields (from pre-extracted forms)
  for (const form of forms) {
    for (const field of form.fields) {
      if (field.type === 'hidden') continue;

      const id = nextId();
      const actionType = (['textarea', 'select', 'checkbox', 'radio', 'file'].includes(field.type)
        ? field.type
        : 'input') as ActionItem['type'];

      actions.push({
        id,
        type: actionType,
        label: field.label || field.name || field.placeholder || field.type,
        inputType: field.type,
        required: field.required,
        placeholder: field.placeholder,
        options: field.options,
        value: field.value,
        selector: field.id ? `#${field.id}` : `[name="${field.name}"]`,
        formId: form.id,
        purpose: form.purpose,
      });
    }

    // Add form submit button
    const id = nextId();
    actions.push({
      id,
      type: 'button',
      label: 'Submit' + (form.purpose !== 'other' ? ` (${form.purpose})` : ''),
      purpose: `submit-${form.purpose}`,
      selector: form.id ? `#${form.id} button[type="submit"], #${form.id} input[type="submit"]` : 'form button[type="submit"]',
      formId: form.id,
    });
  }

  // 3. Standalone buttons (not in forms, not nav)
  $('button, [role="button"], input[type="button"]').each((_, el) => {
    const $el = $(el);
    // Skip if inside a form (already handled)
    if ($el.closest('form').length) return;
    // Skip if it's a nav element
    if ($el.closest('nav, header').length && $el.find('a').length) return;

    const text = $el.text().trim() || $el.attr('aria-label') || $el.attr('title') || '';
    if (!text || text.length > 100) return;

    const key = `btn:${text}`;
    if (seen.has(key)) return;
    seen.add(key);

    const classes = $el.attr('class') || '';
    const id_attr = $el.attr('id') || '';
    const selector = id_attr ? `#${id_attr}` : classes ? `button.${classes.split(/\s+/)[0]}` : `button:contains("${text.substring(0, 30)}")`;

    actions.push({
      id: nextId(),
      type: 'button',
      label: text,
      purpose: guessButtonPurpose(text, classes),
      selector,
    });
  });

  // 4. Important links (not nav, not in forms)
  $('a[href]').each((_, el) => {
    const $el = $(el);
    // Skip nav links (already handled)
    if ($el.closest('nav, header').length) return;
    // Skip form links
    if ($el.closest('form').length) return;
    // Skip footer (too noisy for action map)
    if ($el.closest('footer').length) return;

    const href = $el.attr('href') || '';
    if (!href || href === '#' || href.startsWith('javascript:')) return;

    const text = $el.text().trim();
    if (!text || text.length > 80 || text.length < 2) return;

    // Only include "call to action" style links
    const classes = ($el.attr('class') || '').toLowerCase();
    const isCTA = /btn|button|cta|action|primary|hero/i.test(classes) ||
      /learn more|get started|sign up|contact|book|schedule|download|try/i.test(text.toLowerCase());

    if (!isCTA) return;

    const key = `link:${href}`;
    if (seen.has(key)) return;
    seen.add(key);

    actions.push({
      id: nextId(),
      type: 'link',
      label: text,
      href: resolveUrl(href, baseUrl),
      purpose: 'navigate',
      selector: `a[href="${href}"]`,
    });
  });

  return actions;
}

function guessButtonPurpose(text: string, classes: string): string {
  const t = text.toLowerCase();
  const c = classes.toLowerCase();
  if (/close|dismiss|x|cancel/i.test(t)) return 'dismiss';
  if (/search/i.test(t)) return 'search';
  if (/menu|hamburger|toggle/i.test(t) || /menu/i.test(c)) return 'toggle-menu';
  if (/cart|bag/i.test(t)) return 'open-cart';
  if (/add to cart|buy/i.test(t)) return 'add-to-cart';
  if (/submit|send/i.test(t)) return 'submit';
  if (/scroll|arrow|next|prev/i.test(t) || /slider|carousel/i.test(c)) return 'navigate-slider';
  if (/play/i.test(t)) return 'play-media';
  if (/share/i.test(t)) return 'share';
  if (/load more|show more|see all/i.test(t)) return 'load-more';
  return 'action';
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}
