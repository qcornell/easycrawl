/**
 * BrowserAgent — The complete agent loop.
 * 
 * Ties together: BrowserEngine + BrowserSnapshot + Executor + SessionTracker
 * 
 * Usage:
 *   const agent = new BrowserAgent({ llm: myLLMFunction });
 *   await agent.run('https://x.com', 'Post a tweet saying "Hello world"');
 * 
 * The LLM function receives formatted page snapshots and returns commands.
 * Everything else (browser, execution, state, retries) is handled automatically.
 */

import type { Page } from 'playwright';
import { BrowserEngine, type BrowserEngineOptions } from '../browser/engine';
import { createBrowserSnapshot, type BrowserSnapshotOptions } from '../browser/snapshot';
import { ActionExecutor, type ExecutorOptions, type ExecutionResult } from '../actions/executor';
import { parseCommands, type ParsedCommand } from '../actions/parser';
import { formatSnapshot, generateSystemPrompt, type FormatLevel } from '../core/formatter';
import { SessionTracker } from './tracker';
import type { PageSnapshot } from '../core/snapshot';

// ─── Types ───────────────────────────────────────────────────

/**
 * LLM function signature. Takes system + user messages, returns text.
 * Plug in any model: GPT-4o-mini, Claude, Llama, etc.
 */
