import type { BoostConfig } from '../policy.ts';

export type ToolRole = 'edit' | 'verify' | 'other';

const EDIT_TOOLS = new Set(['write', 'edit', 'apply_patch']);

function commandOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const command = (input as Record<string, unknown>)['command'];
  return typeof command === 'string' ? command : '';
}

/**
 * Classifies a tool call as an edit, a verification run, or neither.
 *
 * Only tool names are trusted for edits: a `bash` command that happens to write
 * a file is not counted, because guessing at shell mutation is how a gate
 * starts nagging about work that was never done.
 */
export function classifyTool(toolName: string, input: unknown, config: BoostConfig): ToolRole {
  if (EDIT_TOOLS.has(toolName)) return 'edit';
  if (config.gateVerifyTools.test(toolName)) return 'verify';
  if (toolName === 'bash' && config.gateVerifyCommands.test(commandOf(input))) return 'verify';
  return 'other';
}

export function editedPath(toolName: string, input: unknown): string | undefined {
  if (!EDIT_TOOLS.has(toolName)) return undefined;
  if (typeof input !== 'object' || input === null) return undefined;
  const path = (input as Record<string, unknown>)['path'];
  return typeof path === 'string' && path !== '' ? path : undefined;
}

export interface GateState {
  edited: Set<string>;
  /** Timestamp of the last successful edit in this run. */
  lastEditAt: number;
  /** Timestamp of the last successful verification run in this run. */
  lastVerifyAt: number;
  fired: boolean;
}

export function newGateState(): GateState {
  return { edited: new Set(), lastEditAt: 0, lastVerifyAt: 0, fired: false };
}

export interface GateDecision {
  fire: boolean;
  reason?: string;
  suggestedCommand?: string;
}

export interface GateInput {
  state: GateState;
  aborted: boolean;
}

/**
 * Decides whether the run ended with unverified edits.
 *
 * The gate fires at most once per run and only when an edit landed after the
 * last verification, so a model that already ran its gate is never nagged.
 */
export function decideGate(input: GateInput): GateDecision {
  const { state, aborted } = input;
  if (aborted) return { fire: false, reason: 'aborted' };
  if (state.fired) return { fire: false, reason: 'already-fired' };
  if (state.edited.size === 0) return { fire: false, reason: 'no-edits' };
  if (state.lastVerifyAt >= state.lastEditAt) return { fire: false, reason: 'verified' };
  return { fire: true, reason: 'unverified-edits' };
}

export function gateMessage(edited: readonly string[], suggestedCommand?: string): string {
  const files = edited.slice(0, 5).join(', ');
  const hint = suggestedCommand
    ? `Run \`${suggestedCommand}\``
    : 'Run the project verification gate (tests, type check, or build)';
  return [
    `Verification gate: this run edited ${files} but did not run a verification command after the last edit.`,
    `${hint} now, or explain in one line why it cannot run here.`,
    'Do not repeat the work; only verify.',
  ].join(' ');
}
