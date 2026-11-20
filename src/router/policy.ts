/**
 * Routing rules for a flash-first workflow.
 *
 * The primary model keeps the cheap path. A stronger model takes over only when
 * the cheap one is demonstrably stuck: a provider-level retry failure, or a
 * cluster of failing tool calls at the tail of the conversation.
 */

export interface RouterState {
  escalated: boolean;
  /** Consecutive-failure count observed when the escalation started. */
  at?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolResult(message: Record<string, unknown>): boolean {
  const role = message['role'];
  return role === 'toolResult' || role === 'tool' || role === 'tool_result';
}

export interface ToolErrorWindow {
  /** Failing tool results since the last user message. */
  errors: number;
  /** Whether the most recent tool result in this turn is an error. */
  lastIsError: boolean;
  /** Whether this turn produced any tool result at all. */
  sawTool: boolean;
}

/**
 * Summarizes tool failures inside the current user turn.
 *
 * Counting runs back to the last user message and skips assistant messages on
 * the way, because a failed tool call is always followed by an assistant turn
 * before the next call: a strictly trailing scan can therefore never see two
 * failures. Older turns are ignored, so a failure the user already moved past
 * cannot escalate a fresh request.
 */
export function toolErrorWindow(messages: readonly unknown[]): ToolErrorWindow {
  const window: ToolErrorWindow = { errors: 0, lastIsError: false, sawTool: false };
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message)) break;
    if (message['role'] === 'user') break;
    if (!isToolResult(message)) continue;
    const isError = message['isError'] === true;
    if (!window.sawTool) {
      window.lastIsError = isError;
      window.sawTool = true;
    }
    if (isError) window.errors += 1;
  }
  return window;
}

export interface EscalationInput {
  window: ToolErrorWindow;
  threshold: number;
  retryFailed: boolean;
  state: RouterState;
}

export interface EscalationDecision {
  escalate: boolean;
  state: RouterState;
  reason: 'retry' | 'tool-failures' | 'sticky' | 'recovered' | 'none';
}

/**
 * Decides whether this request goes to the escalation model.
 *
 * Escalation is sticky until a successful tool result appears; flipping back on
 * the very next request would lose the stronger model's context and the prompt
 * cache for a single cheap turn.
 */
export function decideEscalation(input: EscalationInput): EscalationDecision {
  const { window, threshold, retryFailed, state } = input;

  if (retryFailed) {
    return { escalate: true, state: { escalated: true, at: window.errors }, reason: 'retry' };
  }
  // A successful tool result means the cheap model recovered on its own; staying
  // escalated would pay the strong model for work the flash model already did.
  if (window.sawTool && !window.lastIsError) {
    return { escalate: false, state: { escalated: false }, reason: 'recovered' };
  }
  if (window.errors >= threshold) {
    return {
      escalate: true,
      state: { escalated: true, at: window.errors },
      reason: state.escalated ? 'sticky' : 'tool-failures',
    };
  }
  return { escalate: false, state: { escalated: false }, reason: 'none' };
}

export function escalationCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env['PI_FLASH_ESCALATE_MODELS'];
  if (configured !== undefined && configured.trim() !== '') {
    return configured
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
  }
  return ['glm-5.3:cloud', 'kimi-k3.1-pro:cloud'];
}
