import {
  decideEscalation,
  escalationCandidates,
  toolErrorWindow,
  type RouterState,
} from '../src/router/policy.ts';
import { loadConfig, logEvent } from '../src/policy.ts';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const DEFAULT_PRIMARY = 'deepseek-v4.1-flash:1017-cloud';
const DEFAULT_THRESHOLD = 2;

/**
 * Escalation router.
 *
 * Select `ollama/flash-boost` to keep the flash model on the cheap path and hand
 * the conversation to a stronger model only when the flash model is stuck: a
 * retry after a provider failure, or two or more failing tool calls in a row.
 */
export default function routerExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  if (!config.router) return;

  const primaryId = process.env['PI_FLASH_PRIMARY'] ?? DEFAULT_PRIMARY;
  const threshold =
    Number.parseInt(process.env['PI_FLASH_ESCALATE_AFTER'] ?? '', 10) || DEFAULT_THRESHOLD;
  const candidates = escalationCandidates();

  pi.registerVirtualModel<RouterState>({
    provider: 'ollama',
    id: 'flash-boost',
    name: 'Flash Boost',
    thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
    route(request, ctx) {
      const available = ctx.modelRegistry.getAvailable();
      const primary = available.find((model) => model.id === primaryId);
      if (primary === undefined) {
        throw new Error(
          `flash-boost: primary model ollama/${primaryId} is not configured (set PI_FLASH_PRIMARY to override)`,
        );
      }

      const retryFailed = request.reason === 'retry' && request.failed !== undefined;
      const window = toolErrorWindow(request.messages as readonly unknown[]);
      const decision = decideEscalation({
        window,
        threshold,
        retryFailed,
        state: request.state ?? { escalated: false },
      });
      logEvent({
        feature: 'router',
        action: 'route',
        reason: request.reason,
        errors: window.errors,
        lastIsError: window.lastIsError,
        escalate: decision.escalate,
      });

      if (!decision.escalate) {
        return { model: primary, thinkingLevel: request.thinkingLevel, state: decision.state };
      }

      let escalated = undefined as (typeof available)[number] | undefined;
      for (const candidate of candidates) {
        escalated = available.find((model) => model.id === candidate);
        if (escalated !== undefined) break;
      }
      if (escalated === undefined) {
        logEvent({
          feature: 'router',
          action: 'no-escalation-model',
          candidates,
          reason: decision.reason,
          errors: window.errors,
        });
        return {
          model: primary,
          thinkingLevel: request.thinkingLevel,
          state: { escalated: false },
        };
      }

      logEvent({
        feature: 'router',
        action: 'escalate',
        to: escalated.id,
        reason: decision.reason,
        errors: window.errors,
      });
      return { model: escalated, thinkingLevel: request.thinkingLevel, state: decision.state };
    },
  });
}
