import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Download, Pause, Play, RotateCcw } from "lucide-react";
import {
  BODIES,
  bakeField,
  clearPainting,
  createField,
  paintField,
  resizeField,
  stepField,
  trailTau,
  type Field,
  type SimSettings,
} from "@/lib/orbit/field";
import { PALETTES, paletteById, rgb, swatchCss } from "@/lib/orbit/palettes";

const STORAGE_KEY = "orbit-loom-v1";

type Persisted = {
  speed: number;
  trail: number;
  paletteId: string;
  guides: boolean;
};

type UiState = Persisted & { paused: boolean };

const DEFAULTS: Persisted = {
  speed: 0.8,
  trail: 0.7,
  paletteId: "corona",
  guides: true,
};

function clamp(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const paletteId =
      typeof parsed.paletteId === "string" && paletteById(parsed.paletteId).id === parsed.paletteId
        ? parsed.paletteId
        : DEFAULTS.paletteId;
    return {
      speed: clamp(parsed.speed, 0.15, 3, DEFAULTS.speed),
      trail: clamp(parsed.trail, 0, 1, DEFAULTS.trail),
      paletteId,
      guides: typeof parsed.guides === "boolean" ? parsed.guides : DEFAULTS.guides,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
}

function toSettings(ui: UiState): SimSettings {
  return {
    speed: ui.speed,
    trail: ui.trail,
    paused: ui.paused,
    guides: ui.guides,
    palette: paletteById(ui.paletteId),
  };
}

export function OrbitField() {
  const [ui, setUi] = useState<UiState>({ ...DEFAULTS, paused: false });
  const [age, setAge] = useState(0);
  const [status, setStatus] = useState("");
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<Field | null>(null);
  const revision = useRef(0);
  const statusTimer = useRef(0);

  const patch = (partial: Partial<UiState>) => {
    setUi((current) => {
      const next = { ...current, ...partial };
      uiRef.current = next;
      revision.current += 1;
      return next;
    });
  };

  useEffect(() => {
    const saved = loadPersisted();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hadSave = localStorage.getItem(STORAGE_KEY) !== null;
    if (reduce && !hadSave) saved.speed = 0.35;
    const next = { ...saved, paused: false };
    uiRef.current = next;
    setUi(next);
  }, []);

  useEffect(() => {
    const payload: Persisted = {
      speed: ui.speed,
      trail: ui.trail,
      paletteId: ui.paletteId,
      guides: ui.guides,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [ui.speed, ui.trail, ui.paletteId, ui.guides]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const field = createField();
    fieldRef.current = field;
    let stopped = false;
    let raf = 0;
    let last = performance.now();
    let shown = -1;
    let paintedRev = -1;

    let baked = false;

    const fit = () => {
      const cssW = parent.clientWidth;
      const cssH = parent.clientHeight;
      if (cssW < 2 || cssH < 2) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      resizeField(field, cssW, cssH, dpr);
      canvas.width = field.w;
      canvas.height = field.h;
    };

    const drawNow = () => {
      if (field.w < 2) return;
      paintField(ctx, field, toSettings(uiRef.current));
      paintedRev = revision.current;
    };

    const ensure = () => {
      fit();
      if (field.w < 2) return;
      if (!baked) {
        bakeField(field, toSettings(uiRef.current));
        baked = true;
        setAge(Math.floor(field.time));
      }
      drawNow();
    };

    ensure();

    const frame = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const sim = toSettings(uiRef.current);
      if (!sim.paused) {
        stepField(field, dt, sim);
        paintField(ctx, field, sim);
        paintedRev = revision.current;
        const second = Math.floor(field.time);
        if (second !== shown) {
          shown = second;
          setAge(second);
        }
      } else if (revision.current !== paintedRev) {
        stepField(field, 0, sim);
        drawNow();
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    const observer = new ResizeObserver(() => {
      const before = field.w;
      fit();
      if (!baked && field.w > 1) ensure();
      else if (field.w !== before && !stopped) drawNow();
    });
    observer.observe(parent);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      if (fieldRef.current === field) fieldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        patch({ paused: !uiRef.current.paused });
      } else if (event.key === "e" || event.key === "E") {
        void exportPng();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flash = (message: string) => {
    setStatus(message);
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(""), 2200);
  };

  const exportPng = async () => {
    const canvas = canvasRef.current;
    const field = fieldRef.current;
    if (!canvas || !field) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintField(ctx, field, toSettings(uiRef.current));
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      flash("导出失败");
      return;
    }
    const palette = paletteById(uiRef.current.paletteId);
    const file = new File([blob], `轨织-${palette.name}.png`, { type: "image/png" });
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "轨织" });
        flash("已打开分享");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
    flash("PNG 已导出");
  };

  const clear = () => {
    const field = fieldRef.current;
    const canvas = canvasRef.current;
    if (!field || !canvas) return;
    clearPainting(field);
    field.time = 0;
    setAge(0);
    const ctx = canvas.getContext("2d");
    if (ctx) paintField(ctx, field, toSettings(uiRef.current));
    flash("轨迹已清空");
  };

  const palette = paletteById(ui.paletteId);
  const tau = trailTau(ui.trail);
  const speedFill = ((ui.speed - 0.15) / (3 - 0.15)) * 100;
  const trailFill = ui.trail * 100;

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-fg">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        aria-label="九大行星围绕太阳做圆周运动，轨迹在轨道场中不断织成图案"
      />

      <header className="safe-top pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-4">
        <div className="loom-rise">
          <p className="font-display text-sm tracking-wide text-primary italic">Orbit Loom</p>
          <h1 className="font-display text-4xl leading-none">轨织</h1>
          <p className="mt-1 text-xs text-muted">九星绕日，圆周成纹</p>
        </div>
        <p className="loom-rise font-display pt-1 text-xl tabular-nums" aria-label={`轨时 ${formatTime(age)}`}>
          {formatTime(age)}
        </p>
      </header>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3">
        <section
          className="pointer-events-auto safe-bottom mb-3 w-full max-w-md rounded-2xl border border-border bg-bg/90 px-4 pt-3"
          aria-label="轨道控制"
        >
          <p className="text-xs text-muted" aria-live="polite">
            {status || `${palette.name} · ${palette.blurb}`}
            {ui.paused ? " · 已暂停" : ""}
          </p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => patch({ paused: !ui.paused })}
              className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-border bg-surface text-sm text-fg"
              aria-pressed={ui.paused}
            >
              {ui.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {ui.paused ? "继续" : "暂停"}
            </button>
            <button
              type="button"
              onClick={clear}
              className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-border bg-surface text-sm text-fg"
            >
              <RotateCcw className="size-4" />
              清空
            </button>
            <button
              type="button"
              onClick={() => void exportPng()}
              className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-primary bg-primary text-sm text-bg"
            >
              <Download className="size-4" />
              导出
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="orbit-speed" className="flex items-baseline justify-between text-xs text-muted">
                <span>速度</span>
                <span className="font-display text-base text-fg tabular-nums">{ui.speed.toFixed(2)}×</span>
              </label>
              <input
                id="orbit-speed"
                className="loom-range"
                type="range"
                min={0.15}
                max={3}
                step={0.01}
                value={ui.speed}
                aria-valuetext={`${ui.speed.toFixed(2)} 倍`}
                style={{ ["--fill" as string]: `${speedFill}%` }}
                onChange={(event) => patch({ speed: Number(event.target.value) })}
              />
            </div>
            <div>
              <label htmlFor="orbit-trail" className="flex items-baseline justify-between text-xs text-muted">
                <span>轨迹</span>
                <span className="font-display text-base text-fg tabular-nums">
                  {tau < 10 ? tau.toFixed(1) : Math.round(tau)} 秒
                </span>
              </label>
              <input
                id="orbit-trail"
                className="loom-range"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={ui.trail}
                aria-valuetext={`记忆 ${Math.round(tau)} 秒`}
                style={{ ["--fill" as string]: `${trailFill}%` }}
                onChange={(event) => patch({ trail: Number(event.target.value) })}
              />
            </div>
          </div>

          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">配色</p>
            <button
              type="button"
              aria-pressed={ui.guides}
              onClick={() => patch({ guides: !ui.guides })}
              className={clsx(
                "h-11 rounded-full border px-4 text-sm",
                ui.guides ? "border-primary text-primary" : "border-border text-muted",
              )}
            >
              轨道线
            </button>
          </div>

          <div className="mt-1 grid grid-cols-6 gap-1.5 pb-1">
            {PALETTES.map((item) => {
              const active = item.id === ui.paletteId;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={item.name}
                  onClick={() => patch({ paletteId: item.id })}
                  className={clsx(
                    "flex h-11 flex-col items-center justify-center gap-1 rounded-lg border",
                    active ? "border-primary" : "border-border",
                  )}
                >
                  <span className="h-1.5 w-7 rounded-full" style={{ background: swatchCss(item) }} />
                  <span className={clsx("text-xs", active ? "text-fg" : "text-muted")}>{item.name}</span>
                </button>
              );
            })}
          </div>

          <ul className="flex gap-2 overflow-x-auto pb-3">
            {BODIES.map((body, index) => (
              <li key={body.id} className="flex shrink-0 items-center gap-1 text-xs text-muted">
                <span
                  className="size-2 rounded-full"
                  style={{ background: rgb(palette.planets[index].body) }}
                />
                {body.name}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
