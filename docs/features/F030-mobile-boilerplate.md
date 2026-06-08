# F030 — Native Mobile Boilerplate (Capacitor)

> L4 Capstone · hybrid · effort **L** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: YES — should get its own repo + cardmem project (recommendation, confirm with Christian).

## Motivation
A scaffold that wraps any existing web app (Next.js or Vite/Preact) in a Capacitor 8 native shell for iOS + Android. It provides a headless bridge module covering platform detection, splash screen, status bar, push notifications (two-phase token registration), badge count sync, deep-link routing, biometric credential storage, and Android back-button handling — all as safe no-ops in browser. On top sits a copy-owned UI layer: the native Capacitor initializer, iOS-style swipe-back NavigationStack, pull-to-refresh hook, sim dev-login scripts, and Fastlane lanes for TestFlight + Google Play.

## Solution
**hybrid.** The bridge module (platform detection, two-phase push registration, biometric, badge, splash/status-bar, deep-link listener) is nearly identical across cms-mobile + fysiodk — only the server-registration endpoint + BIOMETRIC_SERVER differ → runtime package. Everything else (CapacitorInit, NavigationStack, pull-to-refresh, boot scripts, Fastlane lanes, capacitor.config.ts) is app-specific skeleton → copy-owned scaffold. A copy-owned-only scaffold would lose sync on the provably-shared bridge primitives. Hence hybrid: @broberg/capacitor-bridge package + scaffold template.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-mobile/` (bridge.ts, prefs.ts, permissions.ts, use-pull-to-refresh.ts, NavigationStack.tsx, capacitor.config.ts, main.tsx, vite.config.ts, scripts/{ios-boot,sim-login,preflight-release}).
- Headless @broberg/capacitor-bridge + Stack A/B scaffold templates + Fastlane lanes (from fysiodk).

### Out of scope
- Per-brand UI styling (scaffold, copy-owned).
- App-specific push register endpoint / biometric server (caller params).

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-mobile/`: most complete — bundled mode (webDir=dist, no server.url), CapacitorHttp native fetch (WKWebView CORS bypass), two-phase push (localStorage pending-token + 15s poll), biometric JWT storage, multi-server prefs + legacy-key migration, pull-to-refresh via TanStack Query invalidation, iOS swipe-back NavigationStack (framer-motion parallax), sim-login.mjs, preflight-release ATS gate. (fysiodk has the Fastlane lanes cms-mobile lacks — those go in the scaffold.)

### Other implementations seen
- `webhouse/fysiodk-aalborg-sport` `apps/web/src/lib/capacitor-bridge.ts` + `capacitor.config.ts` + `components/capacitor-init.tsx` + `ios/App/fastlane/Fastfile` + `android/fastlane/Fastfile` — remote-URL mode (server.url at prod host) vs cms's bundled mode (two valid config patterns); fuller push/badge/biometric/Apple-Sign-In/lifecycle; full iOS (beta/release/appstore/submit) + Android (internal/beta/promote/production) Fastlane lanes with Discord webhooks.

