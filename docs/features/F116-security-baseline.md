# F116 — Security gate baseline: 7 blocking findings (sast)

Parent: F427.3 (fleet security gate baseline, cardmem repo: docs/features/F427-fleet-security-gate.md).

## Why
Owner order 20 Nov 2026: «Intet skal ud af huset der ikke er hermetisk lukket». The fleet security gate (security.yml) ran on this repo and is red. This card holds the measured baseline; the repo fixes each finding or acknowledges it.

## Measured
Run: https://github.com/broberg-ai/components/actions/runs/44775776743 (commit 7d9b30c91034bcbf189bac7bb27a8390f8580021, 20 Nov 2026). Gate version of the run is not stated in the log; re-measure after the fix.

### sast (semgrep) — 7 blocking, all Dockerfile user hygiene
- missing-user (4): apps/call-demo/Dockerfile:16; apps/discovery/Dockerfile:51; apps/legal/Dockerfile:10; apps/voice-control/Dockerfile:7. Fix class: add a non-root `USER` before the final CMD/ENTRYPOINT.
- missing-user-entrypoint (2): apps/voice-redis/Dockerfile:5; apps/voice/Dockerfile:7. Fix class: same.
- last-user-is-root (1): apps/voice-turn/Dockerfile:6. Fix class: switch back to a non-root user after the privileged commands.

## Acknowledging
Only this repo's owner decides an ack: `.github/security-ack.json`, per finding id, reason of at least 10 characters, expiry date. Never a disabled check, never an exclusion that hides .github or a lockfile.
