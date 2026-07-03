// @broberg/lens-client — thin client for the HOSTED Lens (lens.cardmem.com).
// The core export ('.') is dependency-free. The Hono proxy lives at
// "@broberg/lens-client/hono" so a mint-only / client-only consumer never pulls
// hono.

export { createLensClient, type LensClient, type LensClientOptions } from "./client";
export { LensClientError } from "./types";
export type {
  CaptureMode,
  LocateSpec,
  Target,
  Viewport,
  MintAuth,
  StorageState,
  UploadFile,
  FlowStep,
  CaptureRequest,
  FlowRequest,
  CaptureResult,
  FlowStepResult,
  FlowResult,
} from "./types";
