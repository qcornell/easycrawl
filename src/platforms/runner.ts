/**
 * PlaybookRunner — Executes platform flows step-by-step.
 * 
 * Strategy: deterministic first → AI fallback → retry → skip/abort.
 * This is the "hybrid automation" layer that sits between the platform
 * playbook definitions and the Playwright executor.
 * 
 * When a hardcoded selector works: ~50ms, zero tokens.
 * When AI fallback needed: ~2-5s, ~300-500 tokens (cheap model).
 * 
 * Memory: saves which selectors worked per step. Next run tries
 * the last-successful selector first (learning from experience).
 */

import type { Page, Locator } from 'playwright';
import type {
  Platform, Flow, PlaybookStep, StepAction, VerifyCheck,
  FlowRun, StepResult, FlowMemory, RunnerOptions,
} from './types';
import { getPlatform, getFlow } from './registry';
import { createBrowserSnapshot } from '../browser/snapshot';
import { formatSnapshot } from '../core/formatter';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ─── Runner ──────────────────────────────────────────────────

export class PlaybookRunner {
  private page: Page;
  private options: RunnerOptions;
  private memoryDir: string;
  private memoryCache: Map<string, FlowMemory> = new Map();

  constructor(page: Page, options: RunnerOptions = {}) {
    this.page = page;
    this.options = options;
    this.memoryDir = join(process.cwd(), '.easycrawl-data', 'memory');
  }

  /**
   * Run a platform flow with the given parameters.
   */
  async runFlow(
    platformId: string,
    flowId: string,
    params: Record<string, string>
  ): Promise<FlowRun> {
    const platform = getPlatform(platformId);
    if (!platform) throw new Error(`Unknown platform: ${platformId}`);

    const flow = platform.flows.find(f => f.id === flowId);
    if (!flow) throw new Error(`Unknown flow: ${flowId} on ${platformId}`);

    // Load memory for this flow
    const memory = await this.loadMemory(platformId, flowId);

    // Validate required params
    for (const p of flow.params) {
      if (p.required && !params[p.id]) {
        throw new Error(`Missing required parameter: ${p.id}`);
      }
    }

    // Initialize run record
    const run: FlowRun = {
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      platform: platformId,
      flowId,
      flowName: flow.name,
      params,
      status: 'running',
      steps: [],
      startedAt: Date.now(),
    };

    this.options.onStepUpdate?.(run);

    // Check login status
    const loggedIn = await this.checkLogin(platform);
    if (!loggedIn) {
      run.status = 'failed';
      run.error = `Not logged in to ${platform.name}. Please log in via the browser first.`;
      run.completedAt = Date.now();
      this.options.onStepUpdate?.(run);
      return run;
    }

    // Execute steps
    for (const step of flow.steps) {
      const stepResult = await this.executeStep(step, params, memory);
      run.steps.push(stepResult);
      this.options.onStepUpdate?.(run);

      if (stepResult.status === 'failed') {
        if (step.onFail === 'abort') {
          run.status = 'aborted';
          run.error = `Aborted at step "${step.id}": ${stepResult.message}`;
          break;
        }
        // 'skip' continues to next step, 'retry'/'ai' are already handled in executeStep
      }
    }

    // Finalize
    if (run.status === 'running') {
      run.status = 'success';
    }
    run.completedAt = Date.now();

    // Save memory
    await this.saveMemory(platformId, flowId, memory, run);

    this.options.onStepUpdate?.(run);
    return run;
  }

  // ─── Step Execution ──────────────────────────────────────

