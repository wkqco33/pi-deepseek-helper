import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { collectMetrics, parseJsonl, type RunMetrics } from './events.ts';
import type { EvalTask } from './spec.ts';

export interface RunOptions {
  /** Binary to invoke; defaults to `pi` on PATH. */
  piBin?: string;
  model: string;
  thinking?: string;
  /** Extra `-e` extension paths. All discovered extensions are disabled. */
  extensions?: readonly string[];
  workRoot: string;
  /** Directory name for this label, so baseline and variant trees stay apart. */
  label: string;
  runIndex: number;
  timeoutSec?: number;
  keep?: boolean;
}

export interface GateResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  durationMs: number;
}

export interface ExtensionEvents {
  gateFire: number;
  gateSkip: number;
  distillTrim: number;
  escalate: number;
  omittedChars: number;
}

export interface RunResult {
  taskId: string;
  label: string;
  runIndex: number;
  model: string;
  thinking: string;
  success: boolean;
  gate: GateResult;
  metrics: RunMetrics;
  /** Exit code of the `pi` process itself. */
  piExitCode: number | null;
  piTimedOut: boolean;
  durationMs: number;
  workdir: string;
  rawLogPath: string;
  extensionEvents: ExtensionEvents;
}

const EMPTY_EVENTS: ExtensionEvents = {
  gateFire: 0,
  gateSkip: 0,
  distillTrim: 0,
  escalate: 0,
  omittedChars: 0,
};

/**
 * Reads the extension event log the run wrote under `PI_FLASH_LOG`.
 *
 * The harness owns that path, so the file exists exactly when an extension was
 * loaded and chose to record something.
 */
export function readExtensionEvents(path: string): ExtensionEvents {
  const events: ExtensionEvents = { ...EMPTY_EVENTS };
  if (!existsSync(path)) return events;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record !== 'object' || record === null) continue;
    const entry = record as Record<string, unknown>;
    if (entry['feature'] === 'gate' && entry['action'] === 'fire') events.gateFire += 1;
    if (entry['feature'] === 'gate' && entry['action'] === 'skip') events.gateSkip += 1;
    if (entry['feature'] === 'distill' && entry['action'] === 'trim') {
      events.distillTrim += 1;
      events.omittedChars += typeof entry['omittedChars'] === 'number' ? entry['omittedChars'] : 0;
    }
    if (entry['feature'] === 'router' && entry['action'] === 'escalate') events.escalate += 1;
  }
  return events;
}

const MAX_CAPTURE_BYTES = 4096;

function capture(text: string, limit = MAX_CAPTURE_BYTES): string {
  if (Buffer.byteLength(text, 'utf8') <= limit) return text;
  const buffer = Buffer.from(text, 'utf8');
  return `${buffer.subarray(0, limit).toString('utf8')}\n… (${buffer.length - limit} bytes omitted)`;
}

interface SpawnOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Runs a child to completion with a wall-clock limit.
 *
 * A timed-out child is killed as a process group so a grandchild (a formatter
 * daemon, a test runner pool) cannot keep the pipe open after the deadline.
 */
export function runBounded(
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; maxBytes?: number; env?: Record<string, string> },
): Promise<SpawnOutcome> {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      // A pipe stdin never reaches EOF, and `pi --print` waits for it before
      // answering a prompt argument, which turns a run into a silent timeout.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== 'win32' && child.pid !== undefined)
          process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, options.timeoutMs);

    const append = (current: string, chunk: Buffer): string =>
      current.length >= maxBytes
        ? current
        : current + chunk.toString('utf8').slice(0, maxBytes - current.length);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr, timedOut, durationMs: Date.now() - started });
    };

    child.on('error', () => finish(null, null));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

async function runGate(task: EvalTask, workdir: string): Promise<GateResult> {
  const outcome = await runBounded(task.gate.command, task.gate.args ?? [], {
    cwd: workdir,
    timeoutMs: (task.gate.timeoutSec ?? 120) * 1000,
    maxBytes: 256 * 1024,
  });
  return {
    ok: !outcome.timedOut && outcome.code === 0,
    exitCode: outcome.code,
    timedOut: outcome.timedOut,
    output: capture(`${outcome.stdout}\n${outcome.stderr}`.trim()),
    durationMs: outcome.durationMs,
  };
}

function prepareWorkdir(task: EvalTask, options: RunOptions): string {
  const dir = resolve(options.workRoot, options.label, `run-${options.runIndex}`, task.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(task.fixture, dir, { recursive: true });
  return dir;
}

export function piArgs(task: EvalTask, options: RunOptions): string[] {
  const args = ['--mode', 'json', '--print', '--no-session', '--no-extensions'];
  for (const extension of options.extensions ?? []) args.push('--extension', extension);
  if (options.thinking) args.push('--thinking', options.thinking);
  args.push('--model', options.model, task.prompt);
  return args;
}

/** Runs one task once: copy fixture, drive `pi`, then apply the acceptance gate. */
export async function runTask(task: EvalTask, options: RunOptions): Promise<RunResult> {
  const workdir = prepareWorkdir(task, options);
  const args = piArgs(task, options);
  const timeoutMs = (options.timeoutSec ?? task.timeoutSec ?? 900) * 1000;

  const logPath = join(workdir, '.flash-boost', 'events.jsonl');
  const pi = await runBounded(options.piBin ?? 'pi', args, {
    cwd: workdir,
    timeoutMs,
    env: { PI_FLASH_LOG: logPath },
  });
  const metrics = collectMetrics(parseJsonl(pi.stdout));
  if (pi.stderr.trim() !== '' && metrics.errors.length === 0) {
    const firstError = pi.stderr.split('\n').find((line) => /error|Error|failed/.test(line));
    if (firstError) metrics.errors.push(capture(firstError.trim(), 500));
  }

  const gate = await runGate(task, workdir);
  const rawLogPath = join(workdir, 'run.jsonl');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(rawLogPath, pi.stdout);

  const result: RunResult = {
    taskId: task.id,
    label: options.label,
    runIndex: options.runIndex,
    model: options.model,
    thinking: options.thinking ?? 'default',
    success: gate.ok,
    gate,
    metrics,
    piExitCode: pi.code,
    piTimedOut: pi.timedOut,
    durationMs: pi.durationMs + gate.durationMs,
    workdir,
    rawLogPath,
    extensionEvents: readExtensionEvents(logPath),
  };

  if (!options.keep) {
    // Keep the JSONL log next to the report instead of inside the scratch tree.
    const logDir = resolve(options.workRoot, options.label, 'logs');
    mkdirSync(logDir, { recursive: true });
    const persisted = join(logDir, `${task.id}.run-${options.runIndex}.jsonl`);
    writeFileSync(persisted, pi.stdout);
    result.rawLogPath = persisted;
    rmSync(workdir, { recursive: true, force: true });
    result.workdir = '';
  }

  return result;
}
