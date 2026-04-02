# EasyCrawl — Browser Intelligence for Cheap AI Models

## The Problem

Smart models (Claude Opus, GPT-4) can look at a screenshot or DOM dump and figure out how to navigate a website. But most real-world AI agents run on cheap models (GPT-4o-mini, Gemini Flash, Llama, Mistral) that can't reason about raw HTML or screenshots.

**Result:** Browser automation is locked behind expensive models, and 90% of AI agents can't browse the web effectively.

## The Solution

EasyCrawl sits between a cheap LLM and the browser. It pre-digests web pages into **structured, labeled snapshots** that any model — even a 7B parameter one — can reason about and act on.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Cheap LLM  │ ──► │  EasyCrawl   │ ──► │   Browser    │
│  (any model) │ ◄── │  Middleware   │ ◄── │  (Playwright │
│              │     │              │     │   or fetch)  │
└──────────────┘     └──────────────┘     └──────────────┘
      ▲                     │
      │                     ▼
  Simple JSON          Rich Extraction
  commands             + Action Map
  "click #3"           + State Tracking
```

## What Makes This Different

| Feature | Raw DOM/Screenshot | Accessibility Tree | **EasyCrawl** |
|---------|-------------------|-------------------|---------------|
| Model requirement | GPT-4+ | GPT-4+ | Any (GPT-4o-mini, Llama, etc.) |
| Token cost | 10K-50K/page | 2K-8K/page | **500-2K/page** |
| Semantic labels | ❌ | Partial (ARIA) | ✅ Full (type, purpose, context) |
| Interaction map | ❌ | Partial | ✅ Numbered + described |
| Form understanding | ❌ | Basic | ✅ Fields, types, validation |
| Navigation context | ❌ | ❌ | ✅ Breadcrumbs, page type |
| State tracking | ❌ | ❌ | ✅ Before/after diffs |
| Works without JS | ❌ Screenshot needs render | ❌ Needs render | ✅ fetch + Cheerio |

## Core Concepts

### 1. PageSnapshot
A structured representation of a web page optimized for LLM consumption.

```json
{
  "url": "https://example.com/contact",
  "title": "Contact Us — Example Corp",
  "pageType": "contact",
  "summary": "Contact page with email form, phone number, and office address",
  "navigation": [
    { "id": "nav1", "text": "Home", "href": "/" },
    { "id": "nav2", "text": "About", "href": "/about" },
    { "id": "nav3", "text": "Contact", "href": "/contact", "active": true }
  ],
  "actions": [
    { "id": "a1", "type": "input", "label": "Your Name", "inputType": "text", "required": true },
    { "id": "a2", "type": "input", "label": "Email", "inputType": "email", "required": true },
    { "id": "a3", "type": "textarea", "label": "Message", "required": false },
    { "id": "a4", "type": "button", "label": "Send Message", "purpose": "submit-form" },
    { "id": "a5", "type": "link", "label": "info@example.com", "href": "mailto:info@example.com" }
  ],
  "content": [
    { "type": "heading", "text": "Get in Touch" },
    { "type": "paragraph", "text": "We'd love to hear from you. Fill out the form..." },
    { "type": "address", "text": "123 Main St, Austin TX 78701" },
    { "type": "phone", "text": "(512) 555-0100" }
  ],
  "images": [
    { "id": "img1", "alt": "Office building", "context": "hero image" }
  ],
  "meta": {
    "hasForm": true,
    "formPurpose": "contact",
    "isEcommerce": false,
    "loginRequired": false
  }
}
```

### 2. ActionMap
Numbered, described interactive elements. The LLM just picks a number.

```
Available Actions:
#1 [NAV] Home → /
#2 [NAV] About → /about  
#3 [NAV] Contact → /contact (current page)
#4 [INPUT:text] "Your Name" (required)
#5 [INPUT:email] "Email" (required)
#6 [TEXTAREA] "Message"
#7 [BUTTON] "Send Message" (submits contact form)
#8 [LINK] "info@example.com" (opens email)
```

A cheap model sees this and can easily respond: `fill #4 "John Smith"` or `click #7`.

### 3. ActionExecutor
Translates simple commands back to browser actions:
- `click #7` → finds the actual DOM element, clicks it
- `fill #4 "John Smith"` → finds input, clears it, types the value
- `select #9 "California"` → finds dropdown, selects option
- `scroll down` → scrolls viewport
- `wait` → waits for page load/navigation

### 4. Session (StateTracker)
Tracks page state across actions. After each action, returns a diff:

```json
{
  "action": "fill #4 \"John Smith\"",
  "result": "success",
  "changes": [
    { "id": "a4", "field": "Your Name", "value": "John Smith", "was": "" }
  ],
  "newActions": [],
  "removedActions": [],
  "navigation": null
}
```

## Architecture

