/**
 * ActionExecutor — The hands. Takes parsed commands and executes them
 * on a live Playwright page.
 * 
 * Design:
 * - Each action returns a result (success/fail + what changed)
 * - Human-like delays between actions (configurable)
 * - Smart element resolution: tries selector from action map first,
 *   falls back to text-based search
 * - Error recovery: if element not found, returns error (doesn't throw)
 */

import type { Page, ElementHandle, Locator } from 'playwright';
import type { ParsedCommand } from './parser';
import type { ActionItem } from '../core/actionMap';
import type { PageSnapshot } from '../core/snapshot';

// ─── Types ───────────────────────────────────────────────────

export interface ExecutionResult {
  command: ParsedCommand;
  status: 'ok' | 'error' | 'navigated';
  /** What happened */
  message: string;
  /** New URL if navigation occurred */
  newUrl?: string;
  /** How long the action took (ms) */
  durationMs: number;
}

export interface ExecutorOptions {
  /** Min delay between actions in ms (default: 200) */
  minDelay?: number;
  /** Max delay between actions in ms (default: 800) */
  maxDelay?: number;
  /** Typing delay per character in ms (default: 50) */
  typeDelay?: number;
  /** Timeout for finding elements (default: 10000) */
  elementTimeout?: number;
  /** Timeout for navigation (default: 30000) */
  navigationTimeout?: number;
}

// ─── Executor ────────────────────────────────────────────────

export class ActionExecutor {
  private page: Page;
  private snapshot: PageSnapshot;
  private options: Required<ExecutorOptions>;

  constructor(page: Page, snapshot: PageSnapshot, options: ExecutorOptions = {}) {
    this.page = page;
    this.snapshot = snapshot;
    this.options = {
      minDelay: options.minDelay ?? 200,
      maxDelay: options.maxDelay ?? 800,
      typeDelay: options.typeDelay ?? 50,
      elementTimeout: options.elementTimeout ?? 10000,
      navigationTimeout: options.navigationTimeout ?? 30000,
    };
  }