  private async executeStep(
    step: PlaybookStep,
    params: Record<string, string>,
    memory: FlowMemory
  ): Promise<StepResult> {
    const start = Date.now();
    const result: StepResult = {
      stepId: step.id,
      description: step.description,
      method: 'deterministic',
      status: 'running',
      message: '',
      durationMs: 0,
    };

    // Resolve template variables in action
    const action = this.resolveTemplates(step.action, params);

    // Try deterministic execution
    const maxAttempts = 1 + (step.retries || 0);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check if memory has a preferred selector for this step
        const memorizedSelector = memory.selectorHits[step.id];

        const selectorUsed = await this.executeDeterministic(action, memorizedSelector);

        if (selectorUsed) {
          // Success! Record which selector worked
          result.status = 'ok';
          result.message = `✓ ${step.description}`;
          result.selectorUsed = selectorUsed;
          memory.selectorHits[step.id] = selectorUsed;

          // Run verification if needed
          if (step.verify) {
            await this.runVerify(step.verify);
          }

          // Delay after step
          if (step.delayAfterMs) {
            await this.sleep(step.delayAfterMs);
          }

          result.durationMs = Date.now() - start;
          return result;
        }
      } catch (err: any) {
        // Deterministic failed — will try AI fallback or retry
      }

      // Retry delay
      if (attempt < maxAttempts - 1) {
        await this.sleep(500);
      }
    }

    // Deterministic failed — try AI fallback if configured
    if (step.onFail === 'ai' && this.options.llm) {
      result.method = 'ai_fallback';
      try {
        const aiResult = await this.executeWithAI(step, params);
        if (aiResult) {
          result.status = 'ok';
          result.message = `✓ ${step.description} (AI fallback)`;

          if (step.verify) {
            await this.runVerify(step.verify);
          }
          if (step.delayAfterMs) {
            await this.sleep(step.delayAfterMs);
          }

          result.durationMs = Date.now() - start;
          return result;
        }
      } catch (err: any) {
        result.message = `AI fallback failed: ${err.message}`;
      }
    }

    // All attempts failed
    if (step.onFail === 'skip') {
      result.status = 'skipped';
      result.message = `⊘ Skipped: ${step.description}`;
    } else {
      result.status = 'failed';
      result.message = result.message || `✗ Failed: ${step.description}`;
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  /**
   * Try to execute an action using hardcoded selectors.
   * Returns the selector that worked, or null if none did.
   */
  private async executeDeterministic(
    action: StepAction,
    preferredSelector?: string
  ): Promise<string | null> {
    switch (action.type) {
      case 'navigate':
        await this.page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return 'navigate';

      case 'wait':
        await this.sleep(action.ms);
        return 'wait';

      case 'scroll':
        const direction = action.direction === 'up' ? -1 : 1;
        const amount = action.amount || 0.8;
        await this.page.evaluate(([dir, amt]) => {
          window.scrollBy(0, dir * window.innerHeight * amt);
        }, [direction, amount] as [number, number]);
        return 'scroll';

      case 'press':
        if (action.selectors?.length) {
          const loc = await this.findFirst(action.selectors, preferredSelector);
          if (loc.locator) {
            await loc.locator.focus().catch(() => {});
          }
        }
        await this.page.keyboard.press(action.key);
        return 'press';

      case 'click': {
        // Try role-based first (most resilient)
        if (action.role && action.roleName) {
          try {
            const roleLoc = this.page.getByRole(action.role as any, {
              name: action.roleName,
              exact: false,
            }).first();
            if (await this.isUsable(roleLoc)) {
              await roleLoc.click({ timeout: 5000 });
              return `role:${action.role}:${action.roleName}`;
            }
          } catch { /* role didn't work, try selectors */ }
        }

        // Try selectors
        const found = await this.findFirst(action.selectors, preferredSelector);
        if (found.locator) {
          try {
            await found.locator.click({ timeout: 5000 });
          } catch (err: any) {
            if (err.message?.includes('intercepts pointer events')) {
              await found.locator.click({ force: true, timeout: 5000 });
            } else throw err;
          }
          return found.selector;
        }
        return null;
      }

      case 'fill': {
        let locator: Locator | null = null;
        let usedSelector = '';

        // Role-based
        if (action.role && action.roleName) {
          try {
            const roleLoc = this.page.getByRole(action.role as any, {
              name: action.roleName,
              exact: false,
            }).first();
            if (await this.isUsable(roleLoc)) {
              locator = roleLoc;
              usedSelector = `role:${action.role}:${action.roleName}`;
            }
          } catch {}
        }

        // Selector-based
        if (!locator) {
          const found = await this.findFirst(action.selectors, preferredSelector);
          if (found.locator) {
            locator = found.locator;
            usedSelector = found.selector;
          }
        }

        if (!locator) return null;

        if (action.contenteditable) {
          // Contenteditable: click → select all → delete → type
          await locator.click({ force: true, timeout: 5000 });
          await this.sleep(300);
          await this.page.keyboard.press('Control+A');
          await this.page.keyboard.press('Backspace');
          await this.page.keyboard.type(action.text, { delay: 30 });
        } else {
          await locator.click({ timeout: 5000 });
          await locator.fill('');
          await locator.type(action.text, { delay: 30 });
        }

        return usedSelector;
      }

      default:
        return null;
    }
  }

  /**
   * AI fallback: snapshot the page, ask a cheap model what to do.
   */
  private async executeWithAI(
    step: PlaybookStep,
    params: Record<string, string>
  ): Promise<boolean> {
    const llm = this.options.llm!;

    // Snapshot current page
    const snapshot = await createBrowserSnapshot(this.page, {
      waitForNetworkIdle: false,
      extraWaitMs: 500,
    });
    const formatted = formatSnapshot(snapshot, 'standard');

    // Resolve action description with params
    const actionDesc = this.resolveTemplates(step.action, params);
    let taskHint = step.description;
    if (actionDesc.type === 'fill') {
      taskHint += ` (text: "${actionDesc.text}")`;
    }

    // Ask LLM
    const messages = [
      {
        role: 'system' as const,
        content: `You are a browser automation assistant. Look at the page and execute exactly one action to accomplish the task. Respond with a single command line. Available commands: click #N, fill #N "text", press Enter, scroll down/up.`,
      },
      {
        role: 'user' as const,
        content: `Task: ${taskHint}\n\nPage:\n${formatted}`,
      },
    ];

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (llm.apiKey) headers['Authorization'] = `Bearer ${llm.apiKey}`;

    const resp = await fetch(`${llm.apiBase || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: llm.model || 'gpt-4o-mini',
        messages,
        temperature: 0.1,
        max_tokens: 100,
      }),
    });

    if (!resp.ok) return false;

    const data = await resp.json() as any;
    const text = data.choices?.[0]?.message?.content || '';

    // Parse and execute the LLM's command
    const { parseCommands } = await import('../actions/parser');
    const { ActionExecutor } = await import('../actions/executor');

    const commands = parseCommands(text);
    if (commands.length === 0) return false;

    const executor = new ActionExecutor(this.page, snapshot, {
      minDelay: 200,
      maxDelay: 400,
      typeDelay: 30,
    });

    const results = await executor.executeAll(commands);
    return results.some(r => r.status === 'ok' || r.status === 'navigated');
  }

  // ─── Verification ────────────────────────────────────────

  private async runVerify(check: VerifyCheck): Promise<boolean> {
    const timeout = check.timeoutMs || 5000;

    switch (check.type) {
      case 'none':
        return true;

      case 'visible':
        if (!check.selector) return true;
        try {
          await this.page.waitForSelector(check.selector, { state: 'visible', timeout });
          return true;
        } catch {
          return false;
        }

      case 'gone':
        if (!check.selector) return true;
        try {
          await this.page.waitForSelector(check.selector, { state: 'hidden', timeout });
          return true;
        } catch {
          return false;
        }

      case 'url_contains':
        if (!check.url) return true;
        try {
          await this.page.waitForURL(`**/*${check.url}*`, { timeout });
          return true;
        } catch {
          return this.page.url().includes(check.url);
        }

      case 'url_changed':
        return true; // Handled by the executor's navigation detection

      case 'text_on_page':
        if (!check.text) return true;
        try {
          await this.page.waitForFunction(
            (t: string) => document.body.innerText.includes(t),
            check.text,
            { timeout }
          );
          return true;
        } catch {
          return false;
        }

      default:
        return true;
    }
  }

  // ─── Login Check ─────────────────────────────────────────

  private async checkLogin(platform: Platform): Promise<boolean> {
    const url = this.page.url();

    // Check URL patterns that indicate not logged in
    for (const pattern of platform.loginCheck.loginUrlPatterns) {
      if (url.includes(pattern)) return false;
    }

    // Check for logged-in indicators
    for (const selector of platform.loginCheck.loggedInSelectors) {
      try {
        const el = this.page.locator(selector).first();
        if (await el.isVisible().catch(() => false)) return true;
      } catch {}
    }

    // If we're on the base URL and no indicator found, try navigating home first
    if (!url.includes(platform.baseUrl)) {
      await this.page.goto(platform.baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.sleep(2000);

      // Re-check login URL patterns
      const newUrl = this.page.url();
      for (const pattern of platform.loginCheck.loginUrlPatterns) {
        if (newUrl.includes(pattern)) return false;
      }

      // Re-check selectors
      for (const selector of platform.loginCheck.loggedInSelectors) {
        try {
          const el = this.page.locator(selector).first();
          if (await el.isVisible().catch(() => false)) return true;
        } catch {}
      }
    }

    // No definitive answer — assume logged in (CDP mode with existing session)
    return true;
  }

  // ─── Helpers ─────────────────────────────────────────────

  /**
   * Find the first visible element from a list of selectors.
   * Tries preferred (memorized) selector first.
   */
  private async findFirst(
    selectors: string[],
    preferred?: string
  ): Promise<{ locator: Locator | null; selector: string }> {
    // Try preferred first
    if (preferred && !preferred.startsWith('role:') && preferred !== 'navigate' && preferred !== 'scroll' && preferred !== 'wait' && preferred !== 'press') {
      try {
        const loc = this.page.locator(preferred).first();
        if (await this.isUsable(loc)) return { locator: loc, selector: preferred };
      } catch {}
    }

    // Try each selector
    for (const sel of selectors) {
      try {
        const loc = this.page.locator(sel).first();
        if (await this.isUsable(loc)) return { locator: loc, selector: sel };
      } catch {}
    }

    return { locator: null, selector: '' };
  }

  private async isUsable(locator: Locator): Promise<boolean> {
    try {
      const count = await locator.count();
      if (count === 0) return false;
      return await locator.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  private resolveTemplates(action: StepAction, params: Record<string, string>): StepAction {
    if (action.type !== 'fill') return action;
    let text = action.text;
    for (const [key, val] of Object.entries(params)) {
      text = text.replace(`{{${key}}}`, val);
    }
    return { ...action, text };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  // ─── Memory (learning) ───────────────────────────────────

  private memoryKey(platformId: string, flowId: string): string {
    return `${platformId}:${flowId}`;
  }

  private async loadMemory(platformId: string, flowId: string): Promise<FlowMemory> {
    const key = this.memoryKey(platformId, flowId);
    if (this.memoryCache.has(key)) return this.memoryCache.get(key)!;

    try {
      await mkdir(this.memoryDir, { recursive: true });
      const data = await readFile(join(this.memoryDir, `${key.replace(':', '_')}.json`), 'utf-8');
      const memory = JSON.parse(data) as FlowMemory;
      this.memoryCache.set(key, memory);
      return memory;
    } catch {
      const memory: FlowMemory = {
        platform: platformId,
        flowId,
        lastRun: 0,
        successCount: 0,
        failCount: 0,
        selectorHits: {},
      };
      this.memoryCache.set(key, memory);
      return memory;
    }
  }

  private async saveMemory(
    platformId: string,
    flowId: string,
    memory: FlowMemory,
    run: FlowRun
  ): Promise<void> {
    memory.lastRun = Date.now();
    if (run.status === 'success') memory.successCount++;
    else memory.failCount++;

    const key = this.memoryKey(platformId, flowId);
    this.memoryCache.set(key, memory);

    try {
      await mkdir(this.memoryDir, { recursive: true });
      await writeFile(
        join(this.memoryDir, `${key.replace(':', '_')}.json`),
        JSON.stringify(memory, null, 2)
      );
    } catch {}
  }
}
