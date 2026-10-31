// F078.5 — the web cannot name Face ID, and Android cannot either.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ANDROID_MODALITY_REASON,
  biometricsFromAndroid,
  biometricsFromIos,
  biometricsUnknownOnWeb,
  type BiometricFacts,
  type BiometricModality,
} from "../src/permissions.js";

describe("enrolment and modality are SEPARATE, each with its own source (F078.5)", () => {
  it("iOS: Face ID enrolled → enrolment yes + modality face, both from native-ios", () => {
    expect(biometricsFromIos({ canEvaluate: true, biometryType: "faceID" })).toStrictEqual({
      enrolment: { enrolled: "yes", source: "native-ios" },
      modality: { modality: "face", source: "native-ios" },
    });
  });

  it("iOS: Touch ID hardware, nothing enrolled → enrolment no, modality fingerprint (what the device HAS)", () => {
    expect(biometricsFromIos({ canEvaluate: false, biometryType: "touchID" })).toStrictEqual({
      enrolment: { enrolled: "no", source: "native-ios" },
      modality: { modality: "fingerprint", source: "native-ios" },
    });
  });

  it("type-level: a modality cannot be read without its source", () => {
    const f: BiometricFacts = biometricsFromIos({ canEvaluate: true, biometryType: "faceID" });
    const m: BiometricModality = f.modality;
    // @ts-expect-error a modality without a source is not a BiometricModality
    const bad: BiometricModality = { modality: "face" };
    expect([m.source, bad].length).toBe(2);
  });
});

describe("Android: modality is unknown BY CONSTRUCTION, with the reason", () => {
  it("enrolled strong biometric → enrolment yes, modality unknown with the stated reason", () => {
    expect(biometricsFromAndroid("BIOMETRIC_SUCCESS")).toStrictEqual({
      enrolment: { enrolled: "yes", source: "native-android" },
      modality: { modality: "unknown", source: "native-android", reason: ANDROID_MODALITY_REASON },
    });
  });

  it("none enrolled / no hardware / anything else → no / no-hardware / unknown", () => {
    expect(biometricsFromAndroid("BIOMETRIC_ERROR_NONE_ENROLLED").enrolment.enrolled).toBe("no");
    expect(biometricsFromAndroid("BIOMETRIC_ERROR_NO_HARDWARE").enrolment.enrolled).toBe("no-hardware");
    expect(biometricsFromAndroid("BIOMETRIC_STATUS_UNKNOWN").enrolment.enrolled).toBe("unknown");
  });

  it("it is IMPOSSIBLE to set an Android modality to face or fingerprint — it does not compile", () => {
    const a = biometricsFromAndroid("BIOMETRIC_SUCCESS");
    // @ts-expect-error the Android branch cannot carry «face»
    a.modality = { modality: "face", source: "native-android", reason: ANDROID_MODALITY_REASON };
    // @ts-expect-error nor «fingerprint»
    const b: BiometricModality = { modality: "fingerprint", source: "native-android", reason: ANDROID_MODALITY_REASON };
    expect(b).toBeDefined();
  });
});

describe("NEGATIVE CONTROL on source: no native report reads web-cannot-tell, never none", () => {
  it("the web's answer is «cannot tell», not «none» — the two are different values", () => {
    const w = biometricsUnknownOnWeb();
    expect(w.enrolment).toStrictEqual({ enrolled: "unknown", source: "web-cannot-tell" });
    expect(w.modality.source).toBe("web-cannot-tell");
    expect(w.modality.modality).not.toBe("none");
    expect(w.enrolment.enrolled).not.toBe("no");
  });
});

describe("platformAuthenticator's docstring says it is also true for a passcode — in the PUBLISHED .d.ts", () => {
  it("dist/permissions.d.ts carries it (a docstring stripped from the build reaches no consumer)", () => {
    const dts = readFileSync(new URL("../dist/permissions.d.ts", import.meta.url), "utf8");
    expect(dts).toContain("is ALSO what a device with only a PASSCODE answers");
    expect(dts).toContain("It does");
    expect(dts).toContain("NOT mean biometrics are enrolled");
  });
});
