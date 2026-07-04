// @broberg/bodymap/react — the 2D SVG renderer (F052.2).
//
// <BodyMap> is the shippable MVP: a genderless, colour-blocked body a patient
// clicks to mark where it hurts. Selecting a region opens a custom intensity
// (0-10) + quality control (NO native inputs) that upserts a validated
// PainReport and fires onChange. Honours the per-app RegionConfig. The 3D
// <BodyMap3D> (F052.6) will render the SAME core on the SAME onChange contract.

import { useEffect, useState } from "react";
import {
  REGIONS,
  PAIN_TYPES,
  painPointSchema,
  resolveRegions,
  isSelectable,
  type BodyRegion,
  type PainReport,
  type PainType,
  type RegionConfig,
} from "./index.js";

// ---- geometry: each region → an SVG shape (a neutral colour-blockout) --------

type Shape =
  | { el: "circle"; cx: number; cy: number; r: number }
  | { el: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { el: "rect"; x: number; y: number; width: number; height: number; rx: number };

// Front-view geometry (viewBox 260×470). The 2D MVP renders the front-visible
// regions; back-only regions (thora, lumbar) + hip are driven by the 3D body /
// a later back view. "left"/"right" are placed self-view (viewer's left = key
// left) for the MVP — the facing-the-patient mirror is a later config option.
const SHAPES: Record<string, Shape> = {
  head: { el: "circle", cx: 130, cy: 40, r: 26 },
  neck: { el: "rect", x: 120, y: 62, width: 20, height: 16, rx: 6 },
  chest: { el: "rect", x: 100, y: 84, width: 60, height: 104, rx: 16 },
  groin: { el: "rect", x: 106, y: 190, width: 48, height: 30, rx: 13 },
  // left arm (viewer-left)
  shoulder_left: { el: "circle", cx: 88, cy: 98, r: 14 },
  uarm_left: { el: "rect", x: 66, y: 104, width: 18, height: 54, rx: 9 },
  elbow_left: { el: "circle", cx: 73, cy: 164, r: 10 },
  farm_left: { el: "rect", x: 62, y: 174, width: 16, height: 50, rx: 8 },
  wrist_left: { el: "circle", cx: 68, cy: 230, r: 8 },
  hand_left: { el: "ellipse", cx: 67, cy: 250, rx: 11, ry: 13 },
  // right arm (viewer-right)
  shoulder_right: { el: "circle", cx: 172, cy: 98, r: 14 },
  uarm_right: { el: "rect", x: 176, y: 104, width: 18, height: 54, rx: 9 },
  elbow_right: { el: "circle", cx: 187, cy: 164, r: 10 },
  farm_right: { el: "rect", x: 182, y: 174, width: 16, height: 50, rx: 8 },
  wrist_right: { el: "circle", cx: 192, cy: 230, r: 8 },
  hand_right: { el: "ellipse", cx: 193, cy: 250, rx: 11, ry: 13 },
  // legs
  thigh_left: { el: "rect", x: 104, y: 224, width: 22, height: 80, rx: 11 },
  thigh_right: { el: "rect", x: 134, y: 224, width: 22, height: 80, rx: 11 },
  knee_left: { el: "circle", cx: 115, cy: 312, r: 13 },
  knee_right: { el: "circle", cx: 145, cy: 312, r: 13 },
  lowleg_left: { el: "rect", x: 106, y: 322, width: 18, height: 74, rx: 9 },
  lowleg_right: { el: "rect", x: 136, y: 322, width: 18, height: 74, rx: 9 },
  ankle_left: { el: "circle", cx: 115, cy: 404, r: 9 },
  ankle_right: { el: "circle", cx: 145, cy: 404, r: 9 },
  foot_left: { el: "ellipse", cx: 115, cy: 424, rx: 14, ry: 10 },
  foot_right: { el: "ellipse", cx: 145, cy: 424, rx: 14, ry: 10 },
};

const FILL: Record<string, string> = {
  head: "#cbb7ec", neck: "#b8a3e6", chest: "#e26d6d", groin: "#e88a52",
  shoulder_left: "#f6c667", shoulder_right: "#f6c667",
  uarm_left: "#7ececb", uarm_right: "#7ececb",
  elbow_left: "#86cfcc", elbow_right: "#86cfcc",
  farm_left: "#8fd0cd", farm_right: "#8fd0cd",
  wrist_left: "#9ad6d3", wrist_right: "#9ad6d3",
  hand_left: "#a7ddda", hand_right: "#a7ddda",
  thigh_left: "#7fb2e8", thigh_right: "#7fb2e8",
  knee_left: "#c79be0", knee_right: "#c79be0",
  lowleg_left: "#e39ec6", lowleg_right: "#e39ec6",
  ankle_left: "#eeaab9", ankle_right: "#eeaab9",
  foot_left: "#f0a5a5", foot_right: "#f0a5a5",
};

function center(s: Shape): { x: number; y: number } {
  if (s.el === "rect") return { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  return { x: s.cx, y: s.cy };
}
function heat(v: number): string {
  return v >= 7 ? "#ef4444" : v >= 4 ? "#fb923c" : "#fcd34d";
}

// ---- one-time style injection (no external CSS; theme via CSS variables) -----

const STYLE_ID = "broberg-bodymap-styles";
const STYLE = `
.bmap{--bmap-accent:var(--primary,#0e8f8a);--bmap-line:#e2e8f0;--bmap-panel:#fff;--bmap-ink:#1e293b;--bmap-muted:#64748b;
  display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--bmap-ink)}
.bmap__svg{flex:0 0 auto}
.bmap__region{cursor:pointer;stroke:#fff;stroke-width:2.4;transition:filter .12s}
.bmap__region:hover{filter:brightness(1.08) saturate(1.15)}
.bmap__region--locked{cursor:default;opacity:.4}
.bmap__region--sel{stroke:var(--bmap-accent);stroke-width:3.6}
.bmap__heatn{font:700 11px ui-sans-serif;fill:#fff;pointer-events:none}
.bmap__panel{flex:1 1 220px;min-width:220px;border:1px solid var(--bmap-line);border-radius:14px;padding:16px 18px;background:var(--bmap-panel)}
.bmap__panel--empty{color:var(--bmap-muted);font-size:13.5px}
.bmap__ph{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
.bmap__ph b{font-size:16px}
.bmap__code{font:11px ui-monospace,monospace;color:var(--bmap-muted);background:#f1f5f9;border-radius:6px;padding:2px 7px}
.bmap__lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--bmap-muted);margin:0 0 7px}
.bmap__scale{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:14px}
.bmap__i{font:inherit;font-size:13px;font-weight:600;width:30px;height:30px;border-radius:8px;border:1px solid var(--bmap-line);background:#fff;color:var(--bmap-ink);cursor:pointer;transition:.1s}
.bmap__i:hover{border-color:var(--bmap-accent)}
.bmap__i:active{transform:scale(.9)}
.bmap__i--on{background:var(--bmap-accent);border-color:var(--bmap-accent);color:#fff}
.bmap__chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.bmap__chip{font:inherit;font-size:12.5px;border:1px solid var(--bmap-line);background:#fff;color:var(--bmap-muted);border-radius:999px;padding:6px 12px;cursor:pointer;transition:.1s}
.bmap__chip:hover{border-color:var(--bmap-accent);color:var(--bmap-accent)}
.bmap__chip:active{transform:scale(.96)}
.bmap__chip--on{background:var(--bmap-ink);border-color:var(--bmap-ink);color:#fff}
.bmap__rm{font:inherit;font-size:13px;font-weight:600;border:1px solid #f6c9c9;background:#fff;color:#ef4444;border-radius:9px;padding:8px 13px;cursor:pointer;transition:.1s}
.bmap__rm:hover{background:#fef2f2}
.bmap__rm:active{transform:scale(.97)}
`;

function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

// ---- component ---------------------------------------------------------------

export interface BodyMapProps {
  /** Controlled report. Omit for an uncontrolled component (use defaultValue). */
  value?: PainReport;
  /** Initial report when uncontrolled. */
  defaultValue?: PainReport;
  /** Fired with the full validated PainReport on every change. */
  onChange?: (report: PainReport) => void;
  /** Per-app region config (visible / selectable). */
  config?: RegionConfig;
  className?: string;
}

/** 2D SVG body pain-map. Click a region → set intensity + quality → PainReport. */
export function BodyMap({ value, defaultValue, onChange, config = {}, className }: BodyMapProps) {
  useEffect(ensureStyles, []);
  const [internal, setInternal] = useState<PainReport>(defaultValue ?? []);
  const [selected, setSelected] = useState<string | null>(null);
  const report = value ?? internal;

  const commit = (next: PainReport) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };
  const pointOf = (key: string) => report.find((p) => p.region === key);
  const setPain = (key: string, intensity: number, type?: PainType) => {
    const point = painPointSchema.parse({ region: key, intensity, type, timestamp: new Date().toISOString() });
    commit([...report.filter((p) => p.region !== key), point]);
  };
  const removePain = (key: string) => {
    commit(report.filter((p) => p.region !== key));
    setSelected(null);
  };

  const regions = resolveRegions(config);
  const region: BodyRegion | undefined = selected ? REGIONS.find((r) => r.key === selected) : undefined;
  const current = selected ? pointOf(selected) : undefined;
  const rootCls = ["bmap", className].filter(Boolean).join(" ");

  return (
    <div className={rootCls} data-testid="bodymap-root">
      <svg
        className="bmap__svg"
        viewBox="0 0 260 470"
        width={230}
        height={416}
        role="group"
        aria-label="Kropskort — vælg hvor det gør ondt"
      >
        {regions.map((r) => {
          const s = SHAPES[r.key];
          if (!s) return null;
          const marked = pointOf(r.key);
          const selectable = isSelectable(r.key, config);
          const cls = [
            "bmap__region",
            !selectable && "bmap__region--locked",
            selected === r.key && "bmap__region--sel",
          ]
            .filter(Boolean)
            .join(" ");
          const fill = marked ? heat(marked.intensity) : FILL[r.key] ?? "#cbd5e1";
          const common = {
            className: cls,
            fill,
            "data-testid": `bodymap-region-${r.key}`,
            role: selectable ? "button" : undefined,
            "aria-label": r.label,
            onClick: selectable ? () => setSelected(r.key) : undefined,
          };
          if (s.el === "circle") return <circle key={r.key} cx={s.cx} cy={s.cy} r={s.r} {...common} />;
          if (s.el === "ellipse") return <ellipse key={r.key} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...common} />;
          return <rect key={r.key} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} {...common} />;
        })}
        {/* intensity numbers on marked regions */}
        {report.map((p) => {
          const s = SHAPES[p.region];
          if (!s || (config[p.region]?.visible === false)) return null;
          const c = center(s);
          return (
            <text key={p.region} x={c.x} y={c.y + 4} textAnchor="middle" className="bmap__heatn">
              {p.intensity}
            </text>
          );
        })}
      </svg>

      {region ? (
        <div className="bmap__panel" data-testid="bodymap-panel">
          <div className="bmap__ph">
            <b>{region.label}</b>
            <span className="bmap__code">{region.code}</span>
          </div>
          <p className="bmap__lbl">Intensitet (0-10)</p>
          <div className="bmap__scale" role="group" aria-label="Intensitet">
            {Array.from({ length: 11 }, (_, n) => (
              <button
                key={n}
                type="button"
                className={"bmap__i" + (current?.intensity === n ? " bmap__i--on" : "")}
                data-testid={`bodymap-intensity-${n}`}
                aria-pressed={current?.intensity === n}
                onClick={() => setPain(region.key, n, current?.type)}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="bmap__lbl">Kvalitet</p>
          <div className="bmap__chips" role="group" aria-label="Kvalitet">
            {PAIN_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={"bmap__chip" + (current?.type === t ? " bmap__chip--on" : "")}
                data-testid={`bodymap-type-${t}`}
                aria-pressed={current?.type === t}
                onClick={() => setPain(region.key, current?.intensity ?? 5, t)}
              >
                {t}
              </button>
            ))}
          </div>
          {current && (
            <button type="button" className="bmap__rm" data-testid="bodymap-remove" onClick={() => removePain(region.key)}>
              Fjern punkt
            </button>
          )}
        </div>
      ) : (
        <div className="bmap__panel bmap__panel--empty" data-testid="bodymap-panel">
          Klik en kropsdel for at markere smerte.
        </div>
      )}
    </div>
  );
}
