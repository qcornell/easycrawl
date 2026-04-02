/**
 * BrowserEngine — Manages Playwright browser lifecycle, cookie persistence,
 * and provides live pages for the executor and snapshot system.
 * 
 * Key design decisions:
 * - Single browser instance, reused across sessions
 * - Cookie persistence to disk (JSON) for session survival across restarts
 * - User data dir for localStorage/IndexedDB persistence
 * - Human-like defaults (viewport, user agent, timezone)
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface BrowserEngineOptions {
  /** Directory for cookie files and user data */
  dataDir?: string;
  /** Run headless (default: true) */
  headless?: boolean;
  /** Viewport size */
  viewport?: { width: number; height: number };
  /** Custom user agent */
  userAgent?: string;
  /** Timezone (e.g. "America/Chicago") */
  timezone?: string;
  /** Extra args for Chromium */
  args?: string[];
  /** CDP endpoint URL to connect to an existing browser (e.g., "http://127.0.0.1:18800") */
  cdpUrl?: string;
}

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export class BrowserEngine {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();
  private options: Required<BrowserEngineOptions>;

  constructor(options: BrowserEngineOptions = {}) {
    this.options = {
      dataDir: options.dataDir || join(process.cwd(), '.easycrawl-data'),
      headless: options.headless ?? true,
      viewport: options.viewport || { width: 1280, height: 800 },
      userAgent: options.userAgent || DEFAULT_UA,
      timezone: options.timezone || 'America/Chicago',
      args: options.args || [],
      cdpUrl: options.cdpUrl || '',
    };
  }

  /**
   * Launch browser if not already running.
   */
  async launch(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;

    await mkdir(this.options.dataDir, { recursive: true });

    if (this.options.cdpUrl) {
      // Connect to existing browser via CDP (e.g., OpenClaw's browser)
      // Chrome's /json/version returns ws://localhost/devtools/... which Playwright
      // uses directly. We need to resolve it ourselves and connect via raw WS
      // with the correct host + port.
      const wsUrl = await this.resolveWsUrl(this.options.cdpUrl);
      this.browser = await chromium.connectOverCDP(wsUrl);
    } else {
      // Launch our own browser
      this.browser = await chromium.launch({
        headless: this.options.headless,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          ...this.options.args,
        ],
      });
    }

    return this.browser;
  }

  /**
   * Get or create a named context (session).
   * Each context has its own cookies, localStorage, etc.
   * Context name maps to a cookie file on disk.
   */
  async getContext(name: string = 'default'): Promise<BrowserContext> {
    // Return existing if alive
    const existing = this.contexts.get(name);
    if (existing) {
      try {
        await existing.pages(); // Quick health check
        return existing;
      } catch {
        this.contexts.delete(name);
      }
    }

    const browser = await this.launch();

    let context: BrowserContext;

    if (this.options.cdpUrl) {
      // CDP mode: use existing contexts from the connected browser
      const existingContexts = browser.contexts();
      if (existingContexts.length > 0) {
        context = existingContexts[0];
      } else {
        context = await browser.newContext({
          viewport: this.options.viewport,
        });
      }
    } else {
      // Launch mode: create fresh context with full config
      context = await browser.newContext({
        viewport: this.options.viewport,
        userAgent: this.options.userAgent,
        timezoneId: this.options.timezone,
        locale: 'en-US',
        javaScriptEnabled: true,
        bypassCSP: false,
        ignoreHTTPSErrors: false,
      });

      // Stealth: override navigator.webdriver
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        (window as any).chrome = { runtime: {} };
        const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
        (window.navigator.permissions as any).query = (params: any) => {
          if (params.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission } as PermissionStatus);
          }
          return originalQuery(params);
        };
      });
    }

    // Load saved cookies
    await this.loadCookies(context, name);

    this.contexts.set(name, context);
    return context;
  }

  /**
   * Get a page in the named context.
   * In CDP mode: creates a new tab (to avoid disrupting existing tabs).
   * In launch mode: reuses existing page or creates one.
   */
  async getPage(contextName: string = 'default'): Promise<Page> {
    const context = await this.getContext(contextName);

    if (this.options.cdpUrl) {
      // CDP mode: always create a new tab so we don't interfere with user's tabs
      return await context.newPage();
    }

    // Launch mode: reuse or create
    const pages = context.pages();
    return pages.length > 0 ? pages[0] : await context.newPage();
  }

  /**
   * Save cookies for a context to disk.
   */
  async saveCookies(contextName: string = 'default'): Promise<void> {
    const context = this.contexts.get(contextName);
    if (!context) return;

    try {
      const cookies = await context.cookies();
      const filePath = this.cookiePath(contextName);
      await writeFile(filePath, JSON.stringify(cookies, null, 2));
    } catch (err) {
      // Non-fatal — context might be closed
    }
  }

  /**
   * Load cookies from disk into a context.
   */
  private async loadCookies(context: BrowserContext, name: string): Promise<void> {
    try {
      const filePath = this.cookiePath(name);
      const data = await readFile(filePath, 'utf-8');
      const cookies = JSON.parse(data);
      if (Array.isArray(cookies) && cookies.length > 0) {
        await context.addCookies(cookies);
      }
    } catch {
      // No saved cookies — that's fine
    }
  }

  /**
   * Save all contexts' cookies.
   */
  async saveAll(): Promise<void> {
    for (const name of this.contexts.keys()) {
      await this.saveCookies(name);
    }
  }

  /**
   * Close a specific context (saves cookies first).
   */
  async closeContext(name: string): Promise<void> {
    await this.saveCookies(name);
    const context = this.contexts.get(name);
    if (context) {
      await context.close().catch(() => {});
      this.contexts.delete(name);
    }
  }

  /**
   * Shut down everything (saves all cookies first).
   */
  async shutdown(): Promise<void> {
    await this.saveAll();
    for (const [name, ctx] of this.contexts) {
      await ctx.close().catch(() => {});
    }
    this.contexts.clear();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  /**
   * List active context names.
   */
  listContexts(): string[] {
    return [...this.contexts.keys()];
  }

  /**
   * Resolve CDP HTTP endpoint → WebSocket URL.
   * Chrome rejects non-localhost Host headers, so we use Node http
   * with a spoofed Host header to fetch /json/version.
   */
  private async resolveWsUrl(cdpUrl: string): Promise<string> {
    const { default: http } = await import('http');
    const parsed = new URL(cdpUrl);

    return new Promise((resolve) => {
      const versionUrl = cdpUrl.replace(/\/$/, '') + '/json/version';
      const req = http.get(versionUrl, {
        headers: { 'Host': `localhost:${parsed.port}` },
      }, (res) => {
        let data = '';
        res.on('data', (d: Buffer) => data += d.toString());
        res.on('end', () => {
          try {
            const json = JSON.parse(data) as { webSocketDebuggerUrl?: string };
            if (json.webSocketDebuggerUrl) {
              // Replace localhost with actual hostname (keep port)
              const wsUrl = json.webSocketDebuggerUrl.replace(
                'localhost', parsed.hostname
              );
              resolve(wsUrl);
              return;
            }
          } catch { /* parse error */ }
          resolve(cdpUrl);
        });
      });
      req.on('error', () => resolve(cdpUrl));
      req.setTimeout(5000, () => { req.destroy(); resolve(cdpUrl); });
    });
  }

  private cookiePath(name: string): string {
    return join(this.options.dataDir, `cookies-${name}.json`);
  }
}
