/**
 * Platform Registry — Central registry of all available platform playbooks.
 */

import type { Platform, Flow } from './types';
import facebook from './facebook';
import x from './x';

// ─── Registry ────────────────────────────────────────────────

const platforms = new Map<string, Platform>();

// Register built-in platforms
platforms.set(facebook.id, facebook);
platforms.set(x.id, x);

// ─── Public API ──────────────────────────────────────────────

export function getPlatform(id: string): Platform | undefined {
  return platforms.get(id);
}

export function listPlatforms(): Platform[] {
  return Array.from(platforms.values());
}

export function getFlow(platformId: string, flowId: string): Flow | undefined {
  const platform = platforms.get(platformId);
  if (!platform) return undefined;
  return platform.flows.find(f => f.id === flowId);
}

export function registerPlatform(platform: Platform): void {
  platforms.set(platform.id, platform);
}

/**
 * Get a summary of all platforms and flows — useful for LLM context
 * and for the dashboard to enumerate capabilities.
 */
export function getPlatformSummary(): Array<{
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  flows: Array<{ id: string; name: string; icon: string; description: string; category: string; params: string[] }>;
}> {
  return listPlatforms().map(p => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    color: p.color,
    description: p.description,
    flows: p.flows.map(f => ({
      id: f.id,
      name: f.name,
      icon: f.icon,
      description: f.description,
      category: f.category,
      params: f.params.map(fp => `${fp.id}${fp.required ? '*' : ''}`),
    })),
  }));
}
