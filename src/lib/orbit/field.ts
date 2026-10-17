import { mix, rgba, rgb, type Palette, type RGB } from "./palettes";

export type BodyDef = {
  id: string;
  name: string;
  orbit: number;
  omega: number;
  phase: number;
  weight: number;
  lobes: number;
  dust: number;
  bands?: boolean;
  rings?: boolean;
  tilt?: boolean;
};

export const BODIES: readonly BodyDef[] = [
  { id: "mercury", name: "水星", orbit: 0.17, omega: 1.7, phase: 0.45, weight: 1.05, lobes: 5, dust: 1.15 },
  { id: "venus", name: "金星", orbit: 0.27, omega: 1.06, phase: 1.85, weight: 1.45, lobes: 3, dust: 1 },
  { id: "earth", name: "地球", orbit: 0.37, omega: 0.66, phase: 2.55, weight: 1.4, lobes: 4, dust: 0.9 },
  { id: "mars", name: "火星", orbit: 0.47, omega: 0.43, phase: 0.95, weight: 1.2, lobes: 5, dust: 0.85 },
  { id: "jupiter", name: "木星", orbit: 0.58, omega: 0.27, phase: 3.6, weight: 2.55, lobes: 2, dust: 0.7, bands: true },
  { id: "saturn", name: "土星", orbit: 0.68, omega: 0.178, phase: 5.15, weight: 2.15, lobes: 3, dust: 0.6, rings: true },
  { id: "uranus", name: "天王星", orbit: 0.78, omega: 0.122, phase: 1.25, weight: 1.65, lobes: 4, dust: 0.48, tilt: true },
  { id: "neptune", name: "海王星", orbit: 0.88, omega: 0.086, phase: 4.35, weight: 1.6, lobes: 3, dust: 0.42 },
  { id: "pluto", name: "冥王星", orbit: 0.97, omega: 0.054, phase: 2.75, weight: 0.85, lobes: 6, dust: 0.36 },
];

export type SimSettings = {
  speed: number;
  trail: number;
  paused: boolean;
  guides: boolean;
  palette: Palette;
};

type Star = { x: number; y: number; s: number; p: number; layer: number };
type Mote = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  pi: number;
  r: number;
  alive: boolean;
};
type Pulse = { age: number; max: number };

const TAU = Math.PI * 2;
const MOTE_COUNT = 640;
const BAKE_SECONDS = 18;

export function trailTau(trail: number): number {
  const t = Math.min(1, Math.max(0, trail));
  return 0.4 * Math.pow(220, t);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars(count: number): Star[] {
  const rand = mulberry32(0x51a7);
  return Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    s: rand(),
    p: rand() * TAU,
    layer: rand() > 0.86 ? 1 : 0,
  }));
}

function makeMotes(): Mote[] {
  return Array.from({ length: MOTE_COUNT }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    max: 1,
    pi: 0,
    r: 1,
    alive: false,
  }));
}

export type Field = {
  dpr: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  maxR: number;
  time: number;
  stars: Star[];
  motes: Mote[];
  moteWrite: number;
  emitAcc: number[];
  pulses: Pulse[];
  alignHold: number;
  trail: HTMLCanvasElement;
  trailCtx: CanvasRenderingContext2D;
  paletteId: string;
  rand: () => number;
};

export function createField(): Field {
  const trail = document.createElement("canvas");
  const trailCtx = trail.getContext("2d", { alpha: true });
  if (!trailCtx) throw new Error("无法创建轨迹画布");
  trailCtx.lineCap = "round";
  trailCtx.lineJoin = "round";
  return {
    dpr: 1,
    w: 0,
    h: 0,
    cx: 0,
    cy: 0,
    maxR: 1,
    time: 0,
    stars: makeStars(150),
    motes: makeMotes(),
    moteWrite: 0,
    emitAcc: BODIES.map(() => 0),
    pulses: [],
    alignHold: 2.5,
    trail,
    trailCtx,
    paletteId: "",
    rand: mulberry32(0xb017),
  };
}

