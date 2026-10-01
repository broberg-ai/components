/**
 * Stack B binding: a POST handler for browser beacons.
 *
 *   app.post('/api/feature-stats', featureStatsRoute(stats));
 *
 * 204 when counted, 400 (nothing counted) for bad JSON or an undeclared key.
 * No cookie, no identifier, nothing read from the request but its body.
 */
import type { Context } from 'hono';
import type { FeatureStats } from './index.js';
import { handleBeacon } from './beacon.js';

export function featureStatsRoute<F extends string>(stats: FeatureStats<F>) {
  return async (c: Context): Promise<Response> => {
    const status = await handleBeacon(stats as FeatureStats<string>, await c.req.text());
    return c.body(null, status as 204 | 400);
  };
}
