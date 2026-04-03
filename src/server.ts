/**
 * EasyCrawl API Server — Universal browser intelligence over HTTP.
 * 
 * Any model, any framework, any language can now use EasyCrawl:
 *   GET  /health                     → server status
 *   POST /snapshot                   → get numbered action map for a page
 *   POST /execute                    → execute commands on current page
 *   POST /agent                      → full agent loop (snapshot → LLM → execute → repeat)
 *   GET  /sessions                   → list active sessions
 *   POST /sessions/:name/navigate    → navigate a session to a URL
 *   POST /sessions/:name/snapshot    → snapshot current page in session
 *   POST /sessions/:name/execute     → execute commands in session
 *   DELETE /sessions/:name           → close a session
 * 
 *   GET  /platforms                  → list available platform agents
 *   GET  /platforms/:id              → get platform details + flows
 *   POST /platforms/:id/run          → run a platform flow
 *   GET  /runs                       → list recent flow runs
 *   GET  /                           → serve dashboard UI
 * 
 * Usage:
 *   npx tsx src/server.ts                          # default port 3457
 *   npx tsx src/server.ts --port 8080              # custom port
 *   npx tsx src/server.ts --cdp http://localhost:9222   # connect to existing browser
 * 
 * @example
 *   curl localhost:3457/health
 *   curl -X POST localhost:3457/snapshot -H "Content-Type: application/json" \
 *     -d '{"url":"https://example.com"}'
 */

import http from 'http';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { BrowserEngine, type BrowserEngineOptions } from './browser/engine';
import { createBrowserSnapshot, type BrowserSnapshotOptions } from './browser/snapshot';
import { ActionExecutor, type ExecutionResult } from './actions/executor';
import { parseCommands, validateCommands } from './actions/parser';
import { listPlatforms, getPlatform, getPlatformSummary } from './platforms/registry';
import { PlaybookRunner } from './platforms/runner';
import type { FlowRun } from './platforms/types';
import { formatSnapshot, generateSystemPrompt, type FormatLevel } from './core/formatter';
import { createSnapshot as fetchSnapshot } from './core/snapshot';
import { SessionTracker } from './session/tracker';
import type { PageSnapshot } from './core/snapshot';
import type { Page } from 'playwright';

// ─── Config ──────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const PORT = parseInt(getArg('port', '3457'));
const CDP_URL = getArg('cdp', 'http://host.docker.internal:18800');
const DATA_DIR = getArg('data', '.easycrawl-data');

// ─── Session Manager ─────────────────────────────────────────

interface Session {
  name: string;
  page: Page;
  tracker: SessionTracker;
  lastSnapshot: PageSnapshot | null;
  createdAt: number;
  lastActiveAt: number;
}

const sessions = new Map<string, Session>();
const recentRuns: FlowRun[] = [];
const MAX_RUNS = 50;
let engine: BrowserEngine | null = null;

async function getEngine(): Promise<BrowserEngine> {
  if (!engine) {
    engine = new BrowserEngine({ cdpUrl: CDP_URL, dataDir: DATA_DIR });
  }
  return engine;
}

async function getOrCreateSession(name: string): Promise<Session> {
  let session = sessions.get(name);
  if (session) {
    session.lastActiveAt = Date.now();
    return session;
  }

  const eng = await getEngine();
  const page = await eng.getPage(name);

  session = {
    name,
    page,
    tracker: new SessionTracker({ id: name }),
    lastSnapshot: null,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };

  sessions.set(name, session);
  return session;
}

async function closeSession(name: string): Promise<boolean> {
  const session = sessions.get(name);
  if (!session) return false;

  try { await session.page.close(); } catch {}
  sessions.delete(name);
  return true;
}

// ─── Request Helpers ─────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => data += chunk.toString());
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function parseJSON(req: http.IncomingMessage): Promise<any> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJSON(res: http.ServerResponse, status: number, data: any) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJSON(res, status, { error: message });
}

// ─── Route Handlers ──────────────────────────────────────────

