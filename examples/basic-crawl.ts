/**
 * Basic EasyCrawl example — snapshot a page and format for LLM
 */
import { EasyCrawl } from '../src';

async function main() {
  const crawler = new EasyCrawl();
  const url = process.argv[2] || 'https://example.com';

  console.log(`\n🔍 Snapshotting: ${url}\n`);

  const snapshot = await crawler.snapshot(url);

  // Show page info
  console.log(`Title: ${snapshot.title}`);
  console.log(`Type: ${snapshot.pageType}`);
  console.log(`Nav items: ${snapshot.navigation.length}`);
  console.log(`Actions: ${snapshot.actions.length}`);
  console.log(`Content blocks: ${snapshot.content.length}`);
  console.log(`Images: ${snapshot.images.length}`);
  console.log(`Forms: ${snapshot.forms.length}`);

  // Format at each level
  console.log('\n═══ MINIMAL FORMAT ═══');
  console.log(crawler.format(snapshot, 'minimal'));

  console.log('\n═══ STANDARD FORMAT ═══');
  console.log(crawler.format(snapshot, 'standard'));

  console.log('\n═══ DETAILED FORMAT ═══');
  console.log(crawler.format(snapshot, 'detailed'));

  // Show system prompt
  console.log('\n═══ SYSTEM PROMPT ═══');
  console.log(crawler.systemPrompt());

  // Token estimate
  const minimal = crawler.format(snapshot, 'minimal');
  const standard = crawler.format(snapshot, 'standard');
  const detailed = crawler.format(snapshot, 'detailed');
  console.log('\n═══ TOKEN ESTIMATES ═══');
  console.log(`Minimal: ~${Math.round(minimal.length / 4)} tokens`);
  console.log(`Standard: ~${Math.round(standard.length / 4)} tokens`);
  console.log(`Detailed: ~${Math.round(detailed.length / 4)} tokens`);
}

main().catch(console.error);
