/**
 * Test: Connect to OpenClaw's browser via CDP and snapshot a page.
 * This is the actual use case — using Max's logged-in browser.
 */

import { BrowserEngine } from '../src/browser/engine';
import { createBrowserSnapshot } from '../src/browser/snapshot';
import { formatSnapshot } from '../src/core/formatter';
import { ActionExecutor } from '../src/actions/executor';
import { parseCommands } from '../src/actions/parser';

const CDP_URL = process.argv[2] || 'http://127.0.0.1:18800';
const TARGET_URL = process.argv[3] || 'https://example.com';

async function main() {
  console.log(`\n🔗 Connecting to browser at ${CDP_URL}...`);
  console.log(`🌐 Target: ${TARGET_URL}\n`);

  const engine = new BrowserEngine({ cdpUrl: CDP_URL });

  try {
    // 1. Get a page (new tab in existing browser)
    const page = await engine.getPage('cdp');
    console.log('✅ Connected to browser, new tab opened');

    // 2. Navigate
    console.log(`📡 Navigating to ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`✅ Page loaded: ${await page.title()}`);

    // 3. Browser snapshot (sees JS-rendered content!)
    console.log('\n📸 Taking browser snapshot...');
    const snapshot = await createBrowserSnapshot(page, {
      waitForNetworkIdle: true,
      extraWaitMs: 1000,
    });

    console.log(`\n📊 Snapshot Results:`);
    console.log(`   Title: ${snapshot.title}`);
    console.log(`   Type: ${snapshot.pageType}`);
    console.log(`   Actions: ${snapshot.actions.length}`);
    console.log(`   Content: ${snapshot.content.length} blocks`);
    console.log(`   Images: ${snapshot.images.length}`);
    console.log(`   Forms: ${snapshot.forms.length}`);
    console.log(`   Nav items: ${snapshot.navigation.length}`);

    // 4. Format for LLM consumption
    const formatted = formatSnapshot(snapshot, 'standard');
    console.log(`\n📝 LLM-Ready Format (${formatted.length} chars):\n`);
    console.log(formatted);

    // 5. Test executor with a safe action
    if (snapshot.actions.length > 0) {
      console.log('\n\n🧪 Executor test — attempting scroll down:');
      const executor = new ActionExecutor(page, snapshot);
      const results = await executor.executeAll(parseCommands('scroll down'));
      for (const r of results) {
        console.log(`   ${r.status === 'ok' ? '✅' : '❌'} ${r.message} (${r.durationMs}ms)`);
      }
    }

    // Clean up — close the tab we opened
    await page.close();
    console.log('\n✅ Tab closed. Browser still running.');
    console.log('\n🎉 CDP pipeline working end-to-end!\n');

  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    if (err.message.includes('connect')) {
      console.error('   → Make sure OpenClaw browser is running (check /browser status)');
    }
  } finally {
    // Don't shutdown in CDP mode — we don't own the browser
    // Just disconnect
    await engine.shutdown();
  }
}

main().catch(console.error);
