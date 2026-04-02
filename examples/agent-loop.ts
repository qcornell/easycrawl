/**
 * Agent loop example — shows how a cheap LLM can browse using EasyCrawl.
 * 
 * This demonstrates the pattern, using mock LLM responses.
 * Replace mockLLM() with your actual model call.
 */
import { EasyCrawl } from '../src';

// Mock LLM that responds to page snapshots with commands
// Replace this with actual API calls to GPT-4o-mini, Llama, etc.
async function mockLLM(systemPrompt: string, userMessage: string): Promise<string> {
  // Simulate what a cheap model would respond with
  if (userMessage.includes('Contact')) {
    return 'fill #4 "John Smith"\nfill #5 "john@example.com"\nfill #6 "I\'d like to learn more about your services."\nclick #7';
  }
  if (userMessage.includes('[NAV] Contact')) {
    return 'click #3';
  }
  return 'done Task complete - page analyzed.';
}

async function main() {
  const crawler = new EasyCrawl();
  const startUrl = process.argv[2] || 'https://example.com';
  const task = 'Navigate to the contact page and fill out the form with name "John Smith" and email "john@example.com"';

  console.log(`\n🤖 Task: ${task}`);
  console.log(`🌐 Starting at: ${startUrl}\n`);

  const systemPrompt = crawler.systemPrompt();
  let currentUrl = startUrl;
  let maxSteps = 5;

  for (let step = 1; step <= maxSteps; step++) {
    console.log(`\n--- Step ${step}: ${currentUrl} ---`);

    // 1. Snapshot the current page
    const snapshot = await crawler.snapshot(currentUrl);
    const formatted = crawler.format(snapshot, 'standard');

    console.log(`Page: ${snapshot.title} (${snapshot.pageType})`);
    console.log(`Actions available: ${snapshot.actions.length}`);

    // 2. Send to LLM
    const prompt = `Current page:\n${formatted}\n\nTask: ${task}`;
    const response = await mockLLM(systemPrompt, prompt);
    console.log(`LLM response: ${response}`);

    // 3. Parse commands
    const commands = crawler.parse(response);
    const { valid, invalid } = crawler.validate(commands, snapshot);

    if (invalid.length > 0) {
      console.log(`⚠️ Invalid commands: ${invalid.map(c => c.raw).join(', ')}`);
    }

    // 4. Execute commands (in real agent, this uses Playwright)
    for (const cmd of valid) {
      console.log(`  ▶ ${cmd.action} ${cmd.target || ''} ${cmd.value || ''}`);
      
      if (cmd.action === 'done') {
        console.log(`\n✅ Task complete: ${cmd.value || 'No summary'}`);
        return;
      }

      if (cmd.action === 'click') {
        const action = snapshot.actions.find(a => a.id === cmd.target);
        if (action?.href) {
          currentUrl = action.href.startsWith('http') ? action.href : new URL(action.href, currentUrl).href;
          console.log(`  → Navigating to: ${currentUrl}`);
        }
      }
    }
  }

  console.log('\n⚠️ Max steps reached');
}

main().catch(console.error);
