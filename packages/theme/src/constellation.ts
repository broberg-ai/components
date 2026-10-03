// F001.19 — the neuron constellation backdrop, one copy for the fleet.
//
// Lifted from cardmem apps/web/src/lib/constellation.ts (F108, origin/main
// 433e7e27), itself ported from trail/apps/admin. A fixed canvas covering the
// viewport; colours come from --graph-* (css/palettes.css), so a palette change
// recolours it without touching this file.
//
// Kept from the source:
//   - Singleton via globalThis, so HMR reloads never stack rAF loops.
//   - Paused while the tab is hidden.
//   - Squared-distance pair check; CSS vars read once per frame, not per particle.
//   - prefers-reduced-motion: ONE still frame, never a loop. (It is also what
//     keeps headless captures from starving the page's render.)
//
// Fixed here (both silent in the source):
//   1. Reduced motion + resize left a BLANK canvas: setting canvas.width clears
//      it, and nothing drew again. A still frame is now repainted on resize.
//   2. A tab hidden at mount never painted under reduced motion — the one frame
//      bailed out and no loop came back for it. visibilitychange now repaints.
//
// Added: the backdrop axis. With <html data-backdrop="plain"> nothing is drawn
// (no CPU on a canvas nobody sees) and css/palettes.css hides the canvas.

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseRadius: number;
  isAccent: boolean;
}

interface Runtime {
  canvas: HTMLCanvasElement;
  dispose: () => void;
}

const GLOBAL_KEY = "__brobergConstellation__" as const;
type GlobalWithRuntime = { [GLOBAL_KEY]?: Runtime };

/** Same defaults as cardmem: the classic light graph colours. */
const FALLBACK = {
  node: "#1a1715",
  accent: "#e8a87c",
  line: "26, 23, 21",
  accentLine: "232, 168, 124",
} as const;

/**
 * Start the constellation on `canvas` (make it `position: fixed; inset: 0;
 * pointer-events: none; z-index: -1` or similar). Returns `dispose`. Mounting
 * again disposes the previous one first.
 */
export function mountConstellation(canvas: HTMLCanvasElement): () => void {
  const g = globalThis as unknown as GlobalWithRuntime;
  const existing = g[GLOBAL_KEY];
  if (existing) {
    existing.dispose();
    delete g[GLOBAL_KEY];
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  canvas.setAttribute("data-broberg-constellation", "");

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const LINK_RADIUS = 160;
  const LINK_RADIUS_SQ = LINK_RADIUS * LINK_RADIUS;
  let particles: Particle[] = [];
  let frame = 0;
  let disposed = false;
  const mouse: { x: number | null; y: number | null } = { x: null, y: null };

  const reducedMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const root = document.documentElement;
  function readVar(name: string, fallback: string): string {
    const v = getComputedStyle(root).getPropertyValue(name).trim();
    return v || fallback;
  }

  function initParticles(): void {
    particles = [];
    const raw = Math.floor((window.innerWidth * window.innerHeight) / 18_000);
    const count = Math.min(raw, 150);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        baseRadius: Math.random() > 0.95 ? 3 : 1.5,
        isAccent: Math.random() > 0.98,
      });
    }
  }

  function resize(): void {
    canvas.width = window.innerWidth * DPR;
    canvas.height = window.innerHeight * DPR;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
    initParticles();
  }

  function paint(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    ctx!.clearRect(0, 0, vw, vh);
    if (root.getAttribute("data-backdrop") === "plain") return;

    const nodeColor = readVar("--graph-node", FALLBACK.node);
    const accentColor = readVar("--graph-accent", FALLBACK.accent);
    const lineRgb = readVar("--graph-line", FALLBACK.line);
    const accentLineRgb = readVar("--graph-accent-line", FALLBACK.accentLine);

    for (const p of particles) {
      if (!reducedMotion) {
        p.x += p.vx;
        p.y += p.vy;
        if ((p.x < 0 && p.vx < 0) || (p.x > vw && p.vx > 0)) p.vx = -p.vx;
        if ((p.y < 0 && p.vy < 0) || (p.y > vh && p.vy > 0)) p.vy = -p.vy;
        if (mouse.x !== null && mouse.y !== null) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          if (dx * dx + dy * dy < 10_000) {
            p.x -= dx * 0.01;
            p.y -= dy * 0.01;
          }
        }
      }
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, p.baseRadius, 0, Math.PI * 2);
      ctx!.fillStyle = p.isAccent ? accentColor : nodeColor;
      ctx!.fill();
    }

    for (let i = 0; i < particles.length; i++) {
      const a = particles[i]!;
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dSq = dx * dx + dy * dy;
        if (dSq >= LINK_RADIUS_SQ) continue;
        const opacity = 1 - Math.sqrt(dSq) / LINK_RADIUS;
        ctx!.beginPath();
        ctx!.strokeStyle =
          a.isAccent || b.isAccent ? `rgba(${accentLineRgb}, ${opacity * 0.5})` : `rgba(${lineRgb}, ${opacity * 0.18})`;
        ctx!.lineWidth = 0.6;
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }
    }
  }

  /** One frame if visible. The loop only exists without reduced motion. */
  function tick(): void {
    if (disposed) return;
    if (document.visibilityState === "visible") paint();
    if (!reducedMotion) frame = requestAnimationFrame(tick);
  }

  // Under reduced motion there is no loop, so every event that clears or hides
  // the canvas has to repaint the still frame itself.
  function repaintStill(): void {
    if (!disposed && reducedMotion && document.visibilityState === "visible") paint();
  }
  function onResize(): void {
    resize();
    repaintStill();
  }
  function onMouseMove(e: MouseEvent): void {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }
  function onMouseOut(): void {
    mouse.x = null;
    mouse.y = null;
  }

  window.addEventListener("resize", onResize);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseout", onMouseOut);
  document.addEventListener("visibilitychange", repaintStill);
  const backdropWatch =
    typeof MutationObserver === "function" ? new MutationObserver(repaintStill) : null;
  backdropWatch?.observe(root, { attributes: true, attributeFilter: ["data-backdrop", "data-theme", "data-palette"] });

  resize();
  tick();

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseout", onMouseOut);
    document.removeEventListener("visibilitychange", repaintStill);
    backdropWatch?.disconnect();
    if (g[GLOBAL_KEY] === runtime) delete g[GLOBAL_KEY];
  };
  const runtime: Runtime = { canvas, dispose };
  g[GLOBAL_KEY] = runtime;
  return dispose;
}
