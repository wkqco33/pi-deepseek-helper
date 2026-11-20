/**
 * Turns the JSONL stream from `pi --mode json` into the handful of numbers an
 * evaluation needs.
 *
 * The parser is deliberately tolerant: an unknown or malformed record is
 * skipped rather than aborting a run that already cost model tokens. A run with
 * no `turn_end` record is still reported (with zero turns) so a provider failure
 * shows up as a failed attempt instead of a crash.
 */

export interface RunMetrics {
  turns: number;
  toolCalls: number;
  failedToolCalls: number;
  toolCallsByName: Record<string, number>;
  failedToolsByName: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  stopReasons: string[];
  aborted: boolean;
  /** Final assistant text of the run, trimmed to a sane comparison size. */
  finalText: string;
  /** Provider or stream-level error strings seen in the run. */
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string')
      parts.push(block.text);
  }
  return parts.join('\n');
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function emptyMetrics(): RunMetrics {
  return {
    turns: 0,
    toolCalls: 0,
    failedToolCalls: 0,
    toolCallsByName: {},
    failedToolsByName: {},
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    stopReasons: [],
    aborted: false,
    finalText: '',
    errors: [],
  };
}

/** Parses one JSONL document. Invalid lines are skipped, not thrown. */
export function parseJsonl(raw: string): unknown[] {
  const records: unknown[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // A truncated final line is the normal shape of an aborted run.
    }
  }
  return records;
}

export function collectMetrics(records: readonly unknown[]): RunMetrics {
  const metrics = emptyMetrics();
  const toolOutcomes = new Map<string, { name: string; isError: boolean }>();
  let finalText = '';

  for (const record of records) {
    if (!isRecord(record)) continue;
    const type = record.type;

    if (type === 'turn_end') {
      metrics.turns += 1;
      const message = record.message;
      if (isRecord(message)) {
        const usage = message.usage;
        if (isRecord(usage)) {
          metrics.inputTokens += num(usage.input);
          metrics.outputTokens += num(usage.output);
          metrics.cacheReadTokens += num(usage.cacheRead);
          const cost = usage.cost;
          metrics.costUsd += isRecord(cost) ? num(cost.total) : num(usage.cost);
        }
        if (typeof message.stopReason === 'string') metrics.stopReasons.push(message.stopReason);
        const text = textOf(message.content);
        if (text !== '') finalText = text;
      }
      continue;
    }

    if (type === 'tool_execution_start') {
      const name = typeof record.toolName === 'string' ? record.toolName : 'unknown';
      metrics.toolCalls += 1;
      bump(metrics.toolCallsByName, name);
      if (typeof record.toolCallId === 'string')
        toolOutcomes.set(record.toolCallId, { name, isError: false });
      continue;
    }

    if (type === 'tool_execution_end') {
      const name = typeof record.toolName === 'string' ? record.toolName : 'unknown';
      const isError = record.isError === true;
      if (isError) {
        metrics.failedToolCalls += 1;
        bump(metrics.failedToolsByName, name);
      }
      if (typeof record.toolCallId === 'string')
        toolOutcomes.set(record.toolCallId, { name, isError });
      continue;
    }

    if (type === 'message_end') {
      const message = record.message;
      if (!isRecord(message)) continue;
      if (message.role === 'assistant') {
        const text = textOf(message.content);
        if (text !== '') finalText = text;
        if (typeof message.errorMessage === 'string' && message.errorMessage !== '') {
          metrics.errors.push(message.errorMessage);
        }
        const stop = message.stopReason;
        if (stop === 'error') {
          const detail =
            typeof message.errorMessage === 'string' ? message.errorMessage : 'stopReason=error';
          if (!metrics.errors.includes(detail)) metrics.errors.push(detail);
        }
      }
      continue;
    }

    if (type === 'agent_settled' && record.aborted === true) metrics.aborted = true;
  }

  metrics.finalText = finalText.length > 4000 ? `${finalText.slice(0, 4000)}…` : finalText;
  return metrics;
}
