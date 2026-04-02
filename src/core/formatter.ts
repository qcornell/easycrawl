import type { PageSnapshot } from './snapshot';
import type { ActionItem } from './actionMap';

// ─── Formatter ───────────────────────────────────────────────
// Converts PageSnapshot into LLM-optimized text at different verbosity levels

export type FormatLevel = 'minimal' | 'standard' | 'detailed';

export function formatSnapshot(snapshot: PageSnapshot, level: FormatLevel = 'standard'): string {
  switch (level) {
    case 'minimal': return formatMinimal(snapshot);
    case 'standard': return formatStandard(snapshot);
    case 'detailed': return formatDetailed(snapshot);
    default: return formatStandard(snapshot);
  }
}

// ─── Minimal (~300-600 tokens) ───────────────────────────────
// Just the action map. For models that need absolute minimum context.

function formatMinimal(s: PageSnapshot): string {
  const lines: string[] = [];
  lines.push(`Page: ${s.title} [${s.pageType}]`);
  lines.push(`URL: ${s.url}`);
  lines.push('');
  lines.push('Actions:');
  for (const a of s.actions) {
    lines.push(formatAction(a));
  }
  return lines.join('\n');
}

// ─── Standard (~800-2000 tokens) ─────────────────────────────
// Action map + key content. Good balance for most models.

function formatStandard(s: PageSnapshot): string {
  const lines: string[] = [];

  // Header
  lines.push(`Page: ${s.title}`);
  lines.push(`URL: ${s.url}`);
  lines.push(`Type: ${s.pageType}`);
  if (s.meta.description) {
    lines.push(`Description: ${s.meta.description.substring(0, 150)}`);
  }
  lines.push('');

  // Navigation (compact)
  if (s.navigation.length > 0) {
    const navStr = s.navigation.map(n => n.active ? `[${n.text}]` : n.text).join(' | ');
    lines.push(`Nav: ${navStr}`);
    lines.push('');
  }

  // Key content (headings + first few paragraphs)
  const headings = s.content.filter(c => c.type === 'heading');
  const paragraphs = s.content.filter(c => c.type === 'paragraph');

  if (headings.length > 0 || paragraphs.length > 0) {
    lines.push('Content:');
    for (const h of headings.slice(0, 5)) {
      const prefix = h.level ? '#'.repeat(h.level) + ' ' : '# ';
      lines.push(`  ${prefix}${h.text}`);
    }
    for (const p of paragraphs.slice(0, 3)) {
      const truncated = p.text.length > 200 ? p.text.substring(0, 200) + '…' : p.text;
      lines.push(`  ${truncated}`);
    }
    lines.push('');
  }

  // Actions
  lines.push('Available Actions:');
  for (const a of s.actions) {
    lines.push(formatAction(a));
  }

  // Images summary
  if (s.images.length > 0) {
    lines.push('');
    lines.push(`Images: ${s.images.length} total`);
    for (const img of s.images.slice(0, 5)) {
      if (img.alt) lines.push(`  - ${img.alt} (${img.context})`);
    }
  }

  return lines.join('\n');
}

// ─── Detailed (~2000-5000 tokens) ────────────────────────────
// Full content + actions + all metadata. For complex tasks.

