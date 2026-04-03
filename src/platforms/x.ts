/**
 * X (Twitter) Platform Playbook
 * 
 * X's DOM is more stable than FB thanks to data-testid attributes.
 * The compose box is a contenteditable [role="textbox"] with
 * data-testid="tweetTextarea_0". Post button has data-testid="tweetButtonInline".
 * 
 * Key differences from Facebook:
 *   - Compose box is always visible on the home feed (no dialog to open)
 *   - data-testid attributes are abundant and stable
 *   - Like/retweet buttons have clear aria-labels with counts
 *   - Character counter visible, 280 limit enforced client-side
 */

import type { Platform } from './types';

const x: Platform = {
  id: 'x',
  name: 'X (Twitter)',
  icon: '𝕏',
  color: '#000000',
  baseUrl: 'https://x.com',
  description: 'Post, like, retweet, reply on X',

  loginCheck: {
    loggedInSelectors: [
      '[data-testid="SideNav_AccountSwitcher_Button"]',
      '[data-testid="AppTabBar_Home_Link"]',
      'a[href="/compose/post"]',
      'nav[aria-label="Primary"]',
    ],
    loginUrlPatterns: [
      '/i/flow/login',
      '/login',
    ],
  },

  flows: [
    // ─── Create Post (Tweet) ───────────────────────────
    {
      id: 'create-post',
      name: 'Post (Tweet)',
      description: 'Write and publish a post on X',
      icon: '✏️',
      category: 'create',
      params: [
        {
          id: 'text',
          label: 'Post text',
          type: 'textarea',
          required: true,
          placeholder: 'What is happening?!',
        },
      ],
      steps: [
        {
          id: 'go-home',
          description: 'Navigate to X home timeline',
          action: { type: 'navigate', url: 'https://x.com/home' },
          onFail: 'abort',
          delayAfterMs: 2500,
        },
        {
          id: 'click-compose',
          description: 'Click the compose box on the home page',
          action: {
            type: 'click',
            selectors: [
              '[data-testid="tweetTextarea_0"]',
              '[role="textbox"][contenteditable="true"]',
              '[data-testid="tweetTextarea_0_label"]',
            ],
            role: 'textbox',
            roleName: 'Post text',
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 500,
        },
        {
          id: 'type-post',
          description: 'Type the post text',
          action: {
            type: 'fill',
            selectors: [
              '[data-testid="tweetTextarea_0"]',
              '[role="textbox"][contenteditable="true"]',
            ],
            text: '{{text}}',
            contenteditable: true,
          },
          onFail: 'ai',
          retries: 1,
          delayAfterMs: 800,
        },
        {
          id: 'click-post',
          description: 'Click the Post button',
          action: {
            type: 'click',
            selectors: [
              '[data-testid="tweetButtonInline"]',
              '[data-testid="tweetButton"]',
            ],
            role: 'button',
            roleName: 'Post',
          },
          verify: {
            type: 'text_on_page',
            text: 'Your post was sent',
            timeoutMs: 8000,
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 2000,
        },
      ],
    },

    // ─── Scroll Timeline ───────────────────────────────
    {
      id: 'scroll-timeline',
      name: 'Scroll Timeline',
      description: 'Read through your home timeline',
      icon: '📜',
      category: 'read',
      params: [
        {
          id: 'scrolls',
          label: 'Number of scrolls',
          type: 'text',
          required: false,
          placeholder: '5',
          default: '5',
        },
      ],
      steps: [
        {
          id: 'go-home',
          description: 'Navigate to X home',
          action: { type: 'navigate', url: 'https://x.com/home' },
          onFail: 'abort',
          delayAfterMs: 2000,
        },
        {
          id: 'scroll-1',
          description: 'Scroll down',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 2000,
        },
        {
          id: 'scroll-2',
          description: 'Continue scrolling',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 2000,
        },
        {
          id: 'scroll-3',
          description: 'Continue scrolling',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 2000,
        },
        {
          id: 'scroll-4',
          description: 'Continue scrolling',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 2000,
        },
        {
          id: 'scroll-5',
          description: 'Continue scrolling',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 2000,
        },
      ],
    },

    // ─── Like First Post ───────────────────────────────
    {
      id: 'like-first-post',
      name: 'Like First Post',
      description: 'Like the first post on your timeline',
      icon: '❤️',
      category: 'engage',
      params: [],
      steps: [
        {
          id: 'go-home',
          description: 'Navigate to X home',
          action: { type: 'navigate', url: 'https://x.com/home' },
          onFail: 'abort',
          delayAfterMs: 2500,
        },
        {
          id: 'click-like',
          description: 'Click the like button on the first post',
          action: {
            type: 'click',
            selectors: [
              '[data-testid="like"]',
              'button[aria-label*="Like"]',
              '[role="group"] button:nth-child(3)',
            ],
            role: 'button',
            roleName: 'Like',
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 500,
        },
      ],
    },

    // ─── Retweet First Post ────────────────────────────
    {
      id: 'retweet-first-post',
      name: 'Repost First Post',
      description: 'Repost the first post on your timeline',
      icon: '🔁',
      category: 'engage',
      params: [],
      steps: [
        {
          id: 'go-home',
          description: 'Navigate to X home',
          action: { type: 'navigate', url: 'https://x.com/home' },
          onFail: 'abort',
          delayAfterMs: 2500,
        },
        {
          id: 'click-retweet',
          description: 'Click the retweet button on the first post',
          action: {
            type: 'click',
            selectors: [
              '[data-testid="retweet"]',
              'button[aria-label*="Repost"]',
            ],
            role: 'button',
            roleName: 'Repost',
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 800,
        },
        {
          id: 'confirm-retweet',
          description: 'Click "Repost" in the dropdown menu',
          action: {
            type: 'click',
            selectors: [
              '[data-testid="retweetConfirm"]',
              '[role="menuitem"]:has([data-testid="retweetConfirm"])',
              '[role="menuitem"]',
            ],
            role: 'menuitem',
            roleName: 'Repost',
          },
          onFail: 'ai',
          retries: 1,
          delayAfterMs: 500,
        },
      ],
    },

    // ─── Reply to First Post ───────────────────────────
    {
      id: 'reply-first-post',
      name: 'Reply to Post',
      description: 'Reply to the first post on your timeline',
      icon: '💬',
      category: 'engage',
      params: [
        {
          id: 'reply',
          label: 'Reply text',
          type: 'textarea',
          required: true,
          placeholder: 'Your reply...',
        },
      ],
      steps: [
        {
          id: 'go-home',
          description: 'Navigate to X home',
          action: { type: 'navigate', url: 'https://x.com/home' },
          onFail: 'abort',
          delayAfterMs: 2500,
        },
        {
          id: 'click-reply',
          description: 'Click the reply button on the first post',
          action: {
            type: 'click',
            selectors: [
              '[data-testid="reply"]',
              'button[aria-label*="Reply"]',
            ],
            role: 'button',
            roleName: 'Reply',
          },
          verify: {
            type: 'visible',
            selector: '[data-testid="tweetTextarea_0"]',
            timeoutMs: 5000,
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 1000,
        },
        {
          id: 'type-reply',
          description: 'Type the reply',
          action: {
            type: 'fill',
            selectors: [
              '[data-testid="tweetTextarea_0"]',
              '[role="dialog"] [role="textbox"]',
              '[role="textbox"][contenteditable="true"]',
            ],
            text: '{{reply}}',
            contenteditable: true,
          },
          onFail: 'ai',
          retries: 1,
          delayAfterMs: 800,
        },
        {
          id: 'submit-reply',
          description: 'Click the Reply button',
          action: {
            type: 'click',
            selectors: [
              '[data-testid="tweetButton"]',
              '[data-testid="tweetButtonInline"]',
            ],
            role: 'button',
            roleName: 'Reply',
          },
          verify: {
            type: 'gone',
            selector: '[role="dialog"]',
            timeoutMs: 8000,
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 2000,
        },
      ],
    },

    // ─── Search ────────────────────────────────────────
    {
      id: 'search',
      name: 'Search',
      description: 'Search for a topic on X',
      icon: '🔍',
      category: 'navigate',
      params: [
        {
          id: 'query',
          label: 'Search query',
          type: 'text',
          required: true,
          placeholder: 'AI agents',
        },
      ],
      steps: [
        {
          id: 'go-explore',
          description: 'Navigate to Explore page',
          action: { type: 'navigate', url: 'https://x.com/explore' },
          onFail: 'abort',
          delayAfterMs: 2000,
        },
        {
          id: 'click-search',
          description: 'Click the search input',
          action: {
            type: 'click',
            selectors: [
              '[data-testid="SearchBox_Search_Input"]',
              'input[aria-label="Search query"]',
              'input[placeholder="Search"]',
            ],
            role: 'searchbox',
            roleName: 'Search query',
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 500,
        },
        {
          id: 'type-query',
          description: 'Type the search query',
          action: {
            type: 'fill',
            selectors: [
              '[data-testid="SearchBox_Search_Input"]',
              'input[aria-label="Search query"]',
            ],
            text: '{{query}}',
          },
          onFail: 'ai',
          retries: 1,
          delayAfterMs: 300,
        },
        {
          id: 'submit-search',
          description: 'Press Enter to search',
          action: {
            type: 'press',
            key: 'Enter',
            selectors: ['[data-testid="SearchBox_Search_Input"]'],
          },
          verify: {
            type: 'url_contains',
            url: 'search',
            timeoutMs: 5000,
          },
          onFail: 'retry',
          retries: 1,
          delayAfterMs: 2000,
        },
      ],
    },
  ],
};

export default x;