  /**
   * Execute a list of commands sequentially.
   * Returns results for each command.
   */
  async executeAll(commands: ParsedCommand[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (const cmd of commands) {
      // Human-like delay between actions
      if (results.length > 0) {
        await this.humanDelay();
      }

      const result = await this.execute(cmd);
      results.push(result);

      // Stop on navigation (page changed, need re-snapshot)
      if (result.status === 'navigated') break;
      // Stop on critical error? No — keep going, let caller decide
    }

    return results;
  }

  /**
   * Execute a single command.
   */
  async execute(cmd: ParsedCommand): Promise<ExecutionResult> {
    const start = Date.now();

    try {
      switch (cmd.action) {
        case 'click': return await this.execClick(cmd, start);
        case 'fill': return await this.execFill(cmd, start);
        case 'select': return await this.execSelect(cmd, start);
        case 'check': return await this.execCheck(cmd, true, start);
        case 'uncheck': return await this.execCheck(cmd, false, start);
        case 'scroll': return await this.execScroll(cmd, start);
        case 'back': return await this.execBack(cmd, start);
        case 'goto': return await this.execGoto(cmd, start);
        case 'wait': return await this.execWait(cmd, start);
        case 'done': return { command: cmd, status: 'ok', message: `Task complete: ${cmd.value || 'done'}`, durationMs: Date.now() - start };
        default: return { command: cmd, status: 'error', message: `Unknown action: ${cmd.action}`, durationMs: Date.now() - start };
      }
    } catch (err: any) {
      return {
        command: cmd,
        status: 'error',
        message: err.message || String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ─── Action Implementations ──────────────────────────────

  private async execClick(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    const action = this.findAction(cmd.target!);
    if (!action) return this.notFound(cmd, start);

    const locator = await this.resolveElement(action);
    if (!locator) return this.notFound(cmd, start, `Element not found in DOM: ${action.selector}`);

    const urlBefore = this.page.url();

    // Click with navigation detection
    const [response] = await Promise.all([
      this.page.waitForNavigation({ timeout: 5000 }).catch(() => null),
      locator.click({ timeout: this.options.elementTimeout }),
    ]);

    const urlAfter = this.page.url();
    const navigated = urlAfter !== urlBefore;

    return {
      command: cmd,
      status: navigated ? 'navigated' : 'ok',
      message: navigated
        ? `Clicked "${action.label}" → navigated to ${urlAfter}`
        : `Clicked "${action.label}"`,
      newUrl: navigated ? urlAfter : undefined,
      durationMs: Date.now() - start,
    };
  }

  private async execFill(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    const action = this.findAction(cmd.target!);
    if (!action) return this.notFound(cmd, start);

    const locator = await this.resolveElement(action);
    if (!locator) return this.notFound(cmd, start, `Input not found: ${action.selector}`);

    // Clear existing content first, then type with human-like delay
    await locator.click({ timeout: this.options.elementTimeout });
    await locator.fill(''); // Clear
    await locator.type(cmd.value || '', { delay: this.options.typeDelay });

    return {
      command: cmd,
      status: 'ok',
      message: `Filled "${action.label}" with "${cmd.value}"`,
      durationMs: Date.now() - start,
    };
  }

  private async execSelect(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    const action = this.findAction(cmd.target!);
    if (!action) return this.notFound(cmd, start);

    const locator = await this.resolveElement(action);
    if (!locator) return this.notFound(cmd, start, `Select not found: ${action.selector}`);

    await locator.selectOption({ label: cmd.value || '' });

    return {
      command: cmd,
      status: 'ok',
      message: `Selected "${cmd.value}" in "${action.label}"`,
      durationMs: Date.now() - start,
    };
  }

  private async execCheck(cmd: ParsedCommand, check: boolean, start: number): Promise<ExecutionResult> {
    const action = this.findAction(cmd.target!);
    if (!action) return this.notFound(cmd, start);

    const locator = await this.resolveElement(action);
    if (!locator) return this.notFound(cmd, start);

    if (check) {
      await locator.check({ timeout: this.options.elementTimeout });
    } else {
      await locator.uncheck({ timeout: this.options.elementTimeout });
    }

    return {
      command: cmd,
      status: 'ok',
      message: `${check ? 'Checked' : 'Unchecked'} "${action.label}"`,
      durationMs: Date.now() - start,
    };
  }

  private async execScroll(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    const direction = cmd.value === 'up' ? -1 : 1;
    await this.page.evaluate((dir) => {
      window.scrollBy(0, dir * window.innerHeight * 0.8);
    }, direction);

    return {
      command: cmd,
      status: 'ok',
      message: `Scrolled ${cmd.value}`,
      durationMs: Date.now() - start,
    };
  }

  private async execBack(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    await this.page.goBack({ timeout: this.options.navigationTimeout });
    return {
      command: cmd,
      status: 'navigated',
      message: `Went back to ${this.page.url()}`,
      newUrl: this.page.url(),
      durationMs: Date.now() - start,
    };
  }

  private async execGoto(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    if (!cmd.value) return { command: cmd, status: 'error', message: 'No URL provided', durationMs: Date.now() - start };

    await this.page.goto(cmd.value, {
      timeout: this.options.navigationTimeout,
      waitUntil: 'domcontentloaded',
    });

    return {
      command: cmd,
      status: 'navigated',
      message: `Navigated to ${cmd.value}`,
      newUrl: this.page.url(),
      durationMs: Date.now() - start,
    };
  }

  private async execWait(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    // Wait for any pending network activity to settle
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch {
      // Timed out waiting for network idle — that's OK
    }

    return {
      command: cmd,
      status: 'ok',
      message: 'Waited for page to settle',
      durationMs: Date.now() - start,
    };
  }

  // ─── Element Resolution ──────────────────────────────────

  /**
   * Find an ActionItem by ID (e.g., "a7")
   */
  private findAction(id: string): ActionItem | undefined {
    return this.snapshot.actions.find(a => a.id === id);
  }

  /**
   * Resolve an ActionItem to a Playwright Locator.
   * Tries multiple strategies:
   * 1. CSS selector from action map
   * 2. Text-based search
   * 3. ARIA label search
   */
  private async resolveElement(action: ActionItem): Promise<Locator | null> {
    // Strategy 1: Direct CSS selector
    if (action.selector) {
      try {
        const locator = this.page.locator(action.selector).first();
        if (await locator.count() > 0) {
          // Verify it's visible
          const visible = await locator.isVisible().catch(() => false);
          if (visible) return locator;
        }
      } catch {
        // Invalid selector — try next strategy
      }
    }

    // Strategy 2: Text-based search
    if (action.label) {
      const candidates: Locator[] = [];

      // Exact text match
      switch (action.type) {
        case 'button':
          candidates.push(
            this.page.locator(`button:has-text("${escapeQuotes(action.label)}")`).first(),
            this.page.locator(`[role="button"]:has-text("${escapeQuotes(action.label)}")`).first(),
            this.page.locator(`input[type="submit"][value="${escapeQuotes(action.label)}"]`).first(),
          );
          break;
        case 'link':
        case 'nav':
          candidates.push(
            this.page.locator(`a:has-text("${escapeQuotes(action.label)}")`).first(),
          );
          break;
        case 'input':
        case 'textarea':
          candidates.push(
            this.page.locator(`label:has-text("${escapeQuotes(action.label)}") + input`).first(),
            this.page.locator(`label:has-text("${escapeQuotes(action.label)}") + textarea`).first(),
            this.page.locator(`[placeholder="${escapeQuotes(action.placeholder || action.label)}"]`).first(),
            this.page.locator(`[aria-label="${escapeQuotes(action.label)}"]`).first(),
          );
          break;
        case 'select':
          candidates.push(
            this.page.locator(`label:has-text("${escapeQuotes(action.label)}") + select`).first(),
            this.page.locator(`select[aria-label="${escapeQuotes(action.label)}"]`).first(),
          );
          break;
        case 'checkbox':
        case 'radio':
          candidates.push(
            this.page.locator(`label:has-text("${escapeQuotes(action.label)}") input[type="${action.type}"]`).first(),
          );
          break;
      }

      for (const loc of candidates) {
        try {
          if (await loc.count() > 0) {
            const visible = await loc.isVisible().catch(() => false);
            if (visible) return loc;
          }
        } catch {
          continue;
        }
      }
    }

    // Strategy 3: ARIA label
    if (action.label) {
      const ariaLoc = this.page.locator(`[aria-label="${escapeQuotes(action.label)}"]`).first();
      try {
        if (await ariaLoc.count() > 0 && await ariaLoc.isVisible().catch(() => false)) {
          return ariaLoc;
        }
      } catch { /* nope */ }
    }

    return null;
  }

  // ─── Helpers ─────────────────────────────────────────────

  private async humanDelay(): Promise<void> {
    const delay = this.options.minDelay + Math.random() * (this.options.maxDelay - this.options.minDelay);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private notFound(cmd: ParsedCommand, start: number, detail?: string): ExecutionResult {
    return {
      command: cmd,
      status: 'error',
      message: detail || `Action ${cmd.target} not found in snapshot`,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Update the snapshot (call after navigation or dynamic content changes).
   */
  updateSnapshot(snapshot: PageSnapshot): void {
    this.snapshot = snapshot;
  }
}

function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}
