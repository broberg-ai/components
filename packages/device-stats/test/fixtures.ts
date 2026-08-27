// AUTO-DERIVED FIXTURES — do not hand-edit the `ua` strings.
//
// AC#2 requires REAL User-Agent strings, not invented ones, WITH provenance.
// A table tested against strings the author made up tests the author's idea
// of the format. Every entry below records where it came from.
//
// PROVENANCE A — playwright-core@1.61.1
//   lib/server/deviceDescriptorsSource.json (207 descriptors), read from this
//   repo's own node_modules (a dependency of @broberg/lens-engine). Playwright
//   harvests these from real devices and versions them with the release.
//   Regenerate: node scripts/regen-fixtures.mjs
//
// PROVENANCE B — vendor-documented FORMAT, not a captured string.
//   Playwright's registry contains no Samsung Internet, no iOS Chrome (CriOS)
//   and no UA-Reduction sentinel, so these three come from the vendors' own
//   published format documentation. WEAKER EVIDENCE THAN A, and labelled so:
//   they prove we handle the documented shape, not that we matched real traffic.

export interface UaFixture {
  readonly label: string;
  readonly ua: string;
  readonly provenance: "playwright-1.61.1" | "vendor-documented";
  readonly expect: {
    formFactor: "desktop" | "mobile" | "tablet";
    osFamily: string;
    osMajor: number | "unknown";
    browserFamily: string;
  };
}

export const UA_FIXTURES: readonly UaFixture[] = [
  { label: "iPhone 15", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
    expect: { formFactor: "mobile", osFamily: "iOS", osMajor: 17, browserFamily: "Safari" } },
  { label: "iPhone 14", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
    expect: { formFactor: "mobile", osFamily: "iOS", osMajor: 16, browserFamily: "Safari" } },
  { label: "iPhone 12", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
    expect: { formFactor: "mobile", osFamily: "iOS", osMajor: 14, browserFamily: "Safari" } },
  { label: "iPhone SE", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/26.5 Mobile/14E304 Safari/602.1",
    expect: { formFactor: "mobile", osFamily: "iOS", osMajor: 10, browserFamily: "Safari" } },
  { label: "iPad Pro 11", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
    expect: { formFactor: "tablet", osFamily: "iOS", osMajor: 12, browserFamily: "Safari" } },
  { label: "iPad (gen 7)", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
    expect: { formFactor: "tablet", osFamily: "iOS", osMajor: 12, browserFamily: "Safari" } },
  { label: "Pixel 7", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Mobile Safari/537.36",
    expect: { formFactor: "mobile", osFamily: "Android", osMajor: 14, browserFamily: "Chrome" } },
  { label: "Pixel 5", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Mobile Safari/537.36",
    expect: { formFactor: "mobile", osFamily: "Android", osMajor: 11, browserFamily: "Chrome" } },
  { label: "Galaxy S24", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Mobile Safari/537.36",
    expect: { formFactor: "mobile", osFamily: "Android", osMajor: 14, browserFamily: "Chrome" } },
  { label: "Galaxy S9+", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Linux; Android 8.0.0; SM-G965U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Mobile Safari/537.36",
    expect: { formFactor: "mobile", osFamily: "Android", osMajor: 8, browserFamily: "Chrome" } },
  { label: "Moto G4", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Linux; Android 7.0; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Mobile Safari/537.36",
    expect: { formFactor: "mobile", osFamily: "Android", osMajor: 7, browserFamily: "Chrome" } },
  { label: "Galaxy Tab S4", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Linux; Android 8.1.0; SM-T837A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36",
    expect: { formFactor: "tablet", osFamily: "Android", osMajor: 8, browserFamily: "Chrome" } },
  { label: "Nexus 10", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 10 Build/MOB31T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36",
    expect: { formFactor: "tablet", osFamily: "Android", osMajor: 6, browserFamily: "Chrome" } },
  { label: "Desktop Chrome", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36",
    expect: { formFactor: "desktop", osFamily: "Windows", osMajor: "unknown", browserFamily: "Chrome" } },
  { label: "Desktop Edge", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36 Edg/149.0.7827.55",
    expect: { formFactor: "desktop", osFamily: "Windows", osMajor: "unknown", browserFamily: "Edge" } },
  { label: "Desktop Firefox", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0",
    expect: { formFactor: "desktop", osFamily: "Windows", osMajor: "unknown", browserFamily: "Firefox" } },
  { label: "Desktop Safari", provenance: "playwright-1.61.1",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
    expect: { formFactor: "desktop", osFamily: "macOS", osMajor: "unknown", browserFamily: "Safari" } },

  // ---- PROVENANCE B: vendor-documented formats (see header) ----

  // Chrome UA Reduction. Chrome sends this EXACT sentinel on every Android
  // device regardless of what it actually runs: version pinned to "10", model
  // pinned to "K". It parses cleanly to 10 and that 10 is a fiction — which is
  // why osMajor must be "unknown" here and not a plausible number.
  { label: "Android Chrome (UA-reduced sentinel)", provenance: "vendor-documented",
    ua: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    expect: { formFactor: "mobile", osFamily: "Android", osMajor: "unknown", browserFamily: "Chrome" } },

  // Samsung Internet. Its UA carries BOTH SamsungBrowser AND Chrome, so it is
  // mislabelled as Chrome unless the more specific token is matched first.
  { label: "Samsung Internet (Android)", provenance: "vendor-documented",
    ua: "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
    expect: { formFactor: "mobile", osFamily: "Android", osMajor: 13, browserFamily: "Samsung Internet" } },

  // Chrome on iOS is WebKit underneath and identifies as CriOS. It also carries
  // "Version/" + "Safari", so Safari wins unless CriOS is matched first.
  { label: "Chrome on iOS (CriOS)", provenance: "vendor-documented",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.108 Mobile/15E148 Safari/604.1",
    expect: { formFactor: "mobile", osFamily: "iOS", osMajor: 17, browserFamily: "Chrome" } },
] as const;