async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse) {
  const engineReady = !!engine;
  const sessionCount = sessions.size;

  // Check if CDP is reachable (need Host header trick for Chrome)
  let cdpReachable = false;
  try {
    const parsed = new URL(CDP_URL);
    const checkResp: string = await new Promise((resolve) => {
      const httpMod = require('http');
      const req = httpMod.get(`${CDP_URL}/json/version`, {
        headers: { 'Host': `localhost:${parsed.port}` },
        timeout: 3000,
      }, (res: any) => {
        let data = '';
        res.on('data', (d: Buffer) => data += d.toString());
        res.on('end', () => resolve(data));
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
    });
    cdpReachable = checkResp.includes('webSocketDebuggerUrl');
  } catch {}

  sendJSON(res, 200, {
    status: 'ok',
    version: '0.1.0',
    cdpUrl: CDP_URL,
    cdpReachable,
    engineReady,
    sessions: sessionCount,
    uptime: process.uptime(),
  });
}

/**
 * POST /snapshot
 * Body: { url, session?, format?, snapshotOptions? }
 * 
 * If url starts with "fetch:" uses fetch+Cheerio (no browser needed).
 * Otherwise uses browser mode.
 */
async function handleSnapshot(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await parseJSON(req);
  const { url, session: sessionName, format, snapshotOptions } = body;

  if (!url) return sendError(res, 400, 'Missing "url" in request body');

  const level: FormatLevel = format || 'standard';

  // Fetch mode shortcut
  if (url.startsWith('fetch:')) {
    const fetchUrl = url.slice(6);
    const snapshot = await fetchSnapshot(fetchUrl);
    const formatted = formatSnapshot(snapshot, level);
    return sendJSON(res, 200, {
      mode: 'fetch',
      snapshot,
      formatted,
      systemPrompt: generateSystemPrompt(),
    });
  }

  // Browser mode
  const name = sessionName || 'default';
  const session = await getOrCreateSession(name);

  // Navigate if needed
  const currentUrl = session.page.url();
  if (!currentUrl || currentUrl === 'about:blank' || currentUrl !== url) {
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await session.page.waitForTimeout(snapshotOptions?.extraWaitMs || 2000);
  }

  const snapshot = await createBrowserSnapshot(session.page, snapshotOptions || {
    waitForNetworkIdle: false,
    extraWaitMs: 500,
  });

  session.lastSnapshot = snapshot;
  session.tracker.recordPageVisit(snapshot);

  const formatted = formatSnapshot(snapshot, level);

  sendJSON(res, 200, {
    mode: 'browser',
    session: name,
    snapshot,
    formatted,
    systemPrompt: generateSystemPrompt(),
    actionCount: snapshot.actions.length,
    contentBlocks: snapshot.content.length,
  });
}

/**
 * POST /execute
 * Body: { commands, session? }
 * 
 * commands: string (multiline commands like "click #3\nfill #5 hello")
 *           OR array of { action, target?, value? }
 */
async function handleExecute(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await parseJSON(req);
  const { commands, session: sessionName } = body;

  if (!commands) return sendError(res, 400, 'Missing "commands" in request body');

  const name = sessionName || 'default';
  const session = sessions.get(name);

  if (!session) return sendError(res, 404, `Session "${name}" not found. Create one by calling /snapshot first.`);
  if (!session.lastSnapshot) return sendError(res, 400, `Session "${name}" has no snapshot. Call /snapshot first.`);

  // Parse commands — accept string or pre-parsed array
  let parsed;
  if (typeof commands === 'string') {
    parsed = parseCommands(commands);
  } else if (Array.isArray(commands)) {
    parsed = commands.map((c: any) => ({
      action: c.action,
      target: c.target ? (c.target.startsWith('a') ? c.target : `a${c.target}`) : undefined,
      value: c.value,
      raw: `${c.action} ${c.target || ''} ${c.value || ''}`.trim(),
    }));
  } else {
    return sendError(res, 400, '"commands" must be a string or array');
  }

  if (parsed.length === 0) return sendError(res, 400, 'No valid commands parsed');

  // Validate
  const validIds = new Set(session.lastSnapshot.actions.map(a => a.id));
  const { valid, invalid } = validateCommands(parsed, validIds);

  // Execute valid commands
  const executor = new ActionExecutor(session.page, session.lastSnapshot, {
    minDelay: 300,
    maxDelay: 600,
    typeDelay: 30,
  });

  const results = await executor.executeAll(valid);
  session.tracker.recordResults(results);

  // Auto re-snapshot after execution
  await session.page.waitForTimeout(500);
  const newSnapshot = await createBrowserSnapshot(session.page, {
    waitForNetworkIdle: false,
    extraWaitMs: 500,
  });
  session.lastSnapshot = newSnapshot;
  session.tracker.recordPageVisit(newSnapshot);

  sendJSON(res, 200, {
    session: name,
    executed: results.map(r => ({
      command: `${r.command.action} ${r.command.target || ''} ${r.command.value || ''}`.trim(),
      status: r.status,
      message: r.message,
      durationMs: r.durationMs,
    })),
    invalid: invalid.map(c => `${c.action} ${c.target || ''} — target not found`),
    currentUrl: session.page.url(),
    newSnapshot: {
      actionCount: newSnapshot.actions.length,
      contentBlocks: newSnapshot.content.length,
      formatted: formatSnapshot(newSnapshot, 'standard'),
    },
  });
}

/**
 * POST /agent
 * Body: { url, task, model?, apiKey?, maxSteps?, session?, format?, dryRun? }
 * 
 * Runs a full agent loop with built-in OpenAI-compatible LLM calls.
 * Works with OpenAI, Ollama, LM Studio, any OpenAI-compatible endpoint.
 */
async function handleAgent(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await parseJSON(req);
  const {
    url,
    task,
    model = 'gpt-4o-mini',
    apiKey,
    apiBase = 'https://api.openai.com/v1',
    maxSteps = 10,
    session: sessionName = 'agent',
    format = 'standard',
    dryRun = true,
    dangerousLabels = ['post', 'send', 'publish', 'delete', 'remove', 'confirm purchase', 'pay now', 'buy now', 'tweet', 'place order'],
  } = body;

  if (!url) return sendError(res, 400, 'Missing "url"');
  if (!task) return sendError(res, 400, 'Missing "task"');

  // For remote models, need an API key
  const isLocal = apiBase.includes('localhost') || apiBase.includes('127.0.0.1') || apiBase.includes('host.docker.internal');
  if (!isLocal && !apiKey) return sendError(res, 400, 'Missing "apiKey" for remote model');

  const session = await getOrCreateSession(sessionName);

  // Navigate
  await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await session.page.waitForTimeout(2000);

  const conversation: Array<{ role: string; content: string }> = [
    { role: 'system', content: generateSystemPrompt() },
  ];

  const steps: any[] = [];
  let done = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let step = 1; step <= maxSteps && !done; step++) {
    // 1. Snapshot
    const snapshot = await createBrowserSnapshot(session.page, {
      waitForNetworkIdle: false,
      extraWaitMs: 500,
    });
    session.lastSnapshot = snapshot;
    session.tracker.recordPageVisit(snapshot);

    // 2. Format
    const formatted = formatSnapshot(snapshot, format as FormatLevel);
    const sessionContext = session.tracker.getContextSummary();

    const userMessage = step === 1
      ? `Task: ${task}\n\nSession:\n${sessionContext}\n\nCurrent page:\n${formatted}`
      : `Session:\n${sessionContext}\n\nCurrent page:\n${formatted}`;

    conversation.push({ role: 'user', content: userMessage });

    // 3. Call LLM
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const llmResp = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: conversation,
        temperature: 0.2,
        max_tokens: 500,
      }),
    });

    if (!llmResp.ok) {
      const errText = await llmResp.text();
      return sendError(res, 502, `LLM API error (${llmResp.status}): ${errText}`);
    }

    const llmData = await llmResp.json() as any;
    const llmText = llmData.choices?.[0]?.message?.content || '';
    const usage = llmData.usage;
    if (usage) {
      totalInputTokens += usage.prompt_tokens || 0;
      totalOutputTokens += usage.completion_tokens || 0;
    }

    conversation.push({ role: 'assistant', content: llmText });

    // Trim conversation
    if (conversation.length > 14) {
      conversation.splice(1, conversation.length - 11);
    }

    // 4. Parse commands
    const commands = parseCommands(llmText);

    if (commands.some(c => c.action === 'done')) {
      done = true;
    }

    // 5. Execute (with dry-run safety)
    const executable = commands.filter(c => c.action !== 'done' && c.action !== 'unknown');
    let results: ExecutionResult[] = [];
    let blocked: string[] = [];

    if (executable.length > 0) {
      const safe = executable.filter(cmd => {
        if (!dryRun) return true;
        if (cmd.action === 'click' && cmd.target) {
          const action = snapshot.actions.find(a => a.id === cmd.target);
          if (action && dangerousLabels.some((d: string) => action.label.toLowerCase().includes(d))) {
            blocked.push(`${cmd.action} #${cmd.target?.slice(1)} "${action.label}"`);
            return false;
          }
        }
        return true;
      });

      if (safe.length > 0) {
        const executor = new ActionExecutor(session.page, snapshot, { minDelay: 300, maxDelay: 600, typeDelay: 30 });
        results = await executor.executeAll(safe);
        session.tracker.recordResults(results);

        if (results.some(r => r.status === 'navigated')) {
          await session.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        }
      }
    }

    steps.push({
      step,
      url: session.page.url(),
      llmResponse: llmText,
      commands: commands.map(c => `${c.action} ${c.target || ''} ${c.value || ''}`.trim()),
      results: results.map(r => ({ status: r.status, message: r.message })),
      blocked,
    });
  }

  sendJSON(res, 200, {
    success: done,
    session: sessionName,
    task,
    model,
    stepsUsed: steps.length,
    maxSteps,
    dryRun,
    steps,
    tokens: { input: totalInputTokens, output: totalOutputTokens },
    estimatedCost: `$${((totalInputTokens / 1_000_000) * 0.15 + (totalOutputTokens / 1_000_000) * 0.60).toFixed(4)}`,
  });
}

