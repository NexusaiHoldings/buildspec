/**
 * Substrate EventBus adapter — implements @nexus/identity-and-access's
 * EventBus interface (and any other lego that emits events).
 *
 * Sprint substrate-auth-routes-001 (2026-05-21).
 *
 * Phase 1: no-op implementation. Logs to console + swallows. Phase 2 will
 * route to portfolio-runtime's NATS publish endpoint once that's wired
 * (per NEXUS_PORTFOLIO_RUNTIME_SPEC §5).
 */

import type { EventBus } from "@nexus/identity-and-access/api/_lib/events";

/**
 * Build the substrate's EventBus. Phase 1 is a logging-only no-op so
 * lego handlers can run without a NATS dependency.
 */
export function buildEventBus(): EventBus {
  return {
    async publish(
      subject: string,
      payload: Record<string, unknown>,
    ): Promise<void> {
      // Phase 1: log + swallow. Phase 2 wires to portfolio-runtime NATS.
      // eslint-disable-next-line no-console
      console.log(`[event] ${subject}`, JSON.stringify(payload).slice(0, 500));
    },
  };
}
