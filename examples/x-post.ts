/**
 * Real test: Post a tweet on X.com using EasyCrawl + Playwright.
 * 
 * Uses OpenClaw's browser (already logged in) via CDP.
 * Demonstrates the full pipeline: snapshot → understand → act.
 * 
 * Usage: tsx examples/x-post.ts "Your tweet text here"
 */

import { BrowserEngine } from '../src/browser/engine';
import { createBrowserSnapshot } from '../src/browser/snapshot';
import { formatSnapshot } from '../src/core/formatter';
import { ActionExecutor } from '../src/actions/executor';
import { parseCommands } from '../src/actions/parser';
import { SessionTracker } from '../src/session/tracker';

const CDP_URL = 'http://host.docker.internal:18800';
const TWEET_TEXT = process.argv[2] || 'Testing EasyCrawl — AI browser automation that actually works 🤖🔥';

async function main() {
  console.log(`\n🐦 X.com Post Test`);
  console.log(`📝 Tweet: "${TWEET_TEXT}"\n`);

  const engine = new BrowserEngine({ cdpUrl: CDP_URL });
  const tracker = new SessionTracker({ goal: `Post a tweet: "${TWEET_TEXT}"` });

  try {
    const page = await engine.getPage('x-post');
    console.log('✅ Connected to browser');

    // Step 1: Navigate to X.com home
    console.log('\n--- Step 1: Navigate to X.com ---');
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // Let tweets load

    // Step 2: Snapshot the page
    console.log('--- Step 2: Snapshot page ---');
    const snapshot = await createBrowserSnapshot(page, {
      waitForNetworkIdle: false, // X.com never truly goes idle (streaming)
      extraWaitMs: 1000,
    });
    tracker.recordPageVisit(snapshot);

    console.log(`   Page: ${snapshot.title}`);
    console.log(`   Actions: ${snapshot.actions.length}`);

    // Print the action map so we can see what the AI would see
    const formatted = formatSnapshot(snapshot, 'standard');
    console.log(`\n📋 Action Map:\n`);
    // Just show action lines
    const actionLines = formatted.split('\n').filter(l => l.startsWith('  #'));
    for (const line of actionLines) {
      console.log(line);
    }

    // Step 3: Find the tweet composer
    // On X.com home, the tweet box is a contenteditable div, not an <input>
    // The action map should show buttons like "Post", "Add photos", etc.
    console.log('\n--- Step 3: Compose tweet ---');

    // Strategy: click on the tweet compose area, type the text, then click Post
    // The compose box on X is [data-testid="tweetTextarea_0"] — a contenteditable div
    // Our action map might not capture contenteditable divs, so we use a hybrid approach
    
    // First try: look for a compose-related action in the map
    const postButton = snapshot.actions.find(a => 
      a.label === 'Post' && a.type === 'button'
    );
    
    if (!postButton) {
      console.log('   ⚠ Post button not found in action map');
      console.log('   Trying direct Playwright interaction...');
    } else {
      console.log(`   ✅ Found Post button: ${postButton.id}`);
    }

    // Click the compose area (X uses contenteditable divs, not inputs)
    const composeBox = page.locator('[data-testid="tweetTextarea_0"]').first();
    const composeExists = await composeBox.count();
    
    if (composeExists > 0) {
      console.log('   ✅ Found tweet compose box');
      await composeBox.click();
      await page.waitForTimeout(300);
      
      // Type the tweet
      await page.keyboard.type(TWEET_TEXT, { delay: 30 });
      console.log(`   ✅ Typed tweet text`);
      await page.waitForTimeout(500);

      // Now use the executor to click Post
      if (postButton) {
        console.log('\n--- Step 4: Click Post ---');
        
        // Re-snapshot after typing (Post button state may have changed)
        const snapshot2 = await createBrowserSnapshot(page, { waitForNetworkIdle: false });
        const executor = new ActionExecutor(page, snapshot2, {
          minDelay: 300,
          maxDelay: 600,
        });

        // Find the Post button in the new snapshot
        const newPostBtn = snapshot2.actions.find(a => a.label === 'Post' && a.type === 'button');
        if (newPostBtn) {
          console.log(`   🔘 Clicking ${newPostBtn.id} "${newPostBtn.label}"...`);
          
          // DRY RUN — uncomment the next line to actually post
          console.log(`   ⏸️ DRY RUN — would execute: click #${newPostBtn.id.slice(1)}`);
          console.log(`   To actually post, edit the script and uncomment the execute line.`);
          
          // UNCOMMENT TO ACTUALLY POST:
          // const results = await executor.executeAll(parseCommands(`click #${newPostBtn.id.slice(1)}`));
          // for (const r of results) {
          //   console.log(`   ${r.status === 'ok' ? '✅' : '❌'} ${r.message}`);
          // }
        }
      }
    } else {
      console.log('   ❌ Compose box not found — might need to click "compose" button first');
    }

    // Clean up
    await page.close();
    console.log('\n✅ Tab closed.');
    console.log('\n📊 Session Summary:');
    console.log(tracker.getContextSummary());

  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
  } finally {
    await engine.shutdown();
  }
}

main().catch(console.error);