function layoutOf(w: number, h: number, dpr: number) {
  const topInset = 104 * dpr;
  const bottomInset = Math.min(h * 0.44, 348 * dpr);
  const cx = w / 2;
  const cy = (topInset + (h - bottomInset)) / 2;
  const room = Math.min(cy - topInset, h - bottomInset - cy);
  const maxR = Math.max(48, Math.min(w * 0.4, room) * 0.9);
  return { cx, cy, maxR };
}

export function resizeField(field: Field, cssW: number, cssH: number, dpr: number): void {
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  if (field.w === w && field.h === h && field.dpr === dpr) return;

  const prevW = field.w;
  const prevH = field.h;
  const keep =
    prevW > 0 &&
    prevH > 0 &&
    Math.abs(w - prevW) / prevW < 0.12 &&
    Math.abs(h - prevH) / prevH < 0.12;

  let snap: HTMLCanvasElement | null = null;
  if (keep) {
    snap = document.createElement("canvas");
    snap.width = field.trail.width;
    snap.height = field.trail.height;
    snap.getContext("2d")?.drawImage(field.trail, 0, 0);
  }

  field.dpr = dpr;
  field.w = w;
  field.h = h;
  field.trail.width = w;
  field.trail.height = h;
  field.trailCtx.lineCap = "round";
  field.trailCtx.lineJoin = "round";

  const layout = layoutOf(w, h, dpr);
  field.cx = layout.cx;
  field.cy = layout.cy;
  field.maxR = layout.maxR;

  if (keep && snap) {
    field.trailCtx.drawImage(snap, 0, 0, w, h);
    const sx = w / prevW;
    const sy = h / prevH;
    for (const mote of field.motes) {
      mote.x *= sx;
      mote.y *= sy;
      mote.vx *= sx;
      mote.vy *= sy;
    }
  } else {
    clearMotes(field);
  }
}

function clearMotes(field: Field) {
  for (const mote of field.motes) mote.alive = false;
  field.emitAcc.fill(0);
}

export function clearPainting(field: Field) {
  field.trailCtx.clearRect(0, 0, field.w, field.h);
  clearMotes(field);
  field.pulses.length = 0;
}

function place(body: BodyDef, time: number, field: Field) {
  const ang = body.phase + time * body.omega;
  const radius = body.orbit * field.maxR;
  return {
    ang,
    x: field.cx + Math.cos(ang) * radius,
    y: field.cy + Math.sin(ang) * radius,
    radius,
  };
}

function fadeTrails(field: Field, dt: number, tau: number) {
  const alpha = 1 - Math.exp(-dt / tau);
  const ctx = field.trailCtx;
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, field.w, field.h);
  ctx.globalCompositeOperation = "source-over";
}

