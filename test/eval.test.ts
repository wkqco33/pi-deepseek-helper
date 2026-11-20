import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { collectMetrics, parseJsonl } from '../src/eval/events.ts';
import { buildReport, renderMarkdown } from '../src/eval/report.ts';
import { loadTaskSpecs, parseTaskSpec } from '../src/eval/spec.ts';
import type { RunResult } from '../src/eval/run.ts';

function jsonl(records: readonly unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

test('parseJsonl skips malformed and blank lines', () => {
  const records = parseJsonl(
    '{"type":"agent_start"}\n\nnot json\n{"type":"agent_end"}\n{"type":"trunc',
  );
  assert.equal(records.length, 2);
});

test('collectMetrics counts turns, tools and usage', () => {
  const raw = jsonl([
    { type: 'agent_start' },
    { type: 'tool_execution_start', toolCallId: 'a', toolName: 'bash', args: { command: 'ls' } },
    { type: 'tool_execution_end', toolCallId: 'a', toolName: 'bash', isError: false },
    {
      type: 'turn_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'first' }],
        stopReason: 'toolUse',
        usage: { input: 100, output: 20, cacheRead: 5, cost: { total: 0.01 } },
      },
      toolResults: [],
    },
    { type: 'tool_execution_start', toolCallId: 'b', toolName: 'edit', args: {} },
    { type: 'tool_execution_end', toolCallId: 'b', toolName: 'edit', isError: true },
    {
      type: 'turn_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'endTurn',
        usage: { input: 120, output: 30, cacheRead: 0, cost: { total: 0.02 } },
      },
      toolResults: [],
    },
    { type: 'agent_settled', aborted: false },
  ]);

  const metrics = collectMetrics(parseJsonl(raw));
  assert.equal(metrics.turns, 2);
  assert.equal(metrics.toolCalls, 2);
  assert.equal(metrics.failedToolCalls, 1);
  assert.deepEqual(metrics.toolCallsByName, { bash: 1, edit: 1 });
  assert.deepEqual(metrics.failedToolsByName, { edit: 1 });
  assert.equal(metrics.inputTokens, 220);
  assert.equal(metrics.outputTokens, 50);
  assert.equal(metrics.cacheReadTokens, 5);
  assert.ok(Math.abs(metrics.costUsd - 0.03) < 1e-9);
  assert.equal(metrics.finalText, 'done');
});

test('collectMetrics records an error stop and abort without throwing', () => {
  const raw = jsonl([
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'provider overloaded',
      },
    },
    { type: 'agent_settled', aborted: true },
  ]);
  const metrics = collectMetrics(parseJsonl(raw));
  assert.equal(metrics.turns, 0);
  assert.equal(metrics.aborted, true);
  assert.deepEqual(metrics.errors, ['provider overloaded']);
});

test('parseTaskSpec resolves the fixture and validates the gate', () => {
  const task = parseTaskSpec(
    { id: 'demo', prompt: 'do it', gate: { command: 'python3', args: ['-m', 'unittest'] } },
    'demo.json',
    '/tmp/fixtures',
  );
  assert.equal(task.fixture, '/tmp/fixtures/demo');
  assert.deepEqual(task.gate.args, ['-m', 'unittest']);
  assert.throws(() => parseTaskSpec({ id: 'x', prompt: 'p' }, 'x.json', '/tmp'), /gate/);
  assert.throws(
    () => parseTaskSpec({ id: 'x', prompt: '  ', gate: { command: 'true' } }, 'x.json', '/tmp'),
    /prompt/,
  );
});

test('loadTaskSpecs rejects duplicate ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flash-eval-'));
  const tasksDir = join(dir, 'tasks');
  mkdirSync(tasksDir);
  const spec = { id: 'same', prompt: 'p', gate: { command: 'true' } };
  writeFileSync(join(tasksDir, 'a.json'), JSON.stringify(spec));
  writeFileSync(join(tasksDir, 'b.json'), JSON.stringify(spec));
  assert.throws(() => loadTaskSpecs(tasksDir), /duplicate task id/);
});

function fakeRun(taskId: string, success: boolean, turns: number): RunResult {
  return {
    taskId,
    label: 'test',
    runIndex: 1,
    model: 'model',
    thinking: 'medium',
    success,
    gate: { ok: success, exitCode: success ? 0 : 1, timedOut: false, output: '', durationMs: 10 },
    metrics: {
      turns,
      toolCalls: turns,
      failedToolCalls: 0,
      toolCallsByName: {},
      failedToolsByName: {},
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      costUsd: 0.01,
      stopReasons: [],
      aborted: false,
      finalText: '',
      errors: [],
    },
    piExitCode: 0,
    piTimedOut: false,
    durationMs: 1000,
    workdir: '',
    rawLogPath: '',
    extensionEvents: { gateFire: 0, gateSkip: 0, distillTrim: 0, escalate: 0, omittedChars: 0 },
  };
}

test('buildReport aggregates per task and overall', () => {
  const report = buildReport({
    label: 'current',
    model: 'm',
    thinking: 'medium',
    startedAt: 'start',
    runs: [fakeRun('a', true, 4), fakeRun('a', false, 6), fakeRun('b', true, 2)],
  });
  assert.equal(report.tasks.length, 2);
  const taskA = report.tasks.find((task) => task.taskId === 'a');
  assert.equal(taskA?.attempts, 2);
  assert.equal(taskA?.passRate, 0.5);
  assert.equal(taskA?.avgTurns, 5);
  assert.equal(report.overall.successes, 2);
  assert.equal(report.overall.attempts, 3);
});

test('renderMarkdown shows a delta table only when a baseline is given', () => {
  const runs = [fakeRun('a', true, 4)];
  const current = buildReport({
    label: 'current',
    model: 'm',
    thinking: 'medium',
    startedAt: 's',
    runs,
  });
  const baseline = buildReport({
    label: 'baseline',
    model: 'm',
    thinking: 'medium',
    startedAt: 's',
    runs: [fakeRun('a', false, 8)],
  });
  assert.ok(!renderMarkdown(current).includes('Delta vs'));
  const withDelta = renderMarkdown(current, baseline);
  assert.ok(withDelta.includes('Delta vs baseline'));
  assert.ok(withDelta.includes('+100pp'));
});
