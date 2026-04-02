/**
 * SessionTracker — Tracks state across multi-page agent sessions.
 * 
 * Remembers:
 * - Pages visited (URL + title + what was done)
 * - Actions taken on each page
 * - Form fields filled (so we don't re-fill on re-visit)
 * - Navigation history (for "back" support)
 * - Errors encountered (for retry/recovery)
 */

import type { PageSnapshot } from '../core/snapshot';
import type { ExecutionResult } from '../actions/executor';

// ─── Types ───────────────────────────────────────────────────

export interface PageVisit {
  url: string;
  title: string;
  pageType: string;
  visitedAt: number;
  actionsPerformed: ActionRecord[];
  snapshot?: PageSnapshot; // Optional: keep last snapshot for reference
}

export interface ActionRecord {
  action: string;
  target?: string;
  value?: string;
  status: 'ok' | 'error' | 'navigated';
  message: string;
  timestamp: number;
}

export interface SessionState {
  id: string;
  startedAt: number;
  goal?: string;
  pages: PageVisit[];
  currentUrl: string;
  errors: ErrorRecord[];
  stepsCompleted: number;
  maxSteps: number;
}

export interface ErrorRecord {
  url: string;
  action: string;
  error: string;
  timestamp: number;
  retryCount: number;
}

// ─── Session Tracker ─────────────────────────────────────────

export class SessionTracker {
  private state: SessionState;

  constructor(options: { id?: string; goal?: string; maxSteps?: number; startUrl?: string } = {}) {
    this.state = {
      id: options.id || `session_${Date.now()}`,
      startedAt: Date.now(),
      goal: options.goal,
      pages: [],
      currentUrl: options.startUrl || '',
      errors: [],
      stepsCompleted: 0,
      maxSteps: options.maxSteps || 50,
    };
  }

  /**
   * Record visiting a new page.
   */
  recordPageVisit(snapshot: PageSnapshot): void {
    // Check if we've been here before
    const existing = this.state.pages.find(p => p.url === snapshot.url);
    if (existing) {
      existing.visitedAt = Date.now();
      existing.snapshot = snapshot;
      return;
    }

    this.state.pages.push({
      url: snapshot.url,
      title: snapshot.title,
      pageType: snapshot.pageType,
      visitedAt: Date.now(),
      actionsPerformed: [],
      snapshot,
    });

    this.state.currentUrl = snapshot.url;
  }

  /**
   * Record execution results from the executor.
   */
  recordResults(results: ExecutionResult[]): void {
    const currentPage = this.getCurrentPage();
    if (!currentPage) return;

    for (const result of results) {
      currentPage.actionsPerformed.push({
        action: result.command.action,
        target: result.command.target,
        value: result.command.value,
        status: result.status,
        message: result.message,
        timestamp: Date.now(),
      });

      this.state.stepsCompleted++;

      if (result.status === 'error') {
        this.recordError(result);
      }

      if (result.status === 'navigated' && result.newUrl) {
        this.state.currentUrl = result.newUrl;
      }
    }
  }

  /**
   * Record an error for retry tracking.
   */
  private recordError(result: ExecutionResult): void {
    const key = `${this.state.currentUrl}:${result.command.action}:${result.command.target || ''}`;
    const existing = this.state.errors.find(e =>
      e.url === this.state.currentUrl && e.action === `${result.command.action} ${result.command.target || ''}`
    );

    if (existing) {
      existing.retryCount++;
      existing.error = result.message;
      existing.timestamp = Date.now();
    } else {
      this.state.errors.push({
        url: this.state.currentUrl,
        action: `${result.command.action} ${result.command.target || ''}`.trim(),
        error: result.message,
        timestamp: Date.now(),
        retryCount: 0,
      });
    }
  }

  /**
   * Check if we've hit the step limit.
   */
  isAtLimit(): boolean {
    return this.state.stepsCompleted >= this.state.maxSteps;
  }

  /**
   * Check if a specific action keeps failing (3+ retries).
   */
  isStuck(action: string, url?: string): boolean {
    const target = url || this.state.currentUrl;
    const err = this.state.errors.find(e => e.url === target && e.action === action);
    return (err?.retryCount ?? 0) >= 3;
  }

  /**
   * Get current page visit record.
   */
  getCurrentPage(): PageVisit | undefined {
    return this.state.pages.find(p => p.url === this.state.currentUrl);
  }

  /**
   * Generate a context summary for the LLM.
   * Tells the model where it's been and what it's done — keeps it oriented.
   */
  getContextSummary(): string {
    const lines: string[] = [];

    if (this.state.goal) {
      lines.push(`Goal: ${this.state.goal}`);
    }

    lines.push(`Steps: ${this.state.stepsCompleted}/${this.state.maxSteps}`);
    lines.push(`Current: ${this.state.currentUrl}`);

    if (this.state.pages.length > 1) {
      lines.push('');
      lines.push('Pages visited:');
      for (const page of this.state.pages.slice(-5)) {
        const actionCount = page.actionsPerformed.length;
        const marker = page.url === this.state.currentUrl ? ' ← here' : '';
        lines.push(`  ${page.title || page.url} (${page.pageType}) — ${actionCount} actions${marker}`);
      }
    }

    const recentActions = this.getRecentActions(5);
    if (recentActions.length > 0) {
      lines.push('');
      lines.push('Recent actions:');
      for (const a of recentActions) {
        const icon = a.status === 'ok' ? '✓' : a.status === 'navigated' ? '→' : '✗';
        lines.push(`  ${icon} ${a.action} ${a.target || ''} ${a.value || ''} — ${a.message}`);
      }
    }

    if (this.state.errors.length > 0) {
      const recentErrors = this.state.errors.filter(e => e.retryCount > 0).slice(-3);
      if (recentErrors.length > 0) {
        lines.push('');
        lines.push('Recurring errors:');
        for (const e of recentErrors) {
          lines.push(`  ⚠ ${e.action}: ${e.error} (${e.retryCount} retries)`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Get recent actions across all pages.
   */
  private getRecentActions(count: number): ActionRecord[] {
    const all: ActionRecord[] = [];
    for (const page of this.state.pages) {
      all.push(...page.actionsPerformed);
    }
    return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, count).reverse();
  }

  /**
   * Get full state (for serialization/debugging).
   */
  getState(): SessionState {
    return { ...this.state };
  }

  /**
   * Get the navigation history (URLs in order).
   */
  getHistory(): string[] {
    return this.state.pages
      .sort((a, b) => a.visitedAt - b.visitedAt)
      .map(p => p.url);
  }
}
