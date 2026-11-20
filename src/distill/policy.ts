/**
 * Bounded distillation of tool output before it reaches the model.
 *
 * A flash-tier model degrades on long tool results: the middle of a 3000-line
 * log is both expensive and unreadable to it. Keeping the head, the tail, and
 * every line that looks like a failure preserves what the model acts on while
 * removing the middle it skips anyway.
 */

export interface DistillOptions {
  /** Results at or below this length are returned untouched. */
  maxChars: number;
  headLines: number;
  tailLines: number;
  /** Maximum number of matched error lines to keep out of the middle. */
  maxSignalLines: number;
}

export const DEFAULT_DISTILL: DistillOptions = {
  maxChars: 6000,
  headLines: 25,
  tailLines: 20,
  maxSignalLines: 15,
};

export interface DistillResult {
  text: string;
  changed: boolean;
  omittedChars: number;
  keptSignalLines: number;
}

const SIGNAL_PATTERN =
  /\b(error|failed|failure|fatal|panic|exception|traceback|assert|not ok|✗|FAIL|FAILED|ERROR|cannot|undefined|denied|timeout)\b/;

/** Line budget used by the report so a caller can cap a single tool result. */
export function distill(text: string, options: Partial<DistillOptions> = {}): DistillResult {
  const opts: DistillOptions = { ...DEFAULT_DISTILL, ...options };
  if (text.length <= opts.maxChars) {
    return { text, changed: false, omittedChars: 0, keptSignalLines: 0 };
  }

  const lines = text.split('\n');
  const head = lines.slice(0, opts.headLines);
  const tail = lines.slice(Math.max(lines.length - opts.tailLines, opts.headLines));
  const middle = lines.slice(
    opts.headLines,
    Math.max(lines.length - opts.tailLines, opts.headLines),
  );

  const signal = middle.filter((line) => SIGNAL_PATTERN.test(line)).slice(0, opts.maxSignalLines);
  const keptChars = [...head, ...signal, ...tail].reduce((sum, line) => sum + line.length + 1, 0);
  const omittedChars = Math.max(text.length - keptChars, 0);

  const parts: string[] = [...head];
  if (omittedChars > 0) {
    const omittedLines = lines.length - head.length - tail.length - signal.length;
    parts.push(`… [${omittedLines} lines / ${omittedChars} chars omitted]`);
    if (signal.length > 0) {
      parts.push('--- lines that look like failures ---', ...signal, '---');
    }
  }
  parts.push(...tail);

  const distilled = parts.join('\n');
  if (distilled.length >= text.length) {
    // One enormous line (a minified bundle, a JSON blob) has no line
    // structure to trim, so fall back to a character window.
    const headChars = Math.floor(opts.maxChars * 0.6);
    const tailChars = opts.maxChars - headChars;
    const windowed = `${text.slice(0, headChars)}\n… [${text.length - opts.maxChars} chars omitted] …\n${text.slice(-tailChars)}`;
    return {
      text: windowed.length < text.length ? windowed : text,
      changed: windowed.length < text.length,
      omittedChars: Math.max(text.length - windowed.length, 0),
      keptSignalLines: 0,
    };
  }
  return {
    text: distilled,
    changed: true,
    omittedChars: Math.max(text.length - distilled.length, 0),
    keptSignalLines: signal.length,
  };
}
