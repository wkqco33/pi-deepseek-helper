import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** One acceptance command run in the task workdir after the agent finishes. */
export interface EvalGate {
  command: string;
  args?: string[];
  timeoutSec?: number;
}

/**
 * A self-contained evaluation task.
 *
 * The fixture is a pristine directory that the runner copies into a scratch
 * workdir, so a failed run never contaminates the next attempt.
 */
export interface EvalTask {
  id: string;
  title?: string;
  prompt: string;
  gate: EvalGate;
  /** Fixture directory; defaults to `<tasks dir>/../fixtures/<id>`. */
  fixture: string;
  /** Whole-run wall clock limit for the agent invocation. */
  timeoutSec?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string, file: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${file}: "${field}" must be a non-empty string`);
  }
  return value;
}

/** Reads and validates one task spec. Invalid specs fail loudly by design. */
export function parseTaskSpec(raw: unknown, file: string, fixtureRoot: string): EvalTask {
  if (!isRecord(raw)) throw new Error(`${file}: task spec must be a JSON object`);
  const id = asString(raw.id, 'id', file);
  const prompt = asString(raw.prompt, 'prompt', file);
  const gateRaw = raw.gate;
  if (!isRecord(gateRaw)) throw new Error(`${file}: "gate" must be an object`);
  const gate: EvalGate = {
    command: asString(gateRaw.command, 'gate.command', file),
    args: Array.isArray(gateRaw.args) ? gateRaw.args.map((arg) => String(arg)) : [],
    timeoutSec: typeof gateRaw.timeoutSec === 'number' ? gateRaw.timeoutSec : undefined,
  };
  const fixture =
    typeof raw.fixture === 'string' ? resolve(fixtureRoot, raw.fixture) : resolve(fixtureRoot, id);
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    prompt,
    gate,
    fixture,
    timeoutSec: typeof raw.timeoutSec === 'number' ? raw.timeoutSec : undefined,
  };
}

/**
 * Loads every `*.json` task spec in a directory, sorted by id.
 *
 * The fixture root defaults to a sibling `fixtures` directory so a task file
 * stays a one-line-per-field record instead of duplicating a path prefix.
 */
export function loadTaskSpecs(tasksDir: string, fixtureRoot?: string): EvalTask[] {
  const dir = resolve(tasksDir);
  const fixtures = fixtureRoot ? resolve(fixtureRoot) : resolve(dir, '..', 'fixtures');
  const tasks = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = join(dir, name);
      if (!statSync(file).isFile()) throw new Error(`${file}: not a file`);
      return parseTaskSpec(JSON.parse(readFileSync(file, 'utf8')), file, fixtures);
    });
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    seen.add(task.id);
  }
  return tasks;
}
