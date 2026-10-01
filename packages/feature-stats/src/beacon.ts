/**
 * The one parser both server bindings share, so /hono and /next cannot
 * disagree about what a beacon is. Body: `{"feature":"<declared key>"}`.
 * Anything else — bad JSON, an undeclared key, an oversized body — is 400 and
 * records nothing.
 */
import type { FeatureStats } from './index.js';

/** A beacon is a few dozen bytes; anything larger is not one. */
export const MAX_BEACON_BYTES = 1024;

export async function handleBeacon(stats: FeatureStats<string>, bodyText: string): Promise<number> {
  if (bodyText.length > MAX_BEACON_BYTES) return 400;
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return 400;
  }
  const feature = (body as { feature?: unknown } | null)?.feature;
  return stats.trackUnknown(feature) ? 204 : 400;
}
