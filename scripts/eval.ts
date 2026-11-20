#!/usr/bin/env -S tsx
/**
 * Eval harness CLI.
 *
 * Measures a model (or a model plus extensions) against small, self-contained
 * coding tasks. Every attempt gets a pristine fixture copy, so a pass rate is a
 * property of the model configuration and not of leftover state.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadTaskSpecs } from '../src/eval/spec.ts';
import { runTask, type RunResult } from '../src/eval/run.ts';
import { buildReport, renderMarkdown, type Report } from '../src/eval/report.ts';

interface Args {
  tasksDir: string;
  only: string[];
  model: string;
  thinking: string;
  repeat: number;
  extensions: string[];
  label: string;
  baseline?: string;
  out?: string;
  workRoot: string;
  dryRun: boolean;
  keep: boolean;
  timeoutSec?: number;
}

function defaultModel(): string {
  try {
    const settings = JSON.parse(
      readFileSync(join(homedir(), '.pi', 'agent', 'settings.json'), 'utf8'),
    ) as {
      defaultModel?: string;
    };
    return settings.defaultModel ?? 'deepseek-v4.1-flash:1017-cloud';
  } catch {
    return 'deepseek-v4.1-flash:1017-cloud';
  }
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    tasksDir: 'evals/tasks',
    only: [],
    model: process.env['PI_EVAL_MODEL'] ?? defaultModel(),
    thinking: process.env['PI_EVAL_THINKING'] ?? 'medium',
    repeat: 1,
    extensions: [],
    label: 'current',
    workRoot: '.work',
    dryRun: false,
    keep: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case '--tasks':
        args.tasksDir = next();
        break;
      case '--only':
        args.only = next()
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id !== '');
        break;
      case '--model':
        args.model = next();
        break;
      case '--thinking':
        args.thinking = next();
        break;
      case '--repeat':
        args.repeat = Number.parseInt(next(), 10);
        break;
      case '--ext':
        args.extensions.push(resolve(next()));
        break;
      case '--label':
        args.label = next();
        break;
      case '--baseline':
        args.baseline = resolve(next());
        break;
      case '--out':
        args.out = resolve(next());
        break;
      case '--work':
        args.workRoot = next();
        break;
      case '--timeout':
        args.timeoutSec = Number.parseInt(next(), 10);
        break;
      case '--keep':
        args.keep = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.repeat) || args.repeat < 1) throw new Error('--repeat must be >= 1');
  return args;
}

function printHelp(): void {
  process.stdout.write(`Usage: pnpm eval -- [options]

Tasks run against a pristine fixture copy with all discovered extensions
disabled, so a result reflects only the model and the extensions passed here.

  --tasks <dir>      task spec directory (default evals/tasks)
  --only <ids>       comma separated task ids
  --model <id>       model to evaluate (default: settings.json defaultModel)
  --thinking <lvl>   thinking level (default medium)
  --repeat <n>       attempts per task (default 1)
  --ext <path>       extension path loaded with -e (repeatable)
  --label <name>     report label and work subdirectory (default current)
  --baseline <file>  compare against a saved report JSON
  --out <file>       report JSON destination (default .work/eval-<label>-<ts>.json)
  --work <dir>       scratch directory (default .work)
  --timeout <sec>    per-attempt wall clock limit
  --keep             keep task workdirs for inspection
  --dry-run          print the resolved plan and exit
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const all = loadTaskSpecs(args.tasksDir);
  const tasks = args.only.length > 0 ? all.filter((task) => args.only.includes(task.id)) : all;
  if (tasks.length === 0)
    throw new Error(`no tasks selected (available: ${all.map((task) => task.id).join(', ')})`);

  const plan = {
    model: args.model,
    thinking: args.thinking,
    repeat: args.repeat,
    extensions: args.extensions,
    tasks: tasks.map((task) => ({ id: task.id, fixture: task.fixture, gate: task.gate })),
  };
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  const workRoot = resolve(args.workRoot);
  mkdirSync(workRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const runs: RunResult[] = [];

  for (let runIndex = 1; runIndex <= args.repeat; runIndex += 1) {
    for (const task of tasks) {
      process.stderr.write(`[${args.label}] run ${runIndex}/${args.repeat} · ${task.id} … `);
      const result = await runTask(task, {
        model: args.model,
        thinking: args.thinking,
        extensions: args.extensions,
        workRoot,
        label: args.label,
        runIndex,
        timeoutSec: args.timeoutSec,
        keep: args.keep,
      });
      runs.push(result);
      process.stderr.write(
        `${result.success ? 'PASS' : 'FAIL'} · ${result.metrics.turns} turns · ${(result.durationMs / 1000).toFixed(1)}s\n`,
      );
    }
  }

  const report = buildReport({
    label: args.label,
    model: args.model,
    thinking: args.thinking,
    startedAt,
    runs,
  });
  const baseline = args.baseline
    ? (JSON.parse(readFileSync(args.baseline, 'utf8')) as Report)
    : undefined;
  const markdown = renderMarkdown(report, baseline);
  process.stdout.write(`${markdown}\n`);

  const outPath = args.out ?? resolve(workRoot, `eval-${args.label}-${Date.now()}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  const markdownPath = outPath.replace(/\.json$/, '.md');
  writeFileSync(markdownPath, `${markdown}\n`);
  process.stderr.write(`\nreport: ${outPath}\nmarkdown: ${markdownPath}\n`);

  const failed = report.overall.passRate < 1;
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => {
  process.stderr.write(`eval failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
