/**
 * Facebook Platform Playbook
 * 
 * Hardcoded knowledge of Facebook's DOM for deterministic automation.
 * AI fallback when selectors break (which they will — FB changes weekly).
 * 
 * Key insight: Facebook renders everything inside React portals and
 * dialog modals. The compose box is a contenteditable [role="textbox"]
 * inside a [role="dialog"]. Post button is inside that same dialog.
 * 
 * Selector strategy: data-testid is rare on FB. We rely on:
 *   1. role + aria-label combinations
 *   2. Scoped contenteditable inside dialogs
 *   3. Text content matching for buttons
 * 
 * Known gotchas:
 *   - FB serves different DOM for mobile vs desktop viewport
 *   - Compose modal only opens after clicking the "What's on your mind?" prompt
 *   - Post button is disabled until text is entered
 *   - Privacy selector defaults to last used setting
 *   - Image upload requires clicking photo/video button INSIDE the compose modal
 */

import type { Platform } from './types';

const facebook: Platform = {
  id: 'facebook',
  name: 'Facebook',
  icon: '📘',
  color: '#1877F2',
  baseUrl: 'https://www.facebook.com',
  description: 'Post, scroll, like, comment on Facebook',

  loginCheck: {
    loggedInSelectors: [
      '[aria-label="Your profile"]',
      '[aria-label="Account"]',
      '[aria-label="Menu"]',
      '[data-pagelet="LeftRail"]',
      '[role="banner"] [role="navigation"]',
    ],
    loginUrlPatterns: [
      '/login',
      '/checkpoint',
      'login.facebook.com',
    ],
  },

  flows: [
    // ─── Create Post (Text) ────────────────────────────
    {
      id: 'create-post',
      name: 'Create Post',
      description: 'Write and publish a text post to your timeline',
      icon: '✏️',
      category: 'create',
      params: [
        {
          id: 'text',
          label: 'Post text',
          type: 'textarea',
          required: true,
          placeholder: 'What\'s on your mind?',
        },
        {
          id: 'privacy',
          label: 'Privacy',
          type: 'select',
          required: false,
          options: ['Public', 'Friends', 'Only me'],
          default: 'Friends',
        },
      ],
      steps: [
        {
          id: 'go-home',
          description: 'Navigate to Facebook home feed',
          action: { type: 'navigate', url: 'https://www.facebook.com/' },
          onFail: 'abort',
          delayAfterMs: 2000,
        },
        {
          id: 'open-compose',
          description: 'Click the "What\'s on your mind?" prompt to open compose dialog',
          action: {
            type: 'click',
            selectors: [
              '[aria-label="Create a post"]',
              '[role="button"][aria-label="What\'s on your mind?"]',
              'div[role="main"] [role="button"]:has(span)',
            ],
            role: 'button',
            roleName: "What's on your mind",
          },
          verify: {
            type: 'visible',
            selector: '[role="dialog"]',
            timeoutMs: 5000,
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 1500,
        },
        {
          id: 'type-post',
          description: 'Type the post text into the compose editor',
          action: {
            type: 'fill',
            selectors: [
              '[role="dialog"] [role="textbox"][contenteditable="true"]',
              '[role="dialog"] [contenteditable="true"]',
              '[role="textbox"][aria-label*="on your mind"]',
              '[role="textbox"][contenteditable="true"]',
            ],
            text: '{{text}}',
            contenteditable: true,
          },
          verify: {
            type: 'none',
          },
          onFail: 'ai',
          retries: 1,
          delayAfterMs: 1000,
        },
        {
          id: 'click-post',
          description: 'Click the Post button to publish',
          action: {
            type: 'click',
            selectors: [
              '[role="dialog"] [aria-label="Post"]',
              '[role="dialog"] div[role="button"]:has(span:text("Post"))',
              '[role="dialog"] [aria-label="Post"][role="button"]',
            ],
            role: 'button',
            roleName: 'Post',
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

    // ─── Scroll Feed ───────────────────────────────────
    {
      id: 'scroll-feed',
      name: 'Scroll Feed',
      description: 'Scroll through the news feed and read posts',
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
          description: 'Navigate to Facebook home feed',
          action: { type: 'navigate', url: 'https://www.facebook.com/' },
          onFail: 'abort',
          delayAfterMs: 2000,
        },
        {
          id: 'scroll-1',
          description: 'Scroll down to load more posts',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 1500,
        },
        {
          id: 'scroll-2',
          description: 'Continue scrolling',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 1500,
        },
        {
          id: 'scroll-3',
          description: 'Continue scrolling',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 1500,
        },
        {
          id: 'scroll-4',
          description: 'Continue scrolling',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 1500,
        },
        {
          id: 'scroll-5',
          description: 'Continue scrolling',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 1500,
        },
      ],
    },

    // ─── Like a Post ───────────────────────────────────
    {
      id: 'like-first-post',
      name: 'Like First Post',
      description: 'Like the first post in your feed',
      icon: '👍',
      category: 'engage',
      params: [],
      steps: [
        {
          id: 'go-home',
          description: 'Navigate to Facebook home feed',
          action: { type: 'navigate', url: 'https://www.facebook.com/' },
          onFail: 'abort',
          delayAfterMs: 3000,
        },
        {
          id: 'scroll-to-posts',
          description: 'Scroll down slightly to get past stories',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 1000,
        },
        {
          id: 'click-like',
          description: 'Click the Like button on the first post',
          action: {
            type: 'click',
            selectors: [
              '[aria-label="Like"]',
              'div[role="button"][aria-label="Like"]',
              '[data-testid="UFI2ReactionsCount/root"] ~ div [role="button"]',
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

    // ─── Comment on First Post ─────────────────────────
    {
      id: 'comment-first-post',
      name: 'Comment on Post',
      description: 'Write a comment on the first post in your feed',
      icon: '💬',
      category: 'engage',
      params: [
        {
          id: 'comment',
          label: 'Comment text',
          type: 'textarea',
          required: true,
          placeholder: 'Great post!',
        },
      ],
      steps: [
        {
          id: 'go-home',
          description: 'Navigate to Facebook home feed',
          action: { type: 'navigate', url: 'https://www.facebook.com/' },
          onFail: 'abort',
          delayAfterMs: 3000,
        },
        {
          id: 'scroll-to-posts',
          description: 'Scroll down to first post',
          action: { type: 'scroll', direction: 'down' },
          onFail: 'skip',
          delayAfterMs: 1000,
        },
        {
          id: 'click-comment-button',
          description: 'Click Comment button to open comment box',
          action: {
            type: 'click',
            selectors: [
              '[aria-label="Leave a comment"]',
              '[aria-label="Comment"]',
              'div[role="button"][aria-label="Comment"]',
            ],
            role: 'button',
            roleName: 'Comment',
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 1000,
        },
        {
          id: 'type-comment',
          description: 'Type the comment',
          action: {
            type: 'fill',
            selectors: [
              '[aria-label="Write a comment"][contenteditable="true"]',
              '[aria-label="Write a comment…"][contenteditable="true"]',
              '[role="textbox"][contenteditable="true"]',
            ],
            text: '{{comment}}',
            contenteditable: true,
          },
          onFail: 'ai',
          retries: 1,
          delayAfterMs: 500,
        },
        {
          id: 'submit-comment',
          description: 'Press Enter to submit the comment',
          action: { type: 'press', key: 'Enter' },
          onFail: 'retry',
          retries: 1,
          delayAfterMs: 1000,
        },
      ],
    },

    // ─── Go to Profile ─────────────────────────────────
    {
      id: 'go-profile',
      name: 'View Profile',
      description: 'Navigate to your own profile page',
      icon: '👤',
      category: 'navigate',
      params: [],
      steps: [
        {
          id: 'click-profile',
          description: 'Click your profile link',
          action: {
            type: 'click',
            selectors: [
              '[aria-label="Your profile"]',
              'a[href*="/me/"]',
              '[data-pagelet="LeftRail"] a[aria-label]',
            ],
            role: 'link',
            roleName: 'Your profile',
          },
          verify: {
            type: 'url_contains',
            url: '/profile',
            timeoutMs: 5000,
          },
          onFail: 'ai',
          retries: 2,
          delayAfterMs: 2000,
        },
      ],
    },

    // ─── Go to Marketplace ─────────────────────────────
    {
      id: 'go-marketplace',
      name: 'Browse Marketplace',
      description: 'Navigate to Facebook Marketplace',
      icon: '🛒',
      category: 'navigate',
      params: [],
      steps: [
        {
          id: 'navigate-marketplace',
          description: 'Go directly to Marketplace URL',
          action: { type: 'navigate', url: 'https://www.facebook.com/marketplace/' },
          verify: {
            type: 'url_contains',
            url: 'marketplace',
            timeoutMs: 5000,
          },
          onFail: 'abort',
          delayAfterMs: 2000,
        },
      ],
    },
  ],
};

export default facebook;
