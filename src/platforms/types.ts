/**
 * Platform Playbook Types — Specialized AI agents for specific platforms.
 * 
 * Core idea: deterministic steps first, AI fallback when stuck.
 * Each platform defines known flows with hardcoded selectors that
 * are more reliable than generic browsing.
 */

// ─── Platform Definition ─────────────────────────────────────

export interface Platform {
  id: string;
  name: string;
  icon: string;
  color: string;            // Brand color for UI
  baseUrl: string;
  description: string;
  loginCheck: LoginCheck;
  flows: Flow[];
}

export interface LoginCheck {
  /** If any of these selectors exist, user is logged in */
  loggedInSelectors: string[];
  /** URL patterns that indicate not logged in */
  loginUrlPatterns: string[];
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'create' | 'engage' | 'navigate' | 'read';
  params: FlowParam[];
  steps: PlaybookStep[];
}

export interface FlowParam {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'url' | 'file' | 'select';
  required: boolean;
  placeholder?: string;
  options?: string[];
  default?: string;
}

// ─── Playbook Steps ──────────────────────────────────────────

export interface PlaybookStep {
  id: string;
  description: string;
  action: StepAction;
  verify?: VerifyCheck;
  onFail: 'ai' | 'retry' | 'skip' | 'abort';
  retries?: number;
  delayAfterMs?: number;
}

export type StepAction =
  | { type: 'click'; selectors: string[]; role?: string; roleName?: string }
  | { type: 'fill'; selectors: string[]; text: string; role?: string; roleName?: string; contenteditable?: boolean }
  | { type: 'press'; key: string; selectors?: string[] }
  | { type: 'scroll'; direction: 'up' | 'down'; amount?: number }
  | { type: 'wait'; ms: number }
  | { type: 'navigate'; url: string };

export interface VerifyCheck {
  type: 'visible' | 'gone' | 'url_contains' | 'url_changed' | 'text_on_page' | 'none';
  selector?: string;
  text?: string;
  url?: string;
  timeoutMs?: number;
}

// ─── Execution Results ───────────────────────────────────────

export interface FlowRun {
  id: string;
  platform: string;
  flowId: string;
  flowName: string;
  params: Record<string, string>;
  status: 'running' | 'success' | 'failed' | 'aborted';
  steps: StepResult[];
  startedAt: number;
  completedAt?: number;
  error?: string;
  screenshotUrl?: string;
}

export interface StepResult {
  stepId: string;
  description: string;
  method: 'deterministic' | 'ai_fallback' | 'retry';
  status: 'ok' | 'failed' | 'skipped' | 'running';
  message: string;
  durationMs: number;
  selectorUsed?: string;
}

// ─── Flow Memory (learning from past runs) ───────────────────

export interface FlowMemory {
  platform: string;
  flowId: string;
  lastRun: number;
  successCount: number;
  failCount: number;
  /** Per-step: which selector worked last time */
  selectorHits: Record<string, string>;
}

// ─── Runner Options ──────────────────────────────────────────

export interface RunnerOptions {
  /** LLM config for AI fallback (optional — deterministic-only if omitted) */
  llm?: {
    apiKey?: string;
    apiBase?: string;
    model?: string;
  };
  /** Delays between actions */
  minDelay?: number;
  maxDelay?: number;
  /** Screenshot after each step */
  screenshotOnStep?: boolean;
  /** Callback for live updates */
  onStepUpdate?: (run: FlowRun) => void;
}
