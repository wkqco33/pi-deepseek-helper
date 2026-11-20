import gateExtension from './gate.ts';
import distillExtension from './distill.ts';
import routerExtension from './router.ts';
import { loadConfig } from '../src/policy.ts';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * pi-flash-boost.
 *
 * Three independent compensations for flash-tier weaknesses: a verification
 * gate that turns an unverified "done" into one more turn, bounded tool output
 * so a long log cannot bury the failure, and an opt-in escalation router that
 * keeps the cheap model until it is demonstrably stuck.
 *
 * Each feature is separately switchable: PI_FLASH_GATE, PI_FLASH_DISTILL,
 * PI_FLASH_ROUTER, and PI_FLASH_BOOST=0 turns everything off.
 */
export default function flashBoost(pi: ExtensionAPI): void {
  const config = loadConfig();
  gateExtension(pi);
  distillExtension(pi);
  routerExtension(pi);

  pi.registerCommand('flash-boost', {
    description: 'Show which flash-boost features are active',
    handler: async (_args, ctx) => {
      const state = [
        `gate=${config.gate ? 'on' : 'off'}`,
        `distill=${config.distill ? `on (${config.distillMaxChars} chars)` : 'off'}`,
        `router=${config.router ? 'on' : 'off'}`,
      ].join(' · ');
      const active = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : 'none';
      ctx.ui.notify(`flash-boost: ${state} · model ${active}`, 'info');
    },
  });
}
