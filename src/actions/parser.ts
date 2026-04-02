/**
 * Parse LLM text output into executable commands.
 * Handles various formats models might use.
 */

export interface ParsedCommand {
  action: 'click' | 'fill' | 'select' | 'check' | 'uncheck' | 'scroll' | 'press' | 'back' | 'goto' | 'done' | 'wait' | 'unknown';
  target?: string; // action ID like "a7" or "#7"
  value?: string;  // text for fill/select, URL for goto, direction for scroll, key for press
  raw: string;     // original text
}

export function parseCommands(text: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const cmd = parseSingleCommand(line);
    if (cmd) commands.push(cmd);
  }

  return commands;
}

function parseSingleCommand(line: string): ParsedCommand | null {
  // Normalize: strip leading numbers, bullets, dashes
  let clean = line.replace(/^[\d.)\-•*]+\s*/, '').trim();

  // "click #7" or "click #a7" or "click a7" or "click 7"
  let match = clean.match(/^click\s+#?a?(\d+)/i);
  if (match) return { action: 'click', target: `a${match[1]}`, raw: line };

  // "fill #4 John Smith" or 'fill #4 "John Smith"'
  match = clean.match(/^fill\s+#?a?(\d+)\s+["']?(.+?)["']?\s*$/i);
  if (match) return { action: 'fill', target: `a${match[1]}`, value: match[2], raw: line };

  // "type #4 John Smith" (alias for fill)
  match = clean.match(/^type\s+#?a?(\d+)\s+["']?(.+?)["']?\s*$/i);
  if (match) return { action: 'fill', target: `a${match[1]}`, value: match[2], raw: line };

  // "select #9 California" or 'select #9 "California"'
  match = clean.match(/^select\s+#?a?(\d+)\s+["']?(.+?)["']?\s*$/i);
  if (match) return { action: 'select', target: `a${match[1]}`, value: match[2], raw: line };

  // "check #10" / "uncheck #10"
  match = clean.match(/^(check|uncheck)\s+#?a?(\d+)/i);
  if (match) return { action: match[1].toLowerCase() as 'check' | 'uncheck', target: `a${match[2]}`, raw: line };

  // "scroll down" / "scroll up"
  match = clean.match(/^scroll\s+(up|down)/i);
  if (match) return { action: 'scroll', value: match[1].toLowerCase(), raw: line };

  // "press Enter" / "press Enter on #4" / "press Tab" / "press Escape"
  match = clean.match(/^press\s+(\w+)(?:\s+(?:on\s+)?#?a?(\d+))?/i);
  if (match) return { action: 'press', value: match[1], target: match[2] ? `a${match[2]}` : undefined, raw: line };

  // "hit Enter" (alias)
  match = clean.match(/^hit\s+(\w+)(?:\s+(?:on\s+)?#?a?(\d+))?/i);
  if (match) return { action: 'press', value: match[1], target: match[2] ? `a${match[2]}` : undefined, raw: line };

  // "submit #4" (shorthand for press Enter on a field)
  match = clean.match(/^submit\s+#?a?(\d+)/i);
  if (match) return { action: 'press', value: 'Enter', target: `a${match[1]}`, raw: line };

  // "back"
  if (/^back$/i.test(clean)) return { action: 'back', raw: line };

  // "goto URL"
  match = clean.match(/^goto\s+(https?:\/\/.+)/i);
  if (match) return { action: 'goto', value: match[1].trim(), raw: line };

  // "navigate to URL" (common model output)
  match = clean.match(/^navigate\s+(?:to\s+)?(https?:\/\/.+)/i);
  if (match) return { action: 'goto', value: match[1].trim(), raw: line };

  // "done" with optional summary
  if (/^done\b/i.test(clean)) return { action: 'done', value: clean.replace(/^done\s*/i, '').trim() || undefined, raw: line };

  // "wait"
  if (/^wait$/i.test(clean)) return { action: 'wait', raw: line };

  // If the model just says a number, treat it as a click
  match = clean.match(/^#?(\d+)$/);
  if (match) return { action: 'click', target: `a${match[1]}`, raw: line };

  // Fuzzy extraction: model says it in prose like "Scrolling down now" or "I will scroll down"
  if (/scroll(?:ing)?\s+down/i.test(clean)) return { action: 'scroll', value: 'down', raw: line };
  if (/scroll(?:ing)?\s+up/i.test(clean)) return { action: 'scroll', value: 'up', raw: line };

  return null;
}

/**
 * Validate commands against the action map.
 * Returns commands with valid targets, and a list of invalid ones.
 */
export function validateCommands(
  commands: ParsedCommand[],
  validIds: Set<string>
): { valid: ParsedCommand[]; invalid: ParsedCommand[] } {
  const valid: ParsedCommand[] = [];
  const invalid: ParsedCommand[] = [];

  for (const cmd of commands) {
    if (cmd.target && !validIds.has(cmd.target)) {
      invalid.push(cmd);
    } else {
      valid.push(cmd);
    }
  }

  return { valid, invalid };
}
