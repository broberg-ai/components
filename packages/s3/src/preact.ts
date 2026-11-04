// F111.2 — a hook, deliberately NOT a visual component: the site owns its design.
import { useCallback, useRef, useState } from "preact/hooks";
import { cancelUpload, uploadFile, type UploadOptions, type UploadProgress, type UploadResult } from "./client";

export type UploadStatus = "idle" | "uploading" | "paused" | "done" | "error";

export function useUpload(opts: Omit<UploadOptions, "signal" | "onProgress">) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const file = useRef<Blob | null>(null);

  const start = useCallback(async (f: Blob) => {
    file.current = f;
    ctl.current = new AbortController();
    setStatus("uploading"); setError(null); setResult(null);
    try {
      const r = await uploadFile(f, { ...opts, signal: ctl.current.signal, onProgress: setProgress });
      setResult(r); setStatus("done");
      return r;
    } catch (e) {
      if (ctl.current.signal.aborted) { setStatus("paused"); return null; }
      setError(e as Error); setStatus("error");
      return null;
    }
  }, [opts.endpoint]);

  /** Stop now; start() with the same file resumes from the finished parts. */
  const pause = useCallback(() => ctl.current?.abort(), []);

  /** Stop and discard everything uploaded so far. */
  const cancel = useCallback(async () => {
    ctl.current?.abort();
    if (file.current) await cancelUpload(file.current, opts);
    setStatus("idle"); setProgress(null);
  }, [opts.endpoint]);

  return { status, progress, error, result, start, pause, cancel };
}