```
easycrawl/
├── src/
│   ├── core/
│   │   ├── snapshot.ts      — PageSnapshot builder (fetch + Cheerio)
│   │   ├── actionMap.ts     — Extract & number interactive elements
│   │   └── formatter.ts     — Format snapshot for LLM (text, JSON, minimal)
│   ├── actions/
│   │   ├── executor.ts      — Execute actions (Playwright or fetch-based)
│   │   ├── parser.ts        — Parse LLM output into actions
│   │   └── commands.ts      — Command definitions (click, fill, select, scroll...)
│   ├── extractors/
│   │   ├── navigation.ts    — Nav menu, breadcrumbs, pagination
│   │   ├── forms.ts         — Form fields, types, validation, purpose
│   │   ├── content.ts       — Text blocks, headings, lists, tables
│   │   ├── media.ts         — Images, videos with context
│   │   ├── commerce.ts      — Products, prices, cart, checkout
│   │   └── pageType.ts      — Classify page (home, contact, product, blog, etc.)
│   ├── session/
│   │   ├── tracker.ts       — State tracking across actions
│   │   ├── memory.ts        — Conversation memory (what pages visited, what done)
│   │   └── goals.ts         — Goal tracking ("fill out contact form" → steps)
│   └── index.ts             — Main export
├── examples/
│   ├── basic-crawl.ts       — Snapshot a page
│   ├── fill-form.ts         — Navigate to contact page, fill form
│   ├── product-search.ts    — Search for product, add to cart
│   └── scrape-data.ts       — Extract structured data from multiple pages
├── test/
├── package.json
├── tsconfig.json
└── README.md
```

## Usage

```typescript
import { EasyCrawl } from 'easycrawl';

const crawler = new EasyCrawl();

// Get a page snapshot optimized for cheap LLMs
const snapshot = await crawler.snapshot('https://example.com/contact');

// Format it for your model (different verbosity levels)
const prompt = snapshot.format('minimal'); // ~500 tokens
// or: snapshot.format('standard');        // ~1-2K tokens
// or: snapshot.format('detailed');        // ~3-5K tokens

// Send to any LLM, get back simple commands
const llmResponse = await yourModel.chat(prompt + "\n\nFill out the contact form with name 'John' and email 'john@test.com'");
// LLM responds: "fill #4 John\nfill #5 john@test.com\nclick #7"

// Execute the commands
const results = await crawler.execute(llmResponse);
// Returns: [{ action: "fill #4", status: "ok" }, ...]
```

## Modes

### 1. Fetch Mode (Default — No Browser Needed)
Uses `fetch` + Cheerio. Fast, cheap, works for most static/SSR sites.
- ✅ No Playwright/Puppeteer dependency
- ✅ Works in serverless (Lambda, Vercel, etc.)
- ❌ Can't handle SPAs or JS-rendered content
- ❌ Can't actually click/fill (read-only unless paired with executor)

### 2. Browser Mode (Full Interaction)
Uses Playwright. Can click, fill, navigate, screenshot.
- ✅ Full interaction
- ✅ Handles SPAs, JS-rendered sites
- ❌ Needs Playwright installed
- ❌ Heavier resource usage

### 3. Hybrid Mode
Fetch for snapshots, Playwright only when interaction needed.
Best of both worlds — default recommendation.

## Revenue / Distribution Angles

1. **npm package** — Free core, paid hosted API (like Browserbase model)
2. **Dappily module** — Pre-integrated into Dappily platform
3. **MCP tool** — Plug into any AI agent framework
4. **API service** — `POST /snapshot` with URL, get back structured page
5. **Browser extension** — Real-time page digestion for local LLMs

## Competitive Landscape

- **Vercel agent-browser** — Accessibility tree approach, Rust, needs browser running
- **Browserbase / Hyperbrowser** — Cloud browser infra, expensive, aimed at big models
- **Firecrawl** — Good scraper but no action map or LLM optimization
- **Crawl4AI** — Python, good extraction but no interaction layer
- **Jina Reader** — URL to markdown, no semantic structure

**EasyCrawl's moat:** The action map + numbered interaction system. Nobody is translating pages into "pick a number" interfaces for cheap models. This is the missing piece that makes $0.001/call models useful for browser automation.

## Phase 1 (MVP — Ship in 1-2 days)
- [ ] PageSnapshot from fetch + Cheerio
- [ ] ActionMap extraction (links, buttons, forms)
- [ ] LLM formatter (minimal/standard/detailed)
- [ ] Command parser (click, fill, select)
- [ ] Basic examples
- [ ] npm publish as `easycrawl`

## Phase 2 (Interaction)
- [ ] Playwright executor
- [ ] Session state tracking
- [ ] Form auto-detection and purpose classification
- [ ] Page type classification

## Phase 3 (Intelligence)
- [ ] Goal decomposition ("book a flight" → steps)
- [ ] Multi-page session memory
- [ ] Error recovery ("button not found" → re-snapshot, try again)
- [ ] AI-assisted element resolution (fallback for ambiguous selectors)