export type LLMFunction = (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<string>;

export interface AgentOptions {
  /** The LLM function to use for decisions */
  llm: LLMFunction;
  /** Browser engine options */
  browser?: BrowserEngineOptions;
  /** Executor options (delays, timeouts) */
  executor?: ExecutorOptions;
  /** Snapshot options */
  snapshot?: BrowserSnapshotOptions;
  /** Format level for LLM prompts */
  formatLevel?: FormatLevel;
  /** Max steps before stopping (default: 30) */
  maxSteps?: number;
  /** Browser context name for cookie persistence */
  contextName?: string;
  /** Callback for each step (for logging/UI) */
  onStep?: (step: AgentStep) => void;
  /** Callback when done */
  onDone?: (result: AgentResult) => void;
}

export interface AgentStep {
  stepNumber: number;
  url: string;
  pageTitle: string;
  snapshot: PageSnapshot;
  llmResponse: string;
  commands: ParsedCommand[];
  results: ExecutionResult[];
}

export interface AgentResult {
  success: boolean;
  message: string;
  steps: AgentStep[];
  totalDurationMs: number;
  pagesVisited: string[];
}

// ─── Browser Agent ───────────────────────────────────────────

export class BrowserAgent {
  private engine: BrowserEngine;
  private llm: LLMFunction;
  private options: AgentOptions;
  private tracker: SessionTracker | null = null;
  private conversationHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  constructor(options: AgentOptions) {
    this.llm = options.llm;
    this.options = options;
    this.engine = new BrowserEngine(options.browser);
  }

  /**
   * Run the agent on a task.
   * Opens the URL, loops snapshot→LLM→execute until done or max steps.
   */
  async run(startUrl: string, task: string): Promise<AgentResult> {
    const startTime = Date.now();
    const maxSteps = this.options.maxSteps || 30;
    const contextName = this.options.contextName || 'default';
    const steps: AgentStep[] = [];

    // Initialize
    this.tracker = new SessionTracker({
      goal: task,
      maxSteps,
      startUrl,
    });

    // Set up conversation with system prompt
    this.conversationHistory = [
      { role: 'system', content: generateSystemPrompt() },
    ];

    // Get a page
    const page = await this.engine.getPage(contextName);

    // Navigate to start
    await page.goto(startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    let currentUrl = startUrl;
    let done = false;

    for (let step = 1; step <= maxSteps && !done; step++) {
      // 1. Snapshot current page
      const snapshot = await createBrowserSnapshot(page, this.options.snapshot);
      this.tracker.recordPageVisit(snapshot);

      // 2. Format for LLM
      const formatted = formatSnapshot(snapshot, this.options.formatLevel || 'standard');
      const sessionContext = this.tracker.getContextSummary();

      const userMessage = step === 1
        ? `Task: ${task}\n\nSession:\n${sessionContext}\n\nCurrent page:\n${formatted}`
        : `Session:\n${sessionContext}\n\nCurrent page:\n${formatted}`;

      this.conversationHistory.push({ role: 'user', content: userMessage });

      // 3. Ask LLM
      const llmResponse = await this.llm(this.conversationHistory);
      this.conversationHistory.push({ role: 'assistant', content: llmResponse });

      // Keep conversation history manageable (last 10 exchanges)
      if (this.conversationHistory.length > 22) {
        // Keep system prompt + last 10 pairs
        this.conversationHistory = [
          this.conversationHistory[0],
          ...this.conversationHistory.slice(-20),
        ];
      }

      // 4. Parse and validate commands
      const commands = parseCommands(llmResponse);

      // Check for "done"
      const doneCmd = commands.find(c => c.action === 'done');
      if (doneCmd) {
        done = true;
      }

      // 5. Validate targets against snapshot, execute only valid ones
      const executableCommands = commands.filter(c => c.action !== 'done' && c.action !== 'unknown');
      const validIds = new Set(snapshot.actions.map(a => a.id));
      const validCommands: typeof executableCommands = [];
      const invalidCommands: typeof executableCommands = [];

      for (const cmd of executableCommands) {
        // Commands without targets (scroll, back, goto, wait) are always valid
        if (!cmd.target || validIds.has(cmd.target)) {
          validCommands.push(cmd);
        } else {
          invalidCommands.push(cmd);
        }
      }

      // If there were invalid commands, append feedback to conversation
      if (invalidCommands.length > 0) {
        const feedback = invalidCommands.map(c => `${c.action} ${c.target}: target not found`).join('; ');
        this.conversationHistory.push({
          role: 'user',
          content: `⚠ Invalid commands skipped: ${feedback}. Available action IDs: ${[...validIds].join(', ')}`,
        });
      }

      let results: ExecutionResult[] = [];

      if (validCommands.length > 0) {
        const executor = new ActionExecutor(page, snapshot, this.options.executor);
        results = await executor.executeAll(validCommands);
        this.tracker.recordResults(results);

        // If navigated, check for cookie save
        const navigated = results.find(r => r.status === 'navigated');
        if (navigated?.newUrl) {
          currentUrl = navigated.newUrl;
          // Wait for new page to load
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        }
      }

      // Build step record
      const agentStep: AgentStep = {
        stepNumber: step,
        url: currentUrl,
        pageTitle: snapshot.title,
        snapshot,
        llmResponse,
        commands,
        results,
      };
      steps.push(agentStep);

      // Callback
      this.options.onStep?.(agentStep);

      // Save cookies periodically
      if (step % 5 === 0) {
        await this.engine.saveCookies(contextName);
      }
    }

    // Save cookies at end
    await this.engine.saveCookies(contextName);

    const result: AgentResult = {
      success: done,
      message: done
        ? steps[steps.length - 1]?.commands.find(c => c.action === 'done')?.value || 'Task completed'
        : `Stopped after ${steps.length} steps (max: ${maxSteps})`,
      steps,
      totalDurationMs: Date.now() - startTime,
      pagesVisited: this.tracker.getHistory(),
    };

    this.options.onDone?.(result);
    return result;
  }

  /**
   * Execute a single command on the current page (manual mode).
   * Useful for step-by-step control or testing.
   */
  async step(page: Page, command: string): Promise<{ snapshot: PageSnapshot; results: ExecutionResult[] }> {
    const snapshot = await createBrowserSnapshot(page, this.options.snapshot);
    const commands = parseCommands(command);
    const executor = new ActionExecutor(page, snapshot, this.options.executor);
    const results = await executor.executeAll(commands);
    return { snapshot, results };
  }

  /**
   * Get the browser engine (for direct page access).
   */
  getEngine(): BrowserEngine {
    return this.engine;
  }

  /**
   * Get session tracker (for state inspection).
   */
  getTracker(): SessionTracker | null {
    return this.tracker;
  }

  /**
   * Shut down the agent and browser.
   */
  async shutdown(): Promise<void> {
    await this.engine.shutdown();
  }
}
