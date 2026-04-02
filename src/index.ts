/**
 * EasyCrawl — Browser Intelligence for Cheap AI Models
 * 
 * Pre-digests web pages into structured, numbered action maps
 * that any LLM can reason about and act on.
 * 
 * Two modes:
 * 1. Fetch mode (default) — Cheerio, no browser needed, read-only
 * 2. Browser mode — Playwright, full interaction, JS-rendered sites
 * 
 * @example
 * ```typescript
 * // Fetch mode (read-only, static sites)
 * import { EasyCrawl } from 'easycrawl';
 * const crawler = new EasyCrawl();
 * const snapshot = await crawler.snapshot('https://example.com');
 * const prompt = crawler.format(snapshot, 'standard');
 * 
 * // Browser mode (full interaction, JS sites like X.com)
 * import { BrowserAgent } from 'easycrawl';
 * const agent = new BrowserAgent({ llm: myLLMFunction });
 * await agent.run('https://x.com', 'Post a tweet');
 * ```
 */

import { createSnapshot, type PageSnapshot, type SnapshotOptions } from './core/snapshot';
import { formatSnapshot, generateSystemPrompt, type FormatLevel } from './core/formatter';
import { parseCommands, validateCommands, type ParsedCommand } from './actions/parser';

// ─── Main Class (Fetch Mode) ────────────────────────────────

export class EasyCrawl {
  private defaultOptions: SnapshotOptions;

  constructor(options: SnapshotOptions = {}) {
    this.defaultOptions = options;
  }

  /** Create a structured snapshot of a web page (fetch mode). */
  async snapshot(url: string, options?: SnapshotOptions): Promise<PageSnapshot> {
    return createSnapshot(url, { ...this.defaultOptions, ...options });
  }

  /** Format a snapshot for LLM consumption. */
  format(snapshot: PageSnapshot, level: FormatLevel = 'standard'): string {
    return formatSnapshot(snapshot, level);
  }

  /** Parse LLM text output into executable commands. */
  parse(text: string): ParsedCommand[] {
    return parseCommands(text);
  }

  /** Validate parsed commands against the action map. */
  validate(commands: ParsedCommand[], snapshot: PageSnapshot): { valid: ParsedCommand[]; invalid: ParsedCommand[] } {
    const validIds = new Set(snapshot.actions.map(a => a.id));
    return validateCommands(commands, validIds);
  }

  /** Get the system prompt that teaches the LLM how to interact. */
  systemPrompt(): string {
    return generateSystemPrompt();
  }

  /** Convenience: snapshot + format in one call. */
  async read(url: string, level: FormatLevel = 'standard', options?: SnapshotOptions): Promise<string> {
    const snap = await this.snapshot(url, options);
    return this.format(snap, level);
  }
}

// ─── Core Exports ────────────────────────────────────────────

export { createSnapshot } from './core/snapshot';
export { formatSnapshot, generateSystemPrompt } from './core/formatter';
export { buildActionMap } from './core/actionMap';
export { parseCommands, validateCommands } from './actions/parser';

// Extractors
export { extractNavigation } from './extractors/navigation';
export { extractForms } from './extractors/forms';
export { extractContent } from './extractors/content';
export { extractMedia } from './extractors/media';
export { classifyPage } from './extractors/pageType';

// Types
export type { PageSnapshot, SnapshotOptions, NavItem, ContentBlock, ImageInfo, FormInfo, FormField, PageMeta } from './core/snapshot';
export type { ActionItem } from './core/actionMap';
export type { FormatLevel } from './core/formatter';
export type { ParsedCommand } from './actions/parser';

// ─── Browser Mode Exports ────────────────────────────────────

export { BrowserEngine } from './browser/engine';
export type { BrowserEngineOptions } from './browser/engine';

export { createBrowserSnapshot } from './browser/snapshot';
export type { BrowserSnapshotOptions } from './browser/snapshot';

export { ActionExecutor } from './actions/executor';
export type { ExecutionResult, ExecutorOptions } from './actions/executor';

export { SessionTracker } from './session/tracker';
export type { SessionState, PageVisit, ActionRecord, ErrorRecord } from './session/tracker';

export { BrowserAgent } from './session/agent';
export type { LLMFunction, AgentOptions, AgentStep, AgentResult } from './session/agent';
