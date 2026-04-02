/**
 * ActionExecutor — The hands. Takes parsed commands and executes them
 * on a live Playwright page.
 * 
 * Resolution strategy (in order):
 * 1. Role + accessible name (getByRole — most reliable for Playwright)
 * 2. Selector chain from action map (selectors[] array, tried in order)
 * 3. Text-based heuristic search (label matching)
 * 4. ARIA label fallback
 */

import type { Page, Locator } from 'playwright';
import type { ParsedCommand } from './parser';
import type { ActionItem } from '../core/actionMap';
import type { PageSnapshot } from '../core/snapshot';

// ─── Types ───────────────────────────────────────────────────

export interface ExecutionResult {
  command: ParsedCommand;
  status: 'ok' | 'error' | 'navigated';
  message: string;
  newUrl?: string;
  durationMs: number;
}

export interface ExecutorOptions {
  minDelay?: number;       // default: 200
  maxDelay?: number;       // default: 800
  typeDelay?: number;      // default: 50 (per char)
  elementTimeout?: number; // default: 10000
  navigationTimeout?: number; // default: 30000
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

  async executeAll(commands: ParsedCommand[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (const cmd of commands) {
      if (results.length > 0) await this.humanDelay();

      const result = await this.execute(cmd);
      results.push(result);

      if (result.status === 'navigated') break;
    }

    return results;
  }

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
      return { command: cmd, status: 'error', message: err.message || String(err), durationMs: Date.now() - start };
    }
  }

  // ─── Action Implementations ──────────────────────────────

  private async execClick(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    const action = this.findAction(cmd.target!);
    if (!action) return this.notFound(cmd, start);

    const locator = await this.resolveElement(action);
    if (!locator) return this.notFound(cmd, start, `Element not found in DOM for "${action.label}" (tried ${action.selectors.length} selectors + role/text)`);

    const urlBefore = this.page.url();

    const [_nav] = await Promise.all([
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
    if (!locator) return this.notFound(cmd, start, `Input not found for "${action.label}"`);

    // Contenteditable elements need keyboard.type, not fill()
    if (action.type === 'contenteditable') {
      await locator.click({ timeout: this.options.elementTimeout });
      // Select all existing text and replace
      await this.page.keyboard.press('Control+A');
      await this.page.keyboard.press('Backspace');
      await this.page.keyboard.type(cmd.value || '', { delay: this.options.typeDelay });
    } else {
      await locator.click({ timeout: this.options.elementTimeout });
      await locator.fill('');
      await locator.type(cmd.value || '', { delay: this.options.typeDelay });
    }

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
    if (!locator) return this.notFound(cmd, start, `Select not found for "${action.label}"`);

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

    return { command: cmd, status: 'ok', message: `Scrolled ${cmd.value}`, durationMs: Date.now() - start };
  }

  private async execBack(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    await this.page.goBack({ timeout: this.options.navigationTimeout });
    return { command: cmd, status: 'navigated', message: `Went back to ${this.page.url()}`, newUrl: this.page.url(), durationMs: Date.now() - start };
  }

  private async execGoto(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    if (!cmd.value) return { command: cmd, status: 'error', message: 'No URL provided', durationMs: Date.now() - start };
    await this.page.goto(cmd.value, { timeout: this.options.navigationTimeout, waitUntil: 'domcontentloaded' });
    return { command: cmd, status: 'navigated', message: `Navigated to ${cmd.value}`, newUrl: this.page.url(), durationMs: Date.now() - start };
  }

  private async execWait(cmd: ParsedCommand, start: number): Promise<ExecutionResult> {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch { /* timeout is fine */ }
    return { command: cmd, status: 'ok', message: 'Waited for page to settle', durationMs: Date.now() - start };
  }

  // ─── Element Resolution (4-tier) ─────────────────────────

  private findAction(id: string): ActionItem | undefined {
    return this.snapshot.actions.find(a => a.id === id);
  }

  /**
   * Resolve an ActionItem to a visible Playwright Locator.
   * 
   * Strategy order:
   * 1. getByRole + name (most reliable for Playwright)
   * 2. Selector chain from action map (selectors[])
   * 3. Text-based heuristic search
   * 4. ARIA label fallback
   */
  private async resolveElement(action: ActionItem): Promise<Locator | null> {
    // Strategy 1: Role + accessible name (Playwright-native, most resilient)
    if (action.role && action.ariaName) {
      try {
        const roleLoc = this.page.getByRole(action.role as any, { name: action.ariaName, exact: false }).first();
        if (await this.isUsable(roleLoc)) return roleLoc;
      } catch { /* role not supported or no match */ }
    }

    // Strategy 2: Selector chain (ordered best → worst)
    if (action.selectors) {
      for (const sel of action.selectors) {
        try {
          const loc = this.page.locator(sel).first();
          if (await this.isUsable(loc)) return loc;
        } catch { /* invalid selector — skip */ }
      }
    }

    // Strategy 3: Text-based search (for buttons/links)
    if (action.label) {
      const textCandidates = this.getTextCandidates(action);
      for (const loc of textCandidates) {
        try {
          if (await this.isUsable(loc)) return loc;
        } catch { continue; }
      }
    }

    // Strategy 4: Placeholder (for inputs)
    if (action.placeholder) {
      try {
        const loc = this.page.getByPlaceholder(action.placeholder, { exact: false }).first();
        if (await this.isUsable(loc)) return loc;
      } catch { /* nope */ }
    }

    return null;
  }

  /**
   * Generate text-based candidate locators based on action type.
   */
  private getTextCandidates(action: ActionItem): Locator[] {
    const label = action.label;
    switch (action.type) {
      case 'button':
        return [
          this.page.getByRole('button', { name: label, exact: false }).first(),
          this.page.locator(`button >> text="${label}"`).first(),
          this.page.locator(`[role="button"] >> text="${label}"`).first(),
        ];
      case 'link':
      case 'nav':
        return [
          this.page.getByRole('link', { name: label, exact: false }).first(),
          this.page.locator(`a >> text="${label}"`).first(),
        ];
      case 'input':
      case 'textarea':
      case 'contenteditable':
        return [
          this.page.getByLabel(label, { exact: false }).first(),
          this.page.getByPlaceholder(label, { exact: false }).first(),
        ];
      default:
        return [];
    }
  }

  /**
   * Check if a locator points to a visible, attached element.
   */
  private async isUsable(locator: Locator): Promise<boolean> {
    try {
      const count = await locator.count();
      if (count === 0) return false;
      return await locator.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private async humanDelay(): Promise<void> {
    const delay = this.options.minDelay + Math.random() * (this.options.maxDelay - this.options.minDelay);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private notFound(cmd: ParsedCommand, start: number, detail?: string): ExecutionResult {
    return { command: cmd, status: 'error', message: detail || `Action ${cmd.target} not found in snapshot`, durationMs: Date.now() - start };
  }

  updateSnapshot(snapshot: PageSnapshot): void {
    this.snapshot = snapshot;
  }
}