function strokeArc(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGB,
  core: number,
  pressure: number,
  dpr: number,
) {
  const glowA = 0.09 + 0.12 * pressure;
  const midA = 0.24 + 0.38 * pressure;
  const coreA = 0.28 + 0.42 * pressure;

  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = rgba(color, glowA);
  ctx.lineWidth = core * 3.4;
  ctx.stroke();
  ctx.strokeStyle = rgba(color, midA);
  ctx.lineWidth = core * 1.45;
  ctx.stroke();

  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = rgba(mix(color, [255, 244, 220], 0.22), coreA);
  ctx.lineWidth = Math.max(dpr * 0.8, core * 0.38);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

function spawnMote(field: Field, index: number, x: number, y: number, ang: number, tau: number) {
  const mote = field.motes[field.moteWrite % field.motes.length];
  if (!mote) return;
  field.moteWrite += 1;
  const tangent = ang + Math.PI / 2;
  const dir = field.rand() > 0.5 ? 1 : -1;
  const tangential = field.maxR * (0.01 + field.rand() * 0.018);
  const radial = field.maxR * (0.003 + field.rand() * 0.012);
  mote.alive = true;
  mote.x = x;
  mote.y = y;
  mote.vx = Math.cos(tangent) * tangential * dir + Math.cos(ang) * radial;
  mote.vy = Math.sin(tangent) * tangential * dir + Math.sin(ang) * radial;
  mote.max = Math.min(Math.max(1.2, tau * 0.55), 12) * (0.65 + field.rand() * 0.7);
  mote.life = mote.max;
  mote.pi = index;
  mote.r = field.dpr * (0.6 + field.rand() * 1.35);
}

function drawMotes(field: Field, palette: Palette, dt: number) {
  const ctx = field.trailCtx;
  ctx.globalCompositeOperation = "source-over";
  for (const mote of field.motes) {
    if (!mote.alive) continue;
    mote.life -= dt;
    if (mote.life <= 0) {
      mote.alive = false;
      continue;
    }
    mote.x += mote.vx * dt;
    mote.y += mote.vy * dt;
    mote.vx *= 1 - dt * 0.15;
    mote.vy *= 1 - dt * 0.15;
    const tint = palette.planets[mote.pi];
    if (!tint) continue;
    const alpha = (mote.life / mote.max) * 0.42;
    ctx.fillStyle = rgba(tint.dust, alpha);
    ctx.beginPath();
    ctx.arc(mote.x, mote.y, mote.r, 0, TAU);
    ctx.fill();
  }
}

function noteAlignment(field: Field, angles: number[], dt: number) {
  field.alignHold = Math.max(0, field.alignHold - dt);
  let sx = 0;
  let sy = 0;
  for (const angle of angles) {
    sx += Math.cos(angle);
    sy += Math.sin(angle);
  }
  const coherence = Math.hypot(sx, sy) / angles.length;
  if (coherence > 0.94 && field.alignHold <= 0) {
    field.pulses.push({ age: 0, max: 2.8 });
    field.alignHold = 7;
  }
  for (const pulse of field.pulses) pulse.age += dt;
  if (field.pulses.length > 4) field.pulses.splice(0, field.pulses.length - 4);
}

export function stepField(field: Field, dt: number, settings: SimSettings) {
  if (settings.palette.id !== field.paletteId) {
    field.paletteId = settings.palette.id;
    clearPainting(field);
  }
  if (settings.paused || dt <= 0) return;

  const tau = trailTau(settings.trail);
  const speed = settings.speed;
  fadeTrails(field, dt, tau);

  const angles: number[] = [];
  for (let i = 0; i < BODIES.length; i += 1) {
    const body = BODIES[i];
    const tint = settings.palette.planets[i];
    if (!body || !tint) continue;
    const t0 = field.time;
    const t1 = field.time + dt * speed;
    const radius = body.orbit * field.maxR;
    const dAng = Math.abs(body.omega * (t1 - t0));
    const steps = Math.max(1, Math.min(14, Math.ceil((dAng * radius) / (2.2 * field.dpr))));
    let prev = place(body, t0, field);

    for (let s = 1; s <= steps; s += 1) {
      const t = t0 + ((t1 - t0) * s) / steps;
      const next = place(body, t, field);
      const midAng = (prev.ang + next.ang) / 2;
      const pressure = 0.5 + 0.5 * Math.sin(midAng * body.lobes + t * (0.28 + body.omega * 0.04));
      const color = mix(tint.trail, settings.palette.sunMid, 0.18 + 0.22 * pressure);
      const core = field.maxR * (0.0072 + body.weight * 0.0044) * (0.5 + 0.9 * pressure);
      strokeArc(field.trailCtx, prev.x, prev.y, next.x, next.y, color, core, pressure, field.dpr);
      prev = next;
    }

    angles.push(prev.ang);
    field.emitAcc[i] += dt * speed * 2.4 * body.dust;
    while (field.emitAcc[i] >= 1) {
      field.emitAcc[i] -= 1;
      spawnMote(field, i, prev.x, prev.y, prev.ang, tau);
    }
  }

  drawMotes(field, settings.palette, dt);
  noteAlignment(field, angles.slice(0, 4), dt);
  field.time += dt * speed;
}

function drawBackground(ctx: CanvasRenderingContext2D, field: Field, palette: Palette) {
  const { cx, cy, maxR, w, h, time } = field;
  const g = ctx.createRadialGradient(cx, cy, maxR * 0.05, cx, cy, Math.max(w, h) * 0.72);
  g.addColorStop(0, rgb(palette.bg1));
  g.addColorStop(0.5, rgb(mix(palette.bg1, palette.bg0, 0.62)));
  g.addColorStop(1, rgb(palette.bg0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const blobs = [
    { ox: 0.28, oy: 0.38, r: 0.42, phase: 0.2, speed: 0.05 },
    { ox: 0.72, oy: 0.58, r: 0.36, phase: 2.1, speed: 0.035 },
    { ox: 0.48, oy: 0.22, r: 0.3, phase: 4.0, speed: 0.045 },
  ];
  for (const blob of blobs) {
    const x = w * (blob.ox + Math.sin(time * blob.speed + blob.phase) * 0.04);
    const y = h * (blob.oy + Math.cos(time * blob.speed * 0.8 + blob.phase) * 0.035);
    const radius = Math.max(w, h) * blob.r;
    const nebula = ctx.createRadialGradient(x, y, 0, x, y, radius);
    nebula.addColorStop(0, rgba(palette.nebula, 0.16));
    nebula.addColorStop(1, rgba(palette.nebula, 0));
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawStars(ctx: CanvasRenderingContext2D, field: Field, palette: Palette) {
  for (const star of field.stars) {
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(field.time * (0.7 + star.s * 1.8) + star.p));
    const drift = field.time * (star.layer ? 1.6 : 0.4);
    const x = ((star.x * field.w + drift) % field.w + field.w) % field.w;
    const y = star.y * field.h;
    const radius = (0.45 + star.s * (star.layer ? 1.5 : 0.9)) * field.dpr;
    ctx.fillStyle = rgba(mix(palette.sunCore, [255, 255, 255], 0.35), tw * (star.layer ? 0.85 : 0.5));
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
}

function drawGuides(ctx: CanvasRenderingContext2D, field: Field, palette: Palette) {
  ctx.save();
  ctx.lineWidth = Math.max(1, field.dpr * 0.75);
  for (const body of BODIES) {
    ctx.beginPath();
    ctx.arc(field.cx, field.cy, body.orbit * field.maxR, 0, TAU);
    ctx.setLineDash([2.2 * field.dpr, 10 * field.dpr]);
    ctx.lineDashOffset = -field.time * (10 + body.omega * 8);
    ctx.strokeStyle = rgba(palette.guide, 0.42);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  ctx.lineWidth = Math.max(1, field.dpr * 0.6);
  const t = field.time;
  for (let i = 0; i < BODIES.length; i += 1) {
    const spot = place(BODIES[i], t, field);
    ctx.beginPath();
    ctx.moveTo(field.cx, field.cy);
    ctx.lineTo(spot.x, spot.y);
    ctx.strokeStyle = rgba(palette.planets[i].trail, 0.075);
    ctx.stroke();
  }
}

function drawPulses(ctx: CanvasRenderingContext2D, field: Field, palette: Palette) {
  for (const pulse of field.pulses) {
    const u = pulse.age / pulse.max;
    if (u >= 1) continue;
    ctx.beginPath();
    ctx.arc(field.cx, field.cy, u * field.maxR * 1.05, 0, TAU);
    ctx.strokeStyle = rgba(palette.sunMid, (1 - u) * 0.45);
    ctx.lineWidth = field.dpr * (1.5 + (1 - u) * 2);
    ctx.stroke();
  }
}

function drawSun(ctx: CanvasRenderingContext2D, field: Field, palette: Palette) {
  const { cx, cy, maxR, time, dpr } = field;
  const pulse = 1 + Math.sin(time * 1.15) * 0.035;
  const core = maxR * 0.062 * pulse;
  const corona = ctx.createRadialGradient(cx, cy, core * 0.2, cx, cy, maxR * 0.15);
  corona.addColorStop(0, rgba(palette.sunMid, 0.55));
  corona.addColorStop(0.35, rgba(palette.sunOuter, 0.18));
  corona.addColorStop(1, rgba(palette.sunOuter, 0));
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * 0.15, 0, TAU);
  ctx.fill();

  for (let i = 0; i < 6; i += 1) {
    const a = time * 0.11 + i * 2.513;
    const sway = 0.7 + 0.45 * Math.sin(time * 0.65 + i * 1.7);
    ctx.beginPath();
    ctx.arc(cx, cy, core * (1.35 + sway), a, a + 0.42 + sway * 0.2);
    ctx.strokeStyle = rgba(palette.sunOuter, 0.28);
    ctx.lineWidth = dpr * 1.15;
    ctx.stroke();
  }

  const body = ctx.createRadialGradient(cx - core * 0.25, cy - core * 0.3, core * 0.1, cx, cy, core);
  body.addColorStop(0, rgb(palette.sunCore));
  body.addColorStop(0.55, rgb(palette.sunMid));
  body.addColorStop(1, rgb(palette.sunOuter));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, core, 0, TAU);
  ctx.fill();
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  flatten: number,
  rot: number,
  color: RGB,
  width: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, flatten);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.strokeStyle = rgba(color, 0.78);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function drawPlanets(ctx: CanvasRenderingContext2D, field: Field, palette: Palette) {
  for (let i = BODIES.length - 1; i >= 0; i -= 1) {
    const body = BODIES[i];
    const spot = place(body, field.time, field);
    const tint = palette.planets[i];
    const radius = field.maxR * (0.018 + body.weight * 0.014);
    const hx = spot.x - Math.cos(spot.ang) * radius * 0.38;
    const hy = spot.y - Math.sin(spot.ang) * radius * 0.38;

    const halo = ctx.createRadialGradient(spot.x, spot.y, radius * 0.4, spot.x, spot.y, radius * 3.1);
    halo.addColorStop(0, rgba(tint.trail, 0.28));
    halo.addColorStop(1, rgba(tint.trail, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, radius * 3.1, 0, TAU);
    ctx.fill();

    if (body.rings) drawRing(ctx, spot.x, spot.y, radius * 2.15, 0.34, -0.5, tint.trail, Math.max(1, field.dpr));
    if (body.tilt) drawRing(ctx, spot.x, spot.y, radius * 1.85, 0.28, 1.2, tint.trail, Math.max(1, field.dpr * 0.8));

    const disc = ctx.createRadialGradient(hx, hy, radius * 0.15, spot.x, spot.y, radius);
    disc.addColorStop(0, rgb(mix(tint.body, [255, 255, 255], 0.45)));
    disc.addColorStop(0.55, rgb(tint.body));
    disc.addColorStop(1, rgb(mix(tint.body, [0, 0, 0], 0.45)));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, radius, 0, TAU);
    ctx.fill();

    if (body.bands) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, radius, 0, TAU);
      ctx.clip();
      for (let band = -2; band <= 2; band += 1) {
        ctx.fillStyle = rgba(band % 2 === 0 ? mix(tint.body, [255, 255, 255], 0.28) : mix(tint.body, [0, 0, 0], 0.28), 0.55);
        ctx.fillRect(spot.x - radius, spot.y + band * radius * 0.32 - radius * 0.08, radius * 2, radius * 0.16);
      }
      ctx.restore();
    }
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, field: Field) {
  const { cx, cy, maxR, w, h } = field;
  const v = ctx.createRadialGradient(cx, cy, maxR * 0.55, cx, cy, Math.max(w, h) * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

export function paintField(ctx: CanvasRenderingContext2D, field: Field, settings: SimSettings) {
  if (field.w < 2 || field.h < 2) return;
  ctx.clearRect(0, 0, field.w, field.h);
  drawBackground(ctx, field, settings.palette);
  drawStars(ctx, field, settings.palette);
  ctx.drawImage(field.trail, 0, 0);
  if (settings.guides) drawGuides(ctx, field, settings.palette);
  drawPulses(ctx, field, settings.palette);
  drawSun(ctx, field, settings.palette);
  drawPlanets(ctx, field, settings.palette);
  drawVignette(ctx, field);
}

export function bakeField(field: Field, settings: SimSettings) {
  const dt = 1 / 24;
  const steps = Math.round(BAKE_SECONDS / dt);
  const running = { ...settings, paused: false };
  for (let i = 0; i < steps; i += 1) stepField(field, dt, running);
}