### Headless core vs. adapters
- **Core (@broberg/capacitor-bridge, no React):** isNative/platform/isIOS/isAndroid; initCapacitor(); hideSplash/setStatusBarStyle/Color; initAppLifecycle(onDeepLink,onBackButton,onStateChange) (appUrlOpen for Universal Links + custom-scheme); setupPushListeners(onTokenReady,...) (permission + listeners + pending token to caller-supplied localStorage key); registerPendingPushToken(registerFn) (polls 15s then calls caller's async registration); setBadgeCount/clearBadge; storeBiometricCredential/unlockBiometricCredential/deleteBiometricCredential; PreferencesStore (get/set/remove + legacy-key migration). The pending-token localStorage + two-phase push split are the stable contract both repos converged on.
- **Stack A (Next/React/shadcn):** copy-owned scaffold: capacitor.config.ts (bundled webDir=out or remote server.url), CapacitorInit ('use client', initCapacitor + platform CSS classes), useCapacitorLifecycle, NavigationStack (framer-motion swipe-back), usePullToRefresh (TanStack Query invalidate), Fastlane ios/android lanes + Discord, boot + preflight scripts.
- **Stack B (Bun/Hono/Preact/Vite):** copy-owned scaffold: capacitor.config.ts (webDir=dist), CapacitorInit (Preact, no 'use client'), usePullToRefresh (Preact useEffect), NavigationStack (Preact, same framer-motion), vite.config.ts (outDir=dist, es2022). No next/*; Fastlane + boot scripts identical (native layer).

### Public API
```ts
export { isNative, platform, isIOS, isAndroid, initCapacitor, hideSplash, setStatusBarStyle, setStatusBarColor, initAppLifecycle, setupPushListeners, registerPendingPushToken, setBadgeCount, clearBadge, storeBiometricCredential, unlockBiometricCredential, deleteBiometricCredential, PreferencesStore };
// scaffold template (copy-owned): capacitor.config.ts, CapacitorInit, NavigationStack, use-pull-to-refresh, ios/android boot + preflight scripts, Fastlane Fastfiles
```

## Stories
- **F030.1** — Extract @broberg/capacitor-bridge package — _AC:_ exports the full bridge surface; no React imports anywhere; all functions browser-safe no-ops; tests cover platform() mocking + pending-token localStorage round-trip.
- **F030.2** — Adopt bridge package in cms-mobile — _AC:_ cms-mobile bridge.ts + prefs.ts replaced by package imports; pnpm build succeeds; iOS sim boots via ./scripts/ios-boot.sh; sim-login.mjs lands on Home; push token registration completes in the console log.
- **F030.3** — Adopt bridge package in fysiodk — _AC:_ fysiodk capacitor-bridge.ts replaced by package; biometric flow mapped to unlock/storeBiometricCredential; iOS + Android sims still boot; Fastlane beta lane succeeds on dry-run.
- **F030.4** — Create mobile scaffold template (bundled mode) — _AC:_ packages/mobile-scaffold/ with capacitor.config.ts (TODO appId/appName/webDir), CapacitorInit (React + Preact variants), NavigationStack, usePullToRefresh, ios/android-boot + preflight scripts, vite.config preset; a test instantiation with a dummy appId produces a working iOS sim build.
- **F030.5** — Add Fastlane lanes to scaffold template — _AC:_ ios/android Fastfile from fysiodk; app id/scheme/bundle/Discord webhook parameterised via .env.local; fastlane beta (iOS dry-run) + internal (Android dry-run) pass without error when FASTLANE_API_KEY_PATH unset (graceful api_key_if_available fallback).
- **F030.6** — Document bundled-vs-remote config variants — _AC:_ scaffold README explains (a) bundled (no server.url, CapacitorHttp, webDir at output — cms pattern) + (b) remote-URL (server.url at hosted app, iosScheme=capacitor, androidScheme=https — fysiodk pattern); each variant has a named preset file to copy verbatim.

## Acceptance criteria
1. @broberg/mobile-boilerplate builds + typechecks clean; headless core imports no framework packages.
2. Each story (F030.1–F030.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (fysiodk) migrates onto the shared bridge package with identical behaviour.

## Dependencies
- F021 — PWA Setup (blocks). External: @capacitor/{core,app,splash-screen,status-bar,push-notifications,preferences}, @capawesome/capacitor-badge, @capgo/capacitor-native-biometric, framer-motion (scaffold only).

## Rollout
Strangler: 1) extract @broberg/capacitor-bridge from cms-mobile bridge.ts; 2) adopt back in cms-mobile (verify iOS+Android sim); 3) adopt in fysiodk; 4) create scaffold template (parameterise appId/appName/push endpoint/biometric server); 5) bring Fastlane lanes from fysiodk into the scaffold; 6) document the two config variants as named presets; 7) next mobile project scaffolds rather than copies. Then GRADUATE to own repo+project.

Graduate-candidate: YES — should get its own repo + cardmem project (recommendation, confirm with Christian).

## Open Questions
- PreferencesStore expose the cms multi-server pattern (StoredServer array + activeServer + legacy migration) or too cms-specific? (fysiodk uses a single remote URL.)
- sim-login.mjs is tied to the CMS pairing API + JWT forging — generic token-delivery template per consumer, or omit + document xcrun simctl openurl?
- Apple Sign In (nativeAppleSignIn via WKScriptMessageHandler) needs a custom Swift ViewController — scaffold include the Swift side or out of scope for a JS component library?
- cms-mobile has no Fastlane yet; fysiodk has full lanes — cms-mobile adopts Fastlane as part of this work or a separate card?

## Effort estimate
**L** — owner session: `cms`. Reuse model: hybrid.

## Risks
Apple ATS gate (preflight-release.sh, no NSAllowsArbitraryLoads) must be in the scaffold + a release BLOCKER, not a warning. Two-phase push 15s poll is fragile on slow Android — document registerPendingPushToken must run after auth, not at boot. CapacitorHttp CORS bypass routes all fetch through native NSURLSession/OkHttp — a documented security surface. BIOMETRIC_SERVER + push endpoint must be caller-supplied params, not constants. framer-motion in NavigationStack adds ~40KB — bridge-only consumers (no scaffold) shouldn't pay it.