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
  resolveViewport,
  resolveSelector,
  resolveStorageState,
  settle,
  takeShot,
  type CaptureOptions,
  type CaptureResult,
  type StorageStateInput,
} from './capture';

export { runFlow, plannedLayers, type FlowOptions, type FlowResult, type FlowStepReport } from './flow';

export { applyStorageState, fetchStorageState } from './mint';

export { resolveVisionElement, visionEnabled } from './vision';

export * from './schema';
