import type { CheerioAPI } from 'cheerio';
import type { NavItem, FormInfo } from './snapshot';

// ─── Types ───────────────────────────────────────────────────

export interface ActionItem {
  /** Unique numbered ID: "a1", "a2", etc. */
  id: string;
  /** Action type */
  type: 'nav' | 'link' | 'button' | 'input' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file' | 'contenteditable';
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
  /**
   * Ordered list of CSS selectors to try (best → worst).
   * First one that matches a visible element wins.
   * All selectors are Playwright-compatible (no Cheerio-only pseudo-classes).
   */
  selectors: string[];
  /** ARIA role hint for Playwright getByRole resolution */
  role?: string;
  /** Accessible name for Playwright getByRole({ name }) */
  ariaName?: string;
  /** Parent form selector (for scoping) */
  formSelector?: string;

  // Legacy compat — first selector
  get selector(): string;
}

/**
 * Build a single ActionItem with the selectors getter.
 */
function makeAction(fields: Omit<ActionItem, 'selector'>): ActionItem {
  return {
    ...fields,
    get selector() { return this.selectors[0] || ''; },
  };
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
    actions.push(makeAction({
      id: nextId(),
      type: 'nav',
      label: nav.text,
      href: nav.href,
      purpose: nav.active ? 'current page' : 'navigate',
      selectors: [`a[href="${nav.href}"]`],
      role: 'link',
      ariaName: nav.text,
    }));
  }

  // 2. Form fields (from pre-extracted forms)
  for (const form of forms) {
    // Build a reliable form selector (NOT the synthetic ID)
    const formDomId = form.domId; // real DOM id or undefined
    const formSelector = formDomId
      ? `#${formDomId}`
      : (form.action && form.action !== baseUrl
        ? `form[action="${form.action}"]`
        : undefined);

    for (const field of form.fields) {
      if (field.type === 'hidden') continue;

      const actionType = (['textarea', 'select', 'checkbox', 'radio', 'file'].includes(field.type)
        ? field.type
        : 'input') as ActionItem['type'];

      // Build selector chain: real DOM id → name → placeholder → scoped label
      const fieldSelectors: string[] = [];
      if (field.domId) {
        fieldSelectors.push(`#${field.domId}`);
      }
      if (field.name) {
        const nameSelector = `[name="${field.name}"]`;
        fieldSelectors.push(formSelector ? `${formSelector} ${nameSelector}` : nameSelector);
      }
      if (field.placeholder) {
        fieldSelectors.push(`[placeholder="${field.placeholder}"]`);
      }
      if (field.type === 'textarea') {
        if (formSelector) fieldSelectors.push(`${formSelector} textarea`);
      }
      // Fallback: aria-label
      if (field.label) {
        fieldSelectors.push(`[aria-label="${field.label}"]`);
      }

      const label = field.label || field.name || field.placeholder || field.type;
      const role = actionType === 'input' ? 'textbox'
        : actionType === 'textarea' ? 'textbox'
        : actionType === 'select' ? 'combobox'
        : actionType === 'checkbox' ? 'checkbox'
        : actionType === 'radio' ? 'radio'
        : undefined;

      actions.push(makeAction({
        id: nextId(),
        type: actionType,
        label,
        inputType: field.type,
        required: field.required,
        placeholder: field.placeholder,
        options: field.options,
        value: field.value,
        selectors: fieldSelectors,
        role,
        ariaName: label,
        formSelector,
        purpose: form.purpose,
      }));
    }

    // Add form submit button
    const submitSelectors: string[] = [];
    if (formSelector) {
      submitSelectors.push(
        `${formSelector} button[type="submit"]`,
        `${formSelector} input[type="submit"]`,
        `${formSelector} button:last-of-type`,
      );
    } else {
      submitSelectors.push(
        'form button[type="submit"]',
        'form input[type="submit"]',
      );
    }

    actions.push(makeAction({
      id: nextId(),
      type: 'button',
      label: 'Submit' + (form.purpose !== 'other' ? ` (${form.purpose})` : ''),
      purpose: `submit-${form.purpose}`,
      selectors: submitSelectors,
      role: 'button',
      ariaName: 'Submit',
      formSelector,
    }));
  }

  // 3. Standalone buttons (not in forms, not nav)
  $('button, [role="button"], input[type="button"]').each((_, el) => {
    const $el = $(el);
    if ($el.closest('form').length) return;
    if ($el.closest('nav, header').length && $el.find('a').length) return;

    const text = ($el.text().trim() || $el.attr('aria-label') || $el.attr('title') || '').replace(/\s+/g, ' ');
    if (!text || text.length > 100) return;

    const key = `btn:${text}`;
    if (seen.has(key)) return;
    seen.add(key);

    const idAttr = $el.attr('id') || '';
    const ariaLabel = $el.attr('aria-label') || '';
    const testId = $el.attr('data-testid') || '';

    // Build Playwright-compatible selectors (NO :contains)
    const selectors: string[] = [];
    if (idAttr) selectors.push(`#${idAttr}`);
    if (testId) selectors.push(`[data-testid="${testId}"]`);
    if (ariaLabel) selectors.push(`[aria-label="${ariaLabel}"]`);
    // Role-based text match — Playwright-safe
    // We store label/role and let executor use getByRole
    // CSS fallback: class-based if unique enough
    const classes = $el.attr('class') || '';
    if (classes) {
      const firstClass = classes.split(/\s+/).find(c => c.length > 2 && !/^(w-|h-|p-|m-|flex|grid|text|bg|border)/.test(c));
      if (firstClass) selectors.push(`button.${firstClass}`);
    }

    actions.push(makeAction({
      id: nextId(),
      type: 'button',
      label: text,
      purpose: guessButtonPurpose(text, classes),
      selectors,
      role: 'button',
      ariaName: ariaLabel || text,
    }));
  });

  // 4. Important links (not nav, not in forms)
  $('a[href]').each((_, el) => {
    const $el = $(el);
    if ($el.closest('nav, header').length) return;
    if ($el.closest('form').length) return;
    if ($el.closest('footer').length) return;

    const href = $el.attr('href') || '';
    if (!href || href === '#' || href.startsWith('javascript:')) return;

    const text = $el.text().trim();
    if (!text || text.length > 80 || text.length < 2) return;

    const classes = ($el.attr('class') || '').toLowerCase();
    const isCTA = /btn|button|cta|action|primary|hero/i.test(classes) ||
      /learn more|get started|sign up|contact|book|schedule|download|try/i.test(text.toLowerCase());

    if (!isCTA) return;

    const key = `link:${href}`;
    if (seen.has(key)) return;
    seen.add(key);

    actions.push(makeAction({
      id: nextId(),
      type: 'link',
      label: text,
      href: resolveUrl(href, baseUrl),
      purpose: 'navigate',
      selectors: [`a[href="${href}"]`],
      role: 'link',
      ariaName: text,
    }));
  });

  // 5. Contenteditable elements (tweet composers, rich editors, FB compose modals, etc.)
  // Also catch bare [role="textbox"][contenteditable] with zero attributes (Facebook)
  const ceSelector = [
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[role="textbox"]',
  ].join(', ');

  $(ceSelector).each((_, el) => {
    const $el = $(el);
    // Skip if inside a form (already covered by form extraction)
    if ($el.closest('form').length) return;
    // Skip invisible / aria-hidden
    if ($el.attr('aria-hidden') === 'true') return;
    // Must actually be contenteditable
    const ce = $el.attr('contenteditable');
    const isTextbox = $el.attr('role') === 'textbox';
    if (ce !== 'true' && ce !== '' && !isTextbox) return;

    const ariaLabel = $el.attr('aria-label') || '';
    const testId = $el.attr('data-testid') || '';
    const role = $el.attr('role') || '';
    const placeholder = $el.attr('data-placeholder') || $el.attr('placeholder') || $el.attr('aria-placeholder') || '';
    const idAttr = $el.attr('id') || '';

    // Check if this editor is inside a dialog (compose modal)
    const inDialog = $el.closest('[role="dialog"]').length > 0;
    const dialogLabel = inDialog ? ($el.closest('[role="dialog"]').attr('aria-label') || '') : '';
    // Also check sibling dialogs (FB nests dialog > div > dialog > editor)
    const nearbyDialogLabel = !dialogLabel && inDialog
      ? ($el.parents('[role="dialog"]').last().attr('aria-label') || '')
      : dialogLabel;

    // Build a label from available hints
    const label = ariaLabel || placeholder || testId
      || (nearbyDialogLabel ? `${nearbyDialogLabel} editor` : '')
      || (inDialog ? 'Compose editor' : 'Text editor');

    // Dedup — use a broader key to avoid missing bare editors
    const key = `ce:${label}:${inDialog}:${testId}`;
    if (seen.has(key)) return;
    seen.add(key);

    const selectors: string[] = [];
    if (testId) selectors.push(`[data-testid="${testId}"]`);
    if (idAttr) selectors.push(`#${idAttr}`);
    if (ariaLabel) selectors.push(`[aria-label="${ariaLabel}"]`);
    // Scope to dialog if inside one (avoids matching wrong editor)
    if (inDialog && isTextbox) {
      selectors.push('[role="dialog"] [role="textbox"][contenteditable="true"]');
    } else if (inDialog) {
      selectors.push('[role="dialog"] [contenteditable="true"]');
    }
    if (isTextbox) selectors.push('[role="textbox"][contenteditable="true"]');
    selectors.push('[contenteditable="true"]');

    actions.push(makeAction({
      id: nextId(),
      type: 'contenteditable',
      label,
      placeholder: placeholder || undefined,
      selectors,
      role: 'textbox',
      ariaName: label,
      purpose: 'text-input',
    }));
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
