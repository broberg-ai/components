/**
 * Browser side: count a feature that only lives in the browser.
 *
 *   trackFeature('export.pdf', { endpoint: '/api/feature-stats' });
 *
 * Sends `{"feature":"…"}` and nothing else. It stores nothing on the device
 * and reads nothing from it — no cookie, no storage, no identifier — which is
 * why it needs no consent prompt. [Same reasoning as @broberg/device-stats
 * Tier 0; not legal advice.] It never throws: counting a click must not be
 * able to break the click.
 */
export interface TrackFeatureOptions {
  endpoint: string;
  /** A failure to send is reported here, never thrown. */
  onError?: (err: unknown) => void;
}

export function trackFeature(feature: string, opts: TrackFeatureOptions): void {
  try {
    const body = JSON.stringify({ feature });
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    if (nav && typeof nav.sendBeacon === 'function') {
      // text/plain keeps it a CORS "simple" request; the server parses the text.
      if (nav.sendBeacon(opts.endpoint, new Blob([body], { type: 'text/plain' }))) return;
    }
    if (typeof fetch === 'function') {
      fetch(opts.endpoint, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(
        (err: unknown) => opts.onError?.(err),
      );
    }
  } catch (err) {
    // Reported, never thrown: see the module comment.
    opts.onError?.(err);
  }
}
