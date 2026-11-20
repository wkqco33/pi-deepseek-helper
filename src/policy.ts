import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Feature switches. A single `PI_FLASH_BOOST=0` disables every feature. */
export interface BoostConfig {
  gate: boolean;
  distill: boolean;
  router: boolean;
  logPath?: string;
  distillMaxChars: number;
  gateVerifyTools: RegExp;
  gateVerifyCommands: RegExp;
}

function enabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(value.toLowerCase());
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Tool names a helper extension exposes for verification. The pattern is
 * intentionally broad: a false positive only weakens the gate, while a false
 * negative makes it nag a model that already verified its work.
 */
const DEFAULT_VERIFY_TOOLS =
  /(_test|_check|_build|validation_bundle|tdd_checkpoint|completion_evidence)$/;

/** Shell commands that run a project gate. */
const DEFAULT_VERIFY_COMMANDS =
  /\b(pytest|py\.test|unittest|colcon\s+(build|test)|cargo\s+(test|check|build)|go\s+(test|build|vet)|npm\s+(test|run)|pnpm\s+(test|run)|yarn\s+(test|run)|bun\s+(test|run)|make\b|task\b|ctest|tsc\b|ruff\b|pyright\b|tsx\s+--test|jest|vitest)/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BoostConfig {
  const master = enabled(env['PI_FLASH_BOOST'], true);
  return {
    gate: master && enabled(env['PI_FLASH_GATE'], true),
    distill: master && enabled(env['PI_FLASH_DISTILL'], true),
    router: master && enabled(env['PI_FLASH_ROUTER'], true),
    logPath: env['PI_FLASH_LOG'],
    distillMaxChars: positiveInt(env['PI_FLASH_DISTILL_MAX_CHARS'], 6000),
    gateVerifyTools: DEFAULT_VERIFY_TOOLS,
    gateVerifyCommands: DEFAULT_VERIFY_COMMANDS,
  };
}

export interface BoostEvent {
  feature: 'gate' | 'distill' | 'router';
  action: string;
  [key: string]: unknown;
}

/**
 * Appends one JSONL record to `PI_FLASH_LOG`.
 *
 * Logging is opt-in and best-effort: an evaluation counts these records, and a
 * write failure must never break the agent run that produced it.
 */
export function logEvent(event: BoostEvent): void {
  const path = process.env['PI_FLASH_LOG'];
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  } catch {
    // Diagnostics must not interfere with the agent loop.
  }
}

export function readEnvFlag(name: string, fallback: boolean): boolean {
  return enabled(process.env[name], fallback);
}
