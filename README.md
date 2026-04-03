# EasyCrawl

**Browser intelligence for cheap AI models.**

Pre-digests web pages into structured, numbered action maps that any LLM — even GPT-4o-mini or Llama 7B — can reason about and act on.

---

## The Problem

Smart models (Claude Opus, GPT-4) can look at raw HTML or screenshots and figure out how to navigate websites. But **cheap models** (GPT-4o-mini, Gemini Flash, Mistral) can't handle unstructured DOM or pixel data.

**Result:** Most AI agents can't browse the web effectively without burning $0.10+ per page.

---

## The Solution

EasyCrawl sits between your LLM and the browser, converting messy web pages into **clean, numbered action maps**:

```
Available Actions:
#1 [NAV] Home → /
#2 [NAV] Products → /products
#3 [INPUT:text] "Search products" (placeholder)
#4 [BUTTON] "Search" (submits search form)
#5 [LINK] "View all deals" → /deals
```

Your LLM just picks numbers: `fill #3 "shoes"` → `click #4`

**Token cost:** ~500-2K tokens per page (vs. 10K-50K for raw DOM)

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/yourusername/easycrawl.git
cd easycrawl
npm install
npm run build
```

### 2. Basic Usage (Fetch Mode — No Browser Needed)

```bash
tsx examples/basic-crawl.ts https://example.com
```

This snapshots a page using `fetch` + Cheerio (fast, serverless-friendly).

### 3. Browser Mode (Full Interaction)

**Prerequisites:**
- Chrome or Edge running with remote debugging enabled
- OpenAI API key (for GPT-4o-mini tests)

**Start Chrome with CDP:**
```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=18800 --user-data-dir="C:\temp\chrome-debug"

# Mac
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=18800 --user-data-dir="/tmp/chrome-debug"

# Linux
google-chrome --remote-debugging-port=18800 --user-data-dir="/tmp/chrome-debug"
```

**Set your API key:**
```bash
export OPENAI_API_KEY="sk-..."
```

**Run a test:**
```bash
# Default test (navigate X/Twitter)
tsx examples/gpt4o-mini-test.ts

# Custom URL + task
tsx examples/gpt4o-mini-test.ts "https://facebook.com" "Find the post composer"

# Live mode (actually clicks Post/Send buttons — use carefully!)
tsx examples/gpt4o-mini-test.ts "https://x.com" "Write a test tweet" --live
```

---

## How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Cheap LLM  │ ──► │  EasyCrawl   │ ──► │   Browser    │
│ (GPT-4o-mini)│ ◄── │  Middleware  │ ◄── │  (Playwright)│
└──────────────┘     └──────────────┘     └──────────────┘
      ▲                     │
      │                     ▼
  Simple JSON         Structured Snapshot
  "click #3"          + Numbered Actions
  "fill #5 'shoes'"   + Semantic Labels
```

### PageSnapshot
Structured representation of a web page:
- **Navigation:** Menu links, breadcrumbs, pagination
- **Actions:** Buttons, links, form fields (numbered for easy reference)
- **Content:** Headings, paragraphs, lists, tables
- **Meta:** Page type, form purpose, e-commerce signals

### ActionMap
Interactive elements numbered and described:
```
#1 [INPUT:email] "Email address" (required)
#2 [INPUT:password] "Password" (required, type: password)
#3 [BUTTON] "Sign In" (submits login form)
#4 [LINK] "Forgot password?" → /reset
```

### Command Execution
Simple text commands → browser actions:
- `click #3` → finds element, clicks it
- `fill #1 "user@example.com"` → types in field
- `select #5 "California"` → picks dropdown option
- `scroll down` → scrolls viewport

---

## Examples Included

| File | Description |
|------|-------------|
| `basic-crawl.ts` | Snapshot a page (fetch mode, no browser) |
| `browser-test.ts` | Connect to Chrome via CDP, take snapshot |
| `gpt4o-mini-test.ts` | **Full AI agent loop** — GPT-4o-mini navigates sites |
| `x-post.ts` | Navigate X/Twitter, compose tweet (dry-run safe) |

---

## API Reference

```typescript
import { BrowserEngine } from 'easycrawl';

// Connect to browser
const engine = new BrowserEngine({ cdpUrl: 'http://localhost:18800' });
const page = await engine.getPage('my-session');

// Snapshot a page
import { createBrowserSnapshot } from 'easycrawl';
const snapshot = await createBrowserSnapshot(page);

// Format for LLM
import { formatSnapshot } from 'easycrawl';
const prompt = formatSnapshot(snapshot, 'minimal'); // or 'standard' or 'detailed'

// Execute commands from LLM
import { ActionExecutor, parseCommands } from 'easycrawl';
const commands = parseCommands(llmResponse); // "click #3\nfill #5 shoes"
const executor = new ActionExecutor(page, snapshot);
const results = await executor.executeAll(commands);
```

---

## Configuration

### CDP URL
Default: `http://host.docker.internal:18800`

Change via:
```typescript
const engine = new BrowserEngine({ cdpUrl: 'http://localhost:9222' });
```

Or set environment variable:
```bash
export CDP_URL="http://localhost:9222"
```

### Delays (for human-like interaction)
```typescript
const executor = new ActionExecutor(page, snapshot, {
  minDelay: 300,    // min ms between actions
  maxDelay: 600,    // max ms between actions
  typeDelay: 30     // ms per keystroke
});
```

---

## Safety Features

### Dry-Run Mode (Default)
Blocks dangerous actions like "Post", "Send", "Publish", "Buy Now":

```bash
tsx examples/gpt4o-mini-test.ts  # safe by default
```

### Live Mode (Execute Everything)
```bash
tsx examples/gpt4o-mini-test.ts --live  # ⚠️ actually clicks Post buttons
```

### Dangerous Label Detection
Automatically blocks these action labels in dry-run:
- post, send, publish
- delete, remove
- confirm purchase, pay now, buy now
- tweet, place order

---

## Cost Comparison

| Approach | Model Required | Tokens/Page | Cost/Page |
|----------|---------------|-------------|-----------|
| Raw DOM | GPT-4 Turbo | 10K-50K | $0.10-0.50 |
| Screenshot | GPT-4 Vision | 5K-15K | $0.05-0.15 |
| **EasyCrawl** | **GPT-4o-mini** | **500-2K** | **$0.0001-0.0003** |

**Example:** Navigating 100 pages:
- Raw DOM with GPT-4: ~$20
- EasyCrawl with GPT-4o-mini: ~$0.02

---

## Project Status

**Phase 1 (MVP):** ✅ Complete
- PageSnapshot from fetch + Cheerio
- Browser snapshot via Playwright CDP
- ActionMap extraction
- Command parser & executor
- GPT-4o-mini agent loop

**Phase 2 (Intelligence):** 🚧 In Progress
- Goal tracking ("book a flight" → steps)
- Multi-page session memory
- Error recovery & retry logic

**Phase 3 (Scale):** 📋 Planned
- Hosted API (`POST /snapshot` with URL)
- MCP tool integration
- Browser extension

---

## Contributing

Pull requests welcome! Priority areas:
- More extractors (tables, charts, modals)
- Error recovery strategies
- Support for more LLMs (Anthropic, Gemini, local models)
- Performance optimizations

---

## License

MIT

---

## Questions?

- **Issues:** [GitHub Issues](https://github.com/yourusername/easycrawl/issues)
- **Docs:** See `ARCHITECTURE.md` for deep dive
- **Examples:** Check `examples/` folder

Built by [Dappily](https://dappily.io) — AI tooling for humans.
