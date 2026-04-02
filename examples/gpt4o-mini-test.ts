/**
 * REAL TEST: GPT-4o-mini driving a browser via EasyCrawl.
 * 
 * This is the proof-of-concept: can a $0.001/call model navigate
 * a real website using our numbered action map?
 * 
 * Usage: tsx examples/gpt4o-mini-test.ts [url] [task]
 */

import { BrowserEngine } from '../src/browser/engine';
import { createBrowserSnapshot } from '../src/browser/snapshot';
import { formatSnapshot, generateSystemPrompt } from '../src/core/formatter';
import { ActionExecutor } from '../src/actions/executor';
import { parseCommands, validateCommands } from '../src/actions/parser';
import { SessionTracker } from '../src/session/tracker';
import type { PageSnapshot } from '../src/core/snapshot';

const CDP_URL = 'http://host.docker.internal:18800';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const MODEL = 'gpt-4o-mini';

// Safety: actions that could have real-world consequences
// Only block truly destructive/publishing actions — NOT search submit
const DANGEROUS_LABELS = ['post', 'send', 'publish', 'delete', 'remove', 'confirm purchase', 'pay now', 'buy now', 'tweet', 'place order'];

const TARGET_URL = process.argv[2] || 'https://x.com/home';
const TASK = process.argv[3] || 'Find the tweet compose box and type "EasyCrawl test — a cheap AI model just wrote this tweet 🤖🔥" then tell me what you did. Do NOT click Post.';
const MAX_STEPS = parseInt(process.argv[4] || '8');
const DRY_RUN = process.argv.includes('--live') ? false : true;

// ─── OpenAI API Call ─────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

let totalInputTokens = 0;
let totalOutputTokens = 0;

