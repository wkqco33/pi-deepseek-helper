import { distill } from '../src/distill/policy.ts';
import { loadConfig, logEvent } from '../src/policy.ts';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Tool results whose middle is usually noise.
 *
 * `read` is deliberately absent: a file the model asked to read is content it
 * needs in full, and pi already bounds it. Trimming it would trade a token
 * saving for a wrong answer.
 */
const DISTILLED_TOOLS = new Set(['bash', 'grep', 'find', 'ls']);

function totalChars(content: readonly { type: string; text?: string }[]): number {
  return content.reduce(
    (sum, block) =>
      sum + (block.type === 'text' && typeof block.text === 'string' ? block.text.length : 0),
    0,
  );
}

/**
 * Bounded tool output.
 *
 * Large `bash`, `read`, and search results are trimmed to their head, tail, and
 * failure-looking lines. A result with structured content is left alone: the
 * host drops that field when an extension replaces `content`, and losing
 * machine-readable data is worse than the tokens saved.
 */
export default function distillExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  if (!config.distill) return;

  pi.on('tool_result', (event) => {
    if (!DISTILLED_TOOLS.has(event.toolName)) return;

    // An error result is the one place the model must see the whole message, so
    // it gets a larger budget rather than a tighter one.
    const maxChars = event.isError === true ? config.distillMaxChars * 2 : config.distillMaxChars;
    const beforeChars = totalChars(event.content);
    if (beforeChars <= maxChars) return;

    let omittedChars = 0;
    let changed = false;
    const next = event.content.map((block) => {
      if (block.type !== 'text') return block;
      const result = distill(block.text, { maxChars });
      if (!result.changed) return block;
      changed = true;
      omittedChars += result.omittedChars;
      return { ...block, text: result.text };
    });
    if (!changed) return;

    // `structuredContent` mirrors the raw output for renderers. It is returned
    // trimmed, not dropped: the host discards a field the extension omits.
    let structured = event.structuredContent;
    const rawOutput =
      typeof structured === 'object' && structured !== null && !Array.isArray(structured)
        ? (structured as Record<string, unknown>)['output']
        : undefined;
    if (typeof rawOutput === 'string') {
      const result = distill(rawOutput, { maxChars });
      if (result.changed) {
        omittedChars += result.omittedChars;
        structured = { ...(structured as Record<string, unknown>), output: result.text };
      }
    }

    logEvent({
      feature: 'distill',
      action: 'trim',
      tool: event.toolName,
      beforeChars,
      omittedChars,
      isError: event.isError === true,
    });
    return { content: next, structuredContent: structured };
  });
}
