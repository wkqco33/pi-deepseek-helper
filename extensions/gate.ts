import { logEvent, loadConfig } from '../src/policy.ts';
import {
  classifyTool,
  decideGate,
  editedPath,
  gateMessage,
  newGateState,
} from '../src/gate/policy.ts';
import { suggestGateCommand } from '../src/gate/detect.ts';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Verification gate.
 *
 * A flash-tier model frequently ends a run with "done" after editing files and
 * never running the gate. This extension makes that specific ending cost one
 * more turn: the run is continued with an instruction to verify, once.
 */
export default function gateExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  if (!config.gate) return;

  let state = newGateState();

  const recordToolOutcome = (toolName: string, input: unknown, isError: boolean): void => {
    if (isError) return;
    const role = classifyTool(toolName, input, config);
    if (role === 'edit') {
      const path = editedPath(toolName, input) ?? toolName;
      state.edited.add(path);
      state.lastEditAt = Date.now();
      return;
    }
    if (role === 'verify') state.lastVerifyAt = Date.now();
  };

  pi.on('before_agent_start', () => {
    state = newGateState();
  });

  pi.on('tool_result', (event) => {
    recordToolOutcome(event.toolName, event.input, event.isError === true);
  });

  pi.on('agent_before_settle', async (event, ctx) => {
    // Esc leaves the transcript mid-run; continuing with a verification request
    // would override what the user just asked for.
    const aborted = ctx.signal?.aborted === true;

    // A run can end without any tool_result (a plain answer), which leaves the
    // state clean and the gate silent by construction.
    const decision = decideGate({ state, aborted });
    if (!decision.fire) {
      logEvent({
        feature: 'gate',
        action: 'skip',
        reason: decision.reason,
        edits: state.edited.size,
      });
      return;
    }

    state.fired = true;
    const suggested = decision.suggestedCommand ?? suggestGateCommand(ctx.cwd);
    logEvent({
      feature: 'gate',
      action: 'fire',
      reason: decision.reason,
      edits: [...state.edited],
      suggested,
    });

    return {
      entries: [
        ...event.entries,
        {
          type: 'custom_message' as const,
          customType: 'flash-gate',
          content: gateMessage([...state.edited], suggested),
          display: true,
        },
      ],
      continue: true,
    };
  });
}
