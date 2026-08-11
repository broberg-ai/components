// @broberg/lens-engine — the shared capture + flow engine for the cardmem-lens
// fleet (the hosted cloud service AND the local daemon import this ONE engine, so
// self-healing locators + the frozen /flow grammar never drift between them).
//
// The engine returns PNG BYTES + structured reports; storage/serve/auth-fetch are
// the consumer's job. It is auth-agnostic: capture()/runFlow() take a
// `storageState` (object OR async resolver) that the consumer supplies.

export {
  capture,
  closeBrowser,
  getBrowser,
  armIdleTimer,
  // F065 — call at boot to fail a bad image as a failed DEPLOY rather than as a
  // failed capture in production. getBrowser() calls it too, so it is on by
  // default; the export exists so a consumer can fail fast before serving.
  assertBrowserAvailable,
  browserMissingMessage,
  resolveViewport,
  resolveSelector,
  resolveStorageState,
  settle,
  takeShot,
  type CaptureOptions,
  type CaptureResult,
  type StorageStateInput,
} from './capture';

export {
  runFlow,
  plannedLayers,
  resolveTarget,
  isEditableElement,
  // F064 — exported for the SAME reason as isEditableElement: the local daemon
  // and the cloud runner must share ONE definition of what an assert means.
  // Two copies is how the false green got in.
  evalAssertBody,
  // F066/0.6.1 — filed by cardmem, who had rebuilt these two sentences by hand
  // on both of their paths. Two copies of a message drift exactly like two
  // copies of a verdict do.
  noVerdictMessage,
  type AssertOutcome,
  type FlowOptions,
  type FlowResult,
  type FlowStepReport,
  type ResolveTargetResult,
} from './flow';

export { applyStorageState, fetchStorageState } from './mint';

export { resolveVisionElement, visionEnabled, visionRoute } from './vision';

// v0.2.0 — token-frugal page-READ primitives (read / extract / network).
export { withPageSession, type PageSessionOptions } from './page-session';

export { read, htmlToMarkdown, type ReadOptions, type ReadResult } from './read';

export {
  extract,
  extractRegions,
  type ExtractHint,
  type ExtractRegion,
  type ExtractResult,
} from './extract';

export {
  network,
  matchesUrlPattern,
  shapeResponseParts,
  type NetworkOptions,
  type NetworkResponse,
  type NetworkResult,
} from './network';

export {
  coverage,
  computeCoverage,
  type CoverageSchema,
  type CoveragePage,
  type CoverageReport,
  type CoverageOptions,
} from './coverage';

export * from './schema';