async function callGPT4oMini(messages: ChatMessage[]): Promise<string> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.2,  // Low temp for reliability
      max_tokens: 500,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API error (${resp.status}): ${err}`);
  }

  const data = await resp.json() as any;
  const usage = data.usage;
  if (usage) {
    totalInputTokens += usage.prompt_tokens;
    totalOutputTokens += usage.completion_tokens;
  }

  return data.choices[0].message.content;
}

// ─── Main Agent Loop ─────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🧠 EasyCrawl + GPT-4o-mini Live Test`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Model:    ${MODEL}`);
  console.log(`  URL:      ${TARGET_URL}`);
  console.log(`  Task:     ${TASK}`);
  console.log(`  Max steps: ${MAX_STEPS}`);
  console.log(`  Dry run:  ${DRY_RUN ? 'YES (dangerous actions blocked)' : '⚠️  NO — LIVE MODE'}`);
  console.log(`${'═'.repeat(60)}\n`);

  const engine = new BrowserEngine({ cdpUrl: CDP_URL });
  const tracker = new SessionTracker({ goal: TASK, maxSteps: MAX_STEPS });
  const conversation: ChatMessage[] = [
    { role: 'system', content: generateSystemPrompt() },
  ];

  let page;
  try {
    page = await engine.getPage('gpt-test');
    console.log('✅ Connected to browser via CDP\n');

    // Navigate to start
    console.log(`📡 Navigating to ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log(`✅ Page loaded\n`);

    let done = false;

    for (let step = 1; step <= MAX_STEPS && !done; step++) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`  Step ${step}/${MAX_STEPS}`);
      console.log(`${'─'.repeat(50)}`);

      // 1. Snapshot
      const snapshot = await createBrowserSnapshot(page, {
        waitForNetworkIdle: false, // X never goes idle
        extraWaitMs: 500,
      });
      tracker.recordPageVisit(snapshot);

      console.log(`📸 Page: "${snapshot.title}" | ${snapshot.actions.length} actions | ${snapshot.content.length} content blocks`);

      // 2. Format for LLM
      const formatted = formatSnapshot(snapshot, 'standard');
      const sessionContext = tracker.getContextSummary();

      const userMessage = step === 1
        ? `Task: ${TASK}\n\nSession:\n${sessionContext}\n\nCurrent page:\n${formatted}`
        : `Session:\n${sessionContext}\n\nCurrent page:\n${formatted}`;

      conversation.push({ role: 'user', content: userMessage });

      // 3. Call GPT-4o-mini
      console.log(`\n🧠 Asking ${MODEL}... (${formatted.length} chars prompt)`);
      const startMs = Date.now();
      const llmResponse = await callGPT4oMini(conversation);
      const apiMs = Date.now() - startMs;
      conversation.push({ role: 'assistant', content: llmResponse });

      console.log(`\n💬 ${MODEL} response (${apiMs}ms):`);
      console.log(`   ${llmResponse.replace(/\n/g, '\n   ')}`);

      // Trim conversation history
      if (conversation.length > 14) {
        conversation.splice(1, conversation.length - 11);
      }

      // 4. Parse commands
      const commands = parseCommands(llmResponse);
      if (commands.length === 0) {
        console.log(`\n⚠️  No commands parsed from response`);
        // Check if it said "done" in prose
        if (/done|complete|finished/i.test(llmResponse)) {
          done = true;
          console.log(`✅ Task appears complete (model said done in prose)`);
        }
        continue;
      }

      // 5. Validate
      const validIds = new Set(snapshot.actions.map(a => a.id));
      const { valid, invalid } = validateCommands(commands, validIds);

      if (invalid.length > 0) {
        console.log(`\n⚠️  Invalid commands: ${invalid.map(c => `${c.action} ${c.target}`).join(', ')}`);
        conversation.push({
          role: 'user',
          content: `⚠ Invalid: ${invalid.map(c => `${c.action} ${c.target}`).join(', ')}. Valid IDs: ${[...validIds].slice(0, 20).join(', ')}`,
        });
      }

      // Check for done
      if (commands.some(c => c.action === 'done')) {
        done = true;
        console.log(`\n✅ Model said "done"`);
      }

      // 6. Execute valid commands
      const executable = valid.filter(c => c.action !== 'done' && c.action !== 'unknown');

      if (executable.length > 0) {
        console.log(`\n🔧 Executing ${executable.length} command(s):`);
        
        // Dry run safety check
        if (DRY_RUN) {
          const blocked: typeof executable = [];
          const safe: typeof executable = [];

          for (const cmd of executable) {
            if (cmd.action === 'click' && cmd.target) {
              const action = snapshot.actions.find(a => a.id === cmd.target);
              if (action && DANGEROUS_LABELS.some(d => action.label.toLowerCase().includes(d))) {
                blocked.push(cmd);
                continue;
              }
            }
            safe.push(cmd);
          }

          if (blocked.length > 0) {
            console.log(`   🛡️  DRY RUN blocked: ${blocked.map(c => {
              const a = snapshot.actions.find(a => a.id === c.target);
              return `${c.action} #${c.target?.slice(1)} "${a?.label}"`;
            }).join(', ')}`);
            console.log(`   (use --live flag to allow)`);
          }

          if (safe.length > 0) {
            const executor = new ActionExecutor(page, snapshot, { minDelay: 300, maxDelay: 600, typeDelay: 30 });
            const results = await executor.executeAll(safe);
            tracker.recordResults(results);

            for (const r of results) {
              const icon = r.status === 'ok' ? '✅' : r.status === 'navigated' ? '🔀' : '❌';
              console.log(`   ${icon} ${r.message} (${r.durationMs}ms)`);
            }

            if (results.some(r => r.status === 'navigated')) {
              await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            }
          }
        } else {
          // LIVE MODE — execute everything
          const executor = new ActionExecutor(page, snapshot, { minDelay: 300, maxDelay: 600, typeDelay: 30 });
          const results = await executor.executeAll(executable);
          tracker.recordResults(results);

          for (const r of results) {
            const icon = r.status === 'ok' ? '✅' : r.status === 'navigated' ? '🔀' : '❌';
            console.log(`   ${icon} ${r.message} (${r.durationMs}ms)`);
          }
        }
      }
    }

    // ─── Final Report ──────────────────────────────────────
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  📊 Final Report`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Model:         ${MODEL}`);
    console.log(`  Task:          ${done ? '✅ COMPLETED' : '⚠️  MAX STEPS REACHED'}`);
    console.log(`  Steps used:    ${tracker.getState().stepsCompleted}`);
    console.log(`  Pages visited: ${tracker.getHistory().length}`);
    console.log(`  Input tokens:  ${totalInputTokens.toLocaleString()}`);
    console.log(`  Output tokens: ${totalOutputTokens.toLocaleString()}`);
    
    const inputCost = (totalInputTokens / 1_000_000) * 0.15;
    const outputCost = (totalOutputTokens / 1_000_000) * 0.60;
    const totalCost = inputCost + outputCost;
    console.log(`  Estimated cost: $${totalCost.toFixed(4)} (in: $${inputCost.toFixed(4)}, out: $${outputCost.toFixed(4)})`);
    console.log(`${'═'.repeat(60)}\n`);

    await page.close();

  } catch (err: any) {
    console.error(`\n❌ Fatal error: ${err.message}`);
    if (page) await page.close().catch(() => {});
  } finally {
    await engine.shutdown();
  }
}

main().catch(console.error);
