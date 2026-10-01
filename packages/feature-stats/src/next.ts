/**
 * Stack A binding: an App Router POST route handler for browser beacons.
 *
 *   // app/api/feature-stats/route.ts
 *   export const POST = featureStatsHandler(stats);
 *
 * Plain Web Request/Response — nothing imported from `next`.
 */
import type { FeatureStats } from './index.js';
import { handleBeacon } from './beacon.js';

export function featureStatsHandler<F extends string>(stats: FeatureStats<F>) {
  return async (req: Request): Promise<Response> => {
    const status = await handleBeacon(stats as FeatureStats<string>, await req.text());
    return new Response(null, { status });
  };
}
