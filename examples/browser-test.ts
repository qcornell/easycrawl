/**
 * Test: Browser-based snapshot of a real website.
 * Proves the full pipeline: launch browser → navigate → snapshot → format → parse
 */

import { BrowserEngine } from '../src/browser/engine';
import { createBrowserSnapshot } from '../src/browser/snapshot';
import { formatSnapshot, generateSystemPrompt } from '../src/core/formatter';
import { parseCommands } from '../src/actions/parser';

async function main() {
  const url = process.argv[2] || 'https://example.com';
  console.log(`\n🌐 Browser snapshot test: ${url}\n`);

  const engine = new BrowserEngine({ headless: true });

  try {
    // 1. Get a page
    const page = await engine.getPage('test');
    console.log('✅ Browser launched');

    // 2. Navigate
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`✅ Navigated to ${url}`);

    // 3. Snapshot
    const snapshot = await createBrowserSnapshot(page, { scrollFirst: false });
    console.log(`✅ Snapshot created: "${snapshot.title}" (${snapshot.pageType})`);
    console.log(`   Actions: ${snapshot.actions.length}`);
    console.log(`   Content blocks: ${snapshot.content.length}`);
    console.log(`   Images: ${snapshot.images.length}`);
    console.log(`   Forms: ${snapshot.forms.length}`);

    // 4. Format for LLM
    const formatted = formatSnapshot(snapshot, 'standard');
    console.log(`\n📝 Formatted output (${formatted.length} chars):\n`);
    console.log(formatted);

    // 5. Test command parsing
    console.log('\n\n🧪 Parse test — simulating LLM response:');
    const testCommands = 'click #1\nfill #2 "test value"\ndone task complete';
    const parsed = parseCommands(testCommands);
    console.log(`   Input: "${testCommands.replace(/\n/g, ' | ')}"`);
    console.log(`   Parsed: ${parsed.length} commands`);
    for (const cmd of parsed) {
      console.log(`     → ${cmd.action} ${cmd.target || ''} ${cmd.value || ''}`);
    }

    // 6. Cookie persistence test
    await engine.saveCookies('test');
    console.log('\n✅ Cookies saved');

    console.log('\n🎉 All systems go!\n');

  } finally {
    await engine.shutdown();
    console.log('Browser closed.');
  }
}

main().catch(console.error);
