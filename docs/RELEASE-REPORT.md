# Release report — the template every `@broberg/*` release is announced with

D-b7eb14: never publish a version without telling its consumers. D-5f65b6: an announcement is a POSSIBILITY, never a task — Christian
alone decides which apps adopt a release. Consumers are found in `data/fleet-deps.json` (Discovery's fleet scan) and in the
package's Discovery row; the message goes to each of them (or, for a batch, one fleet broadcast that names the consumers per package).

```text
components → <consumer>: @broberg/<pkg> <new-version> (<card>) — <one line: what it is>.
WHAT CHANGED: <what, in plain words, and why — a defect, a feature, a security fix>.
DOES IT BREAK ANYTHING: <no | yes: exactly what, and what the consumer must change>.
DOES THE OUTPUT MOVE: <no | yes: what the rendered / returned value looks like before and after — measured, not assumed>.
PROVENANCE AND SBOM: published by CI with an SLSA provenance attestation and verified registry signatures
  (scripts/verify-provenance.mjs, run after every publish); a CycloneDX SBOM was generated and attached to the publish run
  (artifact sbom-<pkg>). `npm audit signatures` is green for this version.
THIS IS A POSSIBILITY, NOT A TASK (D-5f65b6): Christian decides whether you upgrade. You have <current-version>.
```

Rules that go with it:

- A security fix says so, names the class of hole and who is exposed — and says if a credential may have reached a log (then it
  must be rotated whatever you decide about upgrading).
- `sso` releases are advised to broberg-id AND every known consumer BEFORE anyone is asked to upgrade (D-4d0783).
- "Does the output move" is measured on a real page / real input (Lens for UI), never answered from memory.
- If a consumer answers "not affected", that is a complete answer; nothing more is owed.