/**
 * GET /sessions — list active sessions
 */
async function handleListSessions(_req: http.IncomingMessage, res: http.ServerResponse) {
  const list = Array.from(sessions.entries()).map(([name, s]) => ({
    name,
    url: s.page.url(),
    lastSnapshot: s.lastSnapshot ? {
      title: s.lastSnapshot.title,
      pageType: s.lastSnapshot.pageType,
      actionCount: s.lastSnapshot.actions.length,
    } : null,
    stepsCompleted: s.tracker.getState().stepsCompleted,
    createdAt: new Date(s.createdAt).toISOString(),
    lastActiveAt: new Date(s.lastActiveAt).toISOString(),
  }));

  sendJSON(res, 200, { sessions: list, count: list.length });
}

/**
 * Session-specific routes
 */
async function handleSessionNavigate(sessionName: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await parseJSON(req);
  if (!body.url) return sendError(res, 400, 'Missing "url"');

  const session = await getOrCreateSession(sessionName);
  await session.page.goto(body.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await session.page.waitForTimeout(body.wait || 2000);

  sendJSON(res, 200, { session: sessionName, navigatedTo: session.page.url() });
}

async function handleSessionSnapshot(sessionName: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await parseJSON(req);
  const session = sessions.get(sessionName);
  if (!session) return sendError(res, 404, `Session "${sessionName}" not found`);

  const level: FormatLevel = body.format || 'standard';
  const snapshot = await createBrowserSnapshot(session.page, body.snapshotOptions || {
    waitForNetworkIdle: false,
    extraWaitMs: 500,
  });
  session.lastSnapshot = snapshot;
  session.tracker.recordPageVisit(snapshot);

  sendJSON(res, 200, {
    session: sessionName,
    url: snapshot.url,
    title: snapshot.title,
    pageType: snapshot.pageType,
    actionCount: snapshot.actions.length,
    formatted: formatSnapshot(snapshot, level),
    actions: snapshot.actions.map(a => ({
      id: a.id,
      type: a.type,
      label: a.label,
      href: a.href,
    })),
  });
}

async function handleSessionExecute(sessionName: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await parseJSON(req);
  const session = sessions.get(sessionName);
  if (!session) return sendError(res, 404, `Session "${sessionName}" not found`);
  if (!session.lastSnapshot) return sendError(res, 400, 'No snapshot — call snapshot first');

  const parsed = typeof body.commands === 'string'
    ? parseCommands(body.commands)
    : (body.commands || []).map((c: any) => ({
        action: c.action,
        target: c.target ? (c.target.startsWith('a') ? c.target : `a${c.target}`) : undefined,
        value: c.value,
        raw: `${c.action} ${c.target || ''} ${c.value || ''}`.trim(),
      }));

  const executor = new ActionExecutor(session.page, session.lastSnapshot, {
    minDelay: 300, maxDelay: 600, typeDelay: 30,
  });
  const results = await executor.executeAll(parsed);
  session.tracker.recordResults(results);

  sendJSON(res, 200, {
    session: sessionName,
    results: results.map(r => ({
      command: `${r.command.action} ${r.command.target || ''} ${r.command.value || ''}`.trim(),
      status: r.status,
      message: r.message,
    })),
    currentUrl: session.page.url(),
  });
}

async function handleSessionDelete(sessionName: string, _req: http.IncomingMessage, res: http.ServerResponse) {
  const closed = await closeSession(sessionName);
  if (!closed) return sendError(res, 404, `Session "${sessionName}" not found`);
  sendJSON(res, 200, { session: sessionName, status: 'closed' });
}

// ─── Platform API Routes ─────────────────────────────────────

async function handleListPlatforms(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJSON(res, 200, { platforms: getPlatformSummary() });
}

async function handleGetPlatform(platformId: string, _req: http.IncomingMessage, res: http.ServerResponse) {
  const platform = getPlatform(platformId);
  if (!platform) return sendError(res, 404, `Platform "${platformId}" not found`);

  sendJSON(res, 200, {
    id: platform.id,
    name: platform.name,
    icon: platform.icon,
    color: platform.color,
    description: platform.description,
    flows: platform.flows.map(f => ({
      id: f.id,
      name: f.name,
      icon: f.icon,
      description: f.description,
      category: f.category,
      params: f.params,
      stepCount: f.steps.length,
    })),
  });
}

async function handleRunFlow(platformId: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await parseJSON(req);
  const { flowId, params = {}, llm } = body;

  if (!flowId) return sendError(res, 400, 'Missing "flowId"');

  const platform = getPlatform(platformId);
  if (!platform) return sendError(res, 404, `Platform "${platformId}" not found`);

  const flow = platform.flows.find(f => f.id === flowId);
  if (!flow) return sendError(res, 404, `Flow "${flowId}" not found on ${platformId}`);

  // Get or create a session for this platform
  const sessionName = `platform-${platformId}`;
  const session = await getOrCreateSession(sessionName);

  const runner = new PlaybookRunner(session.page, {
    llm: llm || undefined,
    minDelay: 200,
    maxDelay: 500,
    onStepUpdate: (run) => {
      // Update the stored run
      const idx = recentRuns.findIndex(r => r.id === run.id);
      if (idx >= 0) recentRuns[idx] = { ...run };
      else {
        recentRuns.unshift({ ...run });
        if (recentRuns.length > MAX_RUNS) recentRuns.pop();
      }
    },
  });

  try {
    const run = await runner.runFlow(platformId, flowId, params);
    sendJSON(res, 200, run);
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
}

async function handleListRuns(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJSON(res, 200, {
    runs: recentRuns.map(r => ({
      id: r.id,
      platform: r.platform,
      flowId: r.flowId,
      flowName: r.flowName,
      status: r.status,
      steps: r.steps.length,
      startedAt: new Date(r.startedAt).toISOString(),
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
      durationMs: r.completedAt ? r.completedAt - r.startedAt : Date.now() - r.startedAt,
      error: r.error,
    })),
    count: recentRuns.length,
  });
}

// ─── Dashboard Serving ───────────────────────────────────────

async function handleDashboard(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const html = await readFile(join(__dirname, '..', 'public', 'index.html'), 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(html);
  } catch {
    // Try alternate path (dev mode — __dirname is src/)
    try {
      const html = await readFile(join(process.cwd(), 'public', 'index.html'), 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(html);
    } catch {
      sendError(res, 404, 'Dashboard not found. Create public/index.html.');
    }
  }
}

// ─── Router ──────────────────────────────────────────────────

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const method = req.method || 'GET';
  const url = req.url || '/';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    // Dashboard
    if (method === 'GET' && (url === '/' || url === '/index.html')) return await handleDashboard(req, res);

    // Health
    if (method === 'GET' && url === '/health') return await handleHealth(req, res);

    // Core endpoints
    if (method === 'POST' && url === '/snapshot') return await handleSnapshot(req, res);
    if (method === 'POST' && url === '/execute') return await handleExecute(req, res);
    if (method === 'POST' && url === '/agent') return await handleAgent(req, res);

    // System prompt (convenience)
    if (method === 'GET' && url === '/system-prompt') {
      return sendJSON(res, 200, { systemPrompt: generateSystemPrompt() });
    }

    // Platform API
    if (method === 'GET' && url === '/platforms') return await handleListPlatforms(req, res);
    if (method === 'GET' && url === '/runs') return await handleListRuns(req, res);

    // Platform-specific routes: /platforms/:id and /platforms/:id/run
    const platformMatch = url.match(/^\/platforms\/([^/]+)(?:\/(run))?$/);
    if (platformMatch) {
      const [, platformId, action] = platformMatch;
      if (method === 'GET' && !action) return await handleGetPlatform(platformId, req, res);
      if (method === 'POST' && action === 'run') return await handleRunFlow(platformId, req, res);
    }

    // Sessions list
    if (method === 'GET' && url === '/sessions') return await handleListSessions(req, res);

    // Session-specific routes: /sessions/:name/action
    const sessionMatch = url.match(/^\/sessions\/([^/]+)\/?(.*)?$/);
    if (sessionMatch) {
      const [, sessionName, action] = sessionMatch;

      if (method === 'POST' && action === 'navigate') return await handleSessionNavigate(sessionName, req, res);
      if (method === 'POST' && action === 'snapshot') return await handleSessionSnapshot(sessionName, req, res);
      if (method === 'POST' && action === 'execute') return await handleSessionExecute(sessionName, req, res);
      if (method === 'DELETE' && (!action || action === '')) return await handleSessionDelete(sessionName, req, res);
    }

    // 404
    sendError(res, 404, `Not found: ${method} ${url}`);

  } catch (err: any) {
    console.error(`❌ ${method} ${url}:`, err.message);
    sendError(res, 500, err.message);
  }
}

// ─── Start Server ────────────────────────────────────────────

const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  🕷️  EasyCrawl API Server v0.1.0`);
  console.log(`${'═'.repeat(55)}`);
  console.log(`  Port:     ${PORT}`);
  console.log(`  CDP:      ${CDP_URL}`);
  console.log(`  Data:     ${DATA_DIR}`);
  console.log(`${'═'.repeat(55)}`);
  console.log(`  Platforms: ${listPlatforms().map(p => `${p.icon} ${p.name}`).join(', ')}`);
  console.log(`${'═'.repeat(55)}`);
  console.log(`\n  Endpoints:`);
  console.log(`    GET  /                              → dashboard UI`);
  console.log(`    GET  /health                        → server status`);
  console.log(`    GET  /platforms                     → list platform agents`);
  console.log(`    GET  /platforms/:id                 → platform details`);
  console.log(`    POST /platforms/:id/run             → run a platform flow`);
  console.log(`    GET  /runs                          → recent flow runs`);
  console.log(`    POST /snapshot                      → snapshot a page`);
  console.log(`    POST /execute                       → execute commands`);
  console.log(`    POST /agent                         → full AI agent loop`);
  console.log(`    GET  /sessions                      → list sessions`);
  console.log(`    POST /sessions/:name/navigate       → navigate session`);
  console.log(`    POST /sessions/:name/snapshot       → snapshot session`);
  console.log(`    POST /sessions/:name/execute        → execute in session`);
  console.log(`    DELETE /sessions/:name              → close session`);
  console.log(`    GET  /system-prompt                 → get LLM system prompt`);
  console.log(`\n  Quick test:`);
  console.log(`    curl http://localhost:${PORT}/health`);
  console.log(`    curl -X POST http://localhost:${PORT}/snapshot \\`);
  console.log(`      -H "Content-Type: application/json" \\`);
  console.log(`      -d '{"url":"https://example.com"}'`);
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  for (const [name] of sessions) await closeSession(name);
  if (engine) await engine.shutdown();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  for (const [name] of sessions) await closeSession(name);
  if (engine) await engine.shutdown();
  server.close();
  process.exit(0);
});
