import type { RunResult } from './run.ts';

export interface TaskSummary {
  taskId: string;
  attempts: number;
  successes: number;
  passRate: number;
  avgTurns: number;
  avgToolCalls: number;
  avgFailedToolCalls: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgDurationMs: number;
  totalCostUsd: number;
  gateFires: number;
  distillTrims: number;
  escalations: number;
}

export interface Report {
  label: string;
  model: string;
  thinking: string;
  startedAt: string;
  completedAt: string;
  tasks: TaskSummary[];
  overall: TaskSummary;
  runs: RunResult[];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarize(taskId: string, runs: readonly RunResult[]): TaskSummary {
  const successes = runs.filter((run) => run.success).length;
  return {
    taskId,
    attempts: runs.length,
    successes,
    passRate: runs.length === 0 ? 0 : successes / runs.length,
    avgTurns: mean(runs.map((run) => run.metrics.turns)),
    avgToolCalls: mean(runs.map((run) => run.metrics.toolCalls)),
    avgFailedToolCalls: mean(runs.map((run) => run.metrics.failedToolCalls)),
    avgInputTokens: mean(runs.map((run) => run.metrics.inputTokens)),
    avgOutputTokens: mean(runs.map((run) => run.metrics.outputTokens)),
    avgDurationMs: mean(runs.map((run) => run.durationMs)),
    totalCostUsd: runs.reduce((sum, run) => sum + run.metrics.costUsd, 0),
    gateFires: runs.reduce((sum, run) => sum + run.extensionEvents.gateFire, 0),
    distillTrims: runs.reduce((sum, run) => sum + run.extensionEvents.distillTrim, 0),
    escalations: runs.reduce((sum, run) => sum + run.extensionEvents.escalate, 0),
  };
}

export function buildReport(input: {
  label: string;
  model: string;
  thinking: string;
  startedAt: string;
  runs: readonly RunResult[];
}): Report {
  const byTask = new Map<string, RunResult[]>();
  for (const run of input.runs) {
    const bucket = byTask.get(run.taskId) ?? [];
    bucket.push(run);
    byTask.set(run.taskId, bucket);
  }
  const tasks = [...byTask.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, runs]) => summarize(id, runs));
  return {
    label: input.label,
    model: input.model,
    thinking: input.thinking,
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
    tasks,
    overall: summarize('overall', input.runs),
    runs: [...input.runs],
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function sec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function tokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0);
}

function signed(value: number, digits = 1, unit = ''): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}${unit}`;
}

export function renderMarkdown(report: Report, baseline?: Report): string {
  const lines: string[] = [];
  lines.push(`# pi-flash-boost eval — ${report.label}`);
  lines.push('');
  lines.push(
    `model: \`${report.model}\` · thinking: ${report.thinking} · ${report.startedAt} → ${report.completedAt}`,
  );
  lines.push('');
  lines.push(
    '| task | pass | turns | tools | failed tools | in tok | out tok | wall | gate | distill | escalate |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const row = (summary: TaskSummary, name: string): string =>
    `| ${name} | ${summary.successes}/${summary.attempts} (${pct(summary.passRate)}) | ${summary.avgTurns.toFixed(1)} | ${summary.avgToolCalls.toFixed(1)} | ${summary.avgFailedToolCalls.toFixed(1)} | ${tokens(summary.avgInputTokens)} | ${tokens(summary.avgOutputTokens)} | ${sec(summary.avgDurationMs)} | ${summary.gateFires} | ${summary.distillTrims} | ${summary.escalations} |`;
  for (const task of report.tasks) lines.push(row(task, task.taskId));
  lines.push(row(report.overall, '**overall**'));

  if (baseline) {
    lines.push('');
    lines.push(`## Delta vs ${baseline.label}`);
    lines.push('');
    lines.push('| metric | baseline | current | delta |');
    lines.push('| --- | --- | --- | --- |');
    const current = report.overall;
    const base = baseline.overall;
    lines.push(
      `| pass rate | ${pct(base.passRate)} | ${pct(current.passRate)} | ${signed((current.passRate - base.passRate) * 100, 0, 'pp')} |`,
    );
    lines.push(
      `| turns | ${base.avgTurns.toFixed(1)} | ${current.avgTurns.toFixed(1)} | ${signed(current.avgTurns - base.avgTurns)} |`,
    );
    lines.push(
      `| tool calls | ${base.avgToolCalls.toFixed(1)} | ${current.avgToolCalls.toFixed(1)} | ${signed(current.avgToolCalls - base.avgToolCalls)} |`,
    );
    lines.push(
      `| failed tool calls | ${base.avgFailedToolCalls.toFixed(1)} | ${current.avgFailedToolCalls.toFixed(1)} | ${signed(current.avgFailedToolCalls - base.avgFailedToolCalls)} |`,
    );
    lines.push(
      `| input tokens | ${tokens(base.avgInputTokens)} | ${tokens(current.avgInputTokens)} | ${signed(current.avgInputTokens - base.avgInputTokens, 0)} |`,
    );
    lines.push(
      `| wall clock | ${sec(base.avgDurationMs)} | ${sec(current.avgDurationMs)} | ${signed((current.avgDurationMs - base.avgDurationMs) / 1000, 1, 's')} |`,
    );
    const baseExt = {
      gateFires: base.gateFires ?? 0,
      distillTrims: base.distillTrims ?? 0,
      escalations: base.escalations ?? 0,
    };
    lines.push(
      `| gate fires | ${baseExt.gateFires} | ${current.gateFires} | ${signed(current.gateFires - baseExt.gateFires, 0)} |`,
    );
    lines.push(
      `| distill trims | ${baseExt.distillTrims} | ${current.distillTrims} | ${signed(current.distillTrims - baseExt.distillTrims, 0)} |`,
    );
    lines.push(
      `| escalations | ${baseExt.escalations} | ${current.escalations} | ${signed(current.escalations - baseExt.escalations, 0)} |`,
    );
  }

  const failures = report.runs.filter((run) => !run.success);
  if (failures.length > 0) {
    lines.push('');
    lines.push('## Failures');
    lines.push('');
    for (const failure of failures) {
      lines.push(
        `- ${failure.taskId} #${failure.runIndex}: gate exit ${String(failure.gate.exitCode)}${failure.gate.timedOut ? ' (timeout)' : ''}${failure.metrics.errors.length > 0 ? ` — ${failure.metrics.errors[0]}` : ''}`,
      );
    }
  }
  return lines.join('\n');
}
