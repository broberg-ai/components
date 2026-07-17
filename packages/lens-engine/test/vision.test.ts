import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { visionRoute } from '../src/vision';

// F046.3 — seal the GDPR-safe default. A vision screenshot can carry personal /
// health data, so the DEFAULT route must be the EU tier (Mistral, Paris); a
// non-EU model is only ever a deliberate LENS_VISION_PROVIDER opt-in. If someone
// ever flips the default back to openrouter/gemini, these tests go red.
describe('visionRoute — GDPR-safe default', () => {
  const saved = {
    p: process.env.LENS_VISION_PROVIDER,
    m: process.env.LENS_VISION_MODEL,
  };
  beforeEach(() => {
    delete process.env.LENS_VISION_PROVIDER;
    delete process.env.LENS_VISION_MODEL;
  });
  afterEach(() => {
    saved.p === undefined
      ? delete process.env.LENS_VISION_PROVIDER
      : (process.env.LENS_VISION_PROVIDER = saved.p);
    saved.m === undefined
      ? delete process.env.LENS_VISION_MODEL
      : (process.env.LENS_VISION_MODEL = saved.m);
  });

  it('defaults to the EU tier (Mistral) so a screenshot never leaves the EU', () => {
    const { provider, model } = visionRoute();
    expect(provider).toBe('mistral'); // NOT openrouter/gemini — GDPR house-rule
    expect(model).toMatch(/^mistral/);
  });

  it('is never a non-EU provider by default', () => {
    expect(['openrouter', 'google', 'openai', 'deepseek', 'anthropic']).not.toContain(
      visionRoute().provider,
    );
  });

  it('honours an explicit non-EU opt-in via env (a page the consumer knows is PII-free)', () => {
    process.env.LENS_VISION_PROVIDER = 'openrouter';
    process.env.LENS_VISION_MODEL = 'google/gemini-2.5-flash';
    expect(visionRoute()).toEqual({
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash',
    });
  });
});