function formatDetailed(s: PageSnapshot): string {
  const lines: string[] = [];

  // Header
  lines.push(`=== Page Snapshot ===`);
  lines.push(`Title: ${s.title}`);
  lines.push(`URL: ${s.url}`);
  lines.push(`Type: ${s.pageType}`);
  lines.push(`Summary: ${s.summary}`);
  if (s.meta.description) lines.push(`Meta Description: ${s.meta.description}`);
  lines.push(`Language: ${s.meta.language}`);
  lines.push('');

  // Features
  const features: string[] = [];
  if (s.meta.hasForm) features.push(`form:${s.meta.formPurpose}`);
  if (s.meta.isEcommerce) features.push('ecommerce');
  if (s.meta.hasSearch) features.push('search');
  if (s.meta.hasPagination) features.push('pagination');
  if (s.meta.loginRequired) features.push('login-required');
  if (features.length > 0) lines.push(`Features: ${features.join(', ')}`);
  lines.push('');

  // Navigation
  if (s.navigation.length > 0) {
    lines.push('--- Navigation ---');
    for (const n of s.navigation) {
      const marker = n.active ? ' ← current' : '';
      lines.push(`  ${n.text} → ${n.href}${marker}`);
    }
    lines.push('');
  }

  // Full content
  if (s.content.length > 0) {
    lines.push('--- Content ---');
    for (const c of s.content.slice(0, 20)) {
      switch (c.type) {
        case 'heading':
          const prefix = c.level ? '#'.repeat(c.level) + ' ' : '# ';
          lines.push(`  ${prefix}${c.text}`);
          break;
        case 'paragraph':
          lines.push(`  ${c.text}`);
          break;
        case 'list-item':
          lines.push(`  • ${c.text}`);
          break;
        case 'address':
          lines.push(`  📍 ${c.text}`);
          break;
        case 'phone':
          lines.push(`  📞 ${c.text}`);
          break;
        case 'email':
          lines.push(`  ✉️ ${c.text}`);
          break;
        default:
          lines.push(`  [${c.type}] ${c.text}`);
      }
    }
    lines.push('');
  }

  // Forms (detailed)
  if (s.forms.length > 0) {
    lines.push('--- Forms ---');
    for (const f of s.forms) {
      lines.push(`  Form: ${f.purpose} (${f.method.toUpperCase()} ${f.action})`);
      for (const field of f.fields) {
        if (field.type === 'hidden') continue;
        const req = field.required ? ' *required' : '';
        const opts = field.options ? ` [${field.options.join(', ')}]` : '';
        lines.push(`    - ${field.label || field.name} (${field.type})${req}${opts}`);
      }
    }
    lines.push('');
  }

  // Actions
  lines.push('--- Available Actions ---');
  for (const a of s.actions) {
    lines.push(formatAction(a));
  }
  lines.push('');

  // Images
  if (s.images.length > 0) {
    lines.push('--- Images ---');
    for (const img of s.images.slice(0, 10)) {
      lines.push(`  ${img.id}: ${img.alt || '(no alt)'} — ${img.context} [${img.src.substring(0, 60)}]`);
    }
  }

  return lines.join('\n');
}

// ─── Action Formatter ────────────────────────────────────────

function formatAction(a: ActionItem): string {
  const tag = a.type.toUpperCase();
  switch (a.type) {
    case 'nav':
      const active = a.purpose === 'current page' ? ' (current)' : '';
      return `  #${a.id.slice(1)} [NAV] ${a.label} → ${a.href}${active}`;
    case 'link':
      return `  #${a.id.slice(1)} [LINK] "${a.label}" → ${a.href}`;
    case 'button':
      return `  #${a.id.slice(1)} [BUTTON] "${a.label}"${a.purpose ? ` (${a.purpose})` : ''}`;
    case 'input':
      const req = a.required ? ' *' : '';
      const ph = a.placeholder ? ` — "${a.placeholder}"` : '';
      return `  #${a.id.slice(1)} [INPUT:${a.inputType}] "${a.label}"${req}${ph}`;
    case 'textarea':
      return `  #${a.id.slice(1)} [TEXTAREA] "${a.label}"${a.required ? ' *' : ''}`;
    case 'select':
      const opts = a.options ? ` [${a.options.slice(0, 5).join(', ')}${a.options.length > 5 ? '...' : ''}]` : '';
      return `  #${a.id.slice(1)} [SELECT] "${a.label}"${a.required ? ' *' : ''}${opts}`;
    case 'checkbox':
      return `  #${a.id.slice(1)} [CHECKBOX] "${a.label}"${a.value ? ` = ${a.value}` : ''}`;
    case 'radio':
      return `  #${a.id.slice(1)} [RADIO] "${a.label}"${a.value ? ` = ${a.value}` : ''}`;
    case 'contenteditable':
      const cePh = a.placeholder ? ` — "${a.placeholder}"` : '';
      return `  #${a.id.slice(1)} [EDITOR] "${a.label}"${cePh}`;
    default:
      return `  #${a.id.slice(1)} [${tag}] "${a.label}"`;
  }
}

// ─── Command Prompt Generator ────────────────────────────────
// Generates the system prompt telling the LLM how to use actions

export function generateSystemPrompt(): string {
  return `You are browsing a website. You'll receive a structured snapshot of the current page including numbered actions you can take.

To interact with the page, respond with one or more commands:

COMMANDS:
  click #N          — Click button or link #N
  fill #N "text"    — Type text into input #N
  select #N "opt"   — Select option in dropdown #N
  check #N          — Check checkbox #N
  uncheck #N        — Uncheck checkbox #N
  scroll down       — Scroll down the page
  scroll up         — Scroll up the page  
  back              — Go back to previous page
  goto URL          — Navigate to a specific URL
  done              — Task is complete
  
RULES:
- Use the # numbers from the action list (e.g., "click #7" not "click Send Message")
- You can chain multiple commands, one per line
- After filling a form, use "click #N" on the submit button
- If the page doesn't have what you need, use navigation or "goto URL"
- Say "done" with a brief summary when the task is complete
- If you're stuck, describe what you see and what you need`;
}
