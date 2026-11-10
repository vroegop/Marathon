// Exercise pictures: a simple figure drawn as SVG from the joint angles in poses.js.
//
// Angles are absolute directions in degrees: 0 points down, 90 right (where a side-view
// figure faces), 180 up, -90 left. Lengths are roughly centimetres for a 1.75 m person.
// Body parts in the pose's `work` list are drawn in the highlight colour: that's where the
// exercise should be felt.

import { POSES } from "./poses.js";

const LEN = { torso: 50, neck: 6, head: 10, upper: 29, fore: 27, thigh: 44, shin: 42, foot: 14 };
const THICK = { torso: 16, neck: 7, upper: 9, fore: 8, thigh: 12, shin: 10, foot: 6 };
const HALF = { hip: 9, shoulder: 12 }; // half widths, front view
const PAD = 10;
const GAP = 26;
const PX = 0.8; // screen pixels per unit, so every figure is drawn at the same size

const rad = (d) => (d * Math.PI) / 180;
const step = (p, angle, len) => [p[0] + Math.sin(rad(angle)) * len, p[1] + Math.cos(rad(angle)) * len];
const f1 = (n) => Math.round(n * 10) / 10;
const scaleOf = (s, i) => (Array.isArray(s) ? s[i] ?? 1 : s ?? 1);

// Joint positions with the pelvis at (0, 0).
function joints(pose, front) {
  const t = pose.t ?? 180;
  const j = { pelvis: [0, 0] };
  j.neck = step(j.pelvis, t, LEN.torso * (pose.ts ?? 1));
  j.head = step(j.neck, pose.h ?? t, LEN.neck + LEN.head);
  const hipLine = t - 90 + (pose.pt ?? 0);
  const shoulderLine = t - 90 + (pose.st ?? 0);
  for (const i of [1, 2]) {
    const side = i === 1 ? -1 : 1;
    j[`hip${i}`] = front ? step(j.pelvis, hipLine, side * HALF.hip * (pose.hw ?? 1)) : j.pelvis;
    j[`shoulder${i}`] = front ? step(j.neck, shoulderLine, side * HALF.shoulder * (pose.sw ?? 1)) : j.neck;
    const [up, fo, as] = pose.a?.[i - 1] ?? [0, 0];
    j[`elbow${i}`] = step(j[`shoulder${i}`], up, LEN.upper * scaleOf(as, 0));
    j[`hand${i}`] = step(j[`elbow${i}`], fo, LEN.fore * scaleOf(as, 1));
    const [th, sh, ft = front ? side * 90 : 90, ls] = pose.l?.[i - 1] ?? [0, 0];
    j[`knee${i}`] = step(j[`hip${i}`], th, LEN.thigh * scaleOf(ls, 0));
    j[`ankle${i}`] = step(j[`knee${i}`], sh, LEN.shin * scaleOf(ls, 1));
    j[`toe${i}`] = step(j[`ankle${i}`], ft, LEN.foot * scaleOf(ls, 2) * (front ? 0.55 : 1));
  }
  return j;
}

// The body as chains of segments, back to front. Every chain but the far limbs gets a
// thin outline in the background colour, so a limb in front of the body stays visible.
function chains(j, front) {
  const arm = (i) => [[`upper${i}`, `shoulder${i}`, `elbow${i}`, "upper"], [`fore${i}`, `elbow${i}`, `hand${i}`, "fore"]];
  const leg = (i) => [[`thigh${i}`, `hip${i}`, `knee${i}`, "thigh"], [`shin${i}`, `knee${i}`, `ankle${i}`, "shin"], [`foot${i}`, `ankle${i}`, `toe${i}`, "foot"]];
  const torso = [["neck", "neck", "head", "neck"], ["torso", "pelvis", "neck", "torso"]];
  const order = front
    ? [[leg(1)], [leg(2)], [torso], [arm(1)], [arm(2)]]
    : [[arm(2), true], [leg(2), true], [torso], [leg(1)], [arm(1)]];
  return order.map(([segs, far = false]) => ({
    far, segs: segs.map(([name, a, b, kind]) => ({ name, a: j[a], b: j[b], kind })),
  }));
}

function point(j, ref) {
  if (Array.isArray(ref)) return ref;
  if (typeof ref === "string") return j[ref];
  const p = j[ref.at];
  return [p[0] + (ref.dx ?? 0), p[1] + (ref.dy ?? 0)];
}

const arrowHead = (tip, dir) => {
  const a = step(tip, dir + 180 - 30, 7), b = step(tip, dir + 180 + 30, 7);
  return `<path class="mark-head" d="M${f1(a[0])} ${f1(a[1])}L${f1(tip[0])} ${f1(tip[1])}L${f1(b[0])} ${f1(b[1])}Z"/>`;
};

// One frame: body, props and marks, in pelvis coordinates, plus its bounding box.
function frame(pose, ex) {
  const front = (pose.view ?? ex.view) === "front";
  const j = joints(pose, front);
  const work = new Set(pose.work ?? ex.work ?? []);
  const pts = []; // [x, y, radius] for the bounding box
  const back = [], body = [], over = [];
  const line = (a, b, cls, w) =>
    `<line class="${cls}" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke-width="${w}"/>`;

  for (const chain of chains(j, front)) {
    const halo = [], segs = [];
    for (const s of chain.segs) {
      if (s.kind === "torso" && front) {
        const quad = ["shoulder1", "shoulder2", "hip2", "hip1"].map((k) => j[k]);
        const d = `M${quad.map((p) => `${f1(p[0])} ${f1(p[1])}`).join("L")}Z`;
        halo.push(`<path class="halo" d="${d}" stroke-width="10"/>`);
        segs.push(`<path class="seg torso${work.has("torso") ? " work" : ""}" d="${d}"/>`);
        quad.forEach((p) => pts.push([p[0], p[1], 4]));
        continue;
      }
      const cls = ["seg", chain.far && "far", work.has(s.name) && "work"].filter(Boolean).join(" ");
      if (!chain.far) halo.push(line(s.a, s.b, "halo", THICK[s.kind] + 4));
      segs.push(line(s.a, s.b, cls, THICK[s.kind]));
      pts.push([s.a[0], s.a[1], THICK[s.kind] / 2], [s.b[0], s.b[1], THICK[s.kind] / 2]);
    }
    if (chain.segs.some((x) => x.kind === "torso")) {
      const c = `cx="${f1(j.head[0])}" cy="${f1(j.head[1])}"`;
      halo.push(`<circle class="halo" ${c} r="${LEN.head + 2}"/>`);
      segs.push(`<circle class="head${work.has("head") ? " work" : ""}" ${c} r="${LEN.head}"/>`);
      pts.push([j.head[0], j.head[1], LEN.head]);
    }
    body.push(...halo, ...segs);
  }

  // Hip and glute highlights sit on top of the body.
  const dot = (p, r) => over.push(`<circle class="work-dot" cx="${f1(p[0])}" cy="${f1(p[1])}" r="${r}"/>`);
  if (work.has("pelvis")) dot(j.pelvis, 7);
  if (work.has("glute")) dot(step(j.pelvis, (pose.t ?? 180) + 90, 6), 7);
  for (const i of [1, 2]) if (work.has(`hip${i}`)) dot(step(j[`hip${i}`], i === 1 ? (pose.t ?? 180) + 90 : (pose.t ?? 180) - 90, 4), 6);

  // Where the ground is: under the lowest point, or under `base` raised by `lift`.
  let ground;
  if (pose.base) ground = point(j, pose.base)[1] + (pose.baseR ?? 4) + (pose.lift ?? 0);
  else ground = Math.max(...pts.map(([, y, r]) => y + r)) + (pose.air ?? 0);

  for (const p of pose.props ?? []) {
    if (p.kb) {
      const hand = point(j, p.kb);
      const c = step(hand, p.dir ?? 0, 10);
      const svg = `<circle class="kb-handle" cx="${f1((hand[0] + c[0]) / 2)}" cy="${f1((hand[1] + c[1]) / 2)}" r="5"/><circle class="kb" cx="${f1(c[0])}" cy="${f1(c[1])}" r="${p.r ?? 8}"/>`;
      (front || !String(p.kb).endsWith("2") ? over : back).push(svg);
      pts.push([c[0], c[1], 9]);
    } else if (p.band) {
      const ps = p.band.map((r) => point(j, r));
      over.push(`<polyline class="band" points="${ps.map((q) => `${f1(q[0])},${f1(q[1])}`).join(" ")}"/>`);
      ps.forEach((q) => pts.push([q[0], q[1], 2]));
    } else if (p.anchor) {
      const q = point(j, p.anchor);
      back.push(`<circle class="anchor" cx="${f1(q[0])}" cy="${f1(q[1])}" r="4"/>`);
      pts.push([q[0], q[1], 4]);
    } else if (p.box) {
      const q = point(j, p.box);
      const top = q[1] + (p.pad ?? 4), w = p.w ?? 40, x = q[0] + (p.dx ?? 0) - w / 2;
      back.push(`<rect class="prop" x="${f1(x)}" y="${f1(top)}" width="${f1(w)}" height="${f1(Math.max(ground - top, 2))}" rx="3"/>`);
      pts.push([x, top, 0], [x + w, ground, 0]);
    } else if (p.wall) {
      const q = point(j, p.wall);
      const x = q[0] + (p.dx ?? 0), h = p.h ?? 150;
      back.push(`<rect class="prop" x="${f1(x)}" y="${f1(ground - h)}" width="7" height="${h}"/>`);
      pts.push([x, ground - h, 0], [x + 7, ground, 0]);
    } else if (p.mat) {
      // Seen from above: a mat under the whole body.
      const xs = Object.values(j).map((q) => q[0]), ys = Object.values(j).map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs) - 14, Math.max(...xs) + 14, Math.min(...ys) - 14, Math.max(...ys) + 14];
      back.push(`<rect class="prop mat" x="${f1(x0)}" y="${f1(y0)}" width="${f1(x1 - x0)}" height="${f1(y1 - y0)}" rx="6"/>`);
      pts.push([x0, y0, 0], [x1, y1, 0]);
    } else if (p.cushion) {
      const q = point(j, p.cushion);
      back.push(`<ellipse class="prop" cx="${f1(q[0])}" cy="${f1(ground - 3)}" rx="13" ry="4"/>`);
    }
  }

  for (const m of pose.marks ?? []) {
    if (m.arrow) {
      const a = point(j, m.arrow), len = m.len ?? 20, b = step(a, m.dir, len);
      over.push(`<line class="mark" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>${arrowHead(b, m.dir)}${m.both ? arrowHead(a, m.dir + 180) : ""}`);
      pts.push([a[0], a[1], 4], [b[0], b[1], 4]);
    } else if (m.turn) {
      const c = point(j, m.turn), r = m.r ?? 18;
      const a = step(c, m.from, r), b = step(c, m.to, r);
      const up = m.to > m.from;
      const large = Math.abs(m.to - m.from) > 180 ? 1 : 0;
      over.push(`<path class="mark" d="M${f1(a[0])} ${f1(a[1])}A${r} ${r} 0 ${large} ${up ? 0 : 1} ${f1(b[0])} ${f1(b[1])}"/>${arrowHead(b, m.to + (up ? 90 : -90))}${m.both ? arrowHead(a, m.from + (up ? -90 : 90)) : ""}`);
      pts.push([c[0] - r, c[1] - r, 4], [c[0] + r, c[1] + r, 4]);
    } else if (m.line) {
      const [a, b] = m.line.map((r) => point(j, r));
      const ext = m.ext ?? 12, ang = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
      const a2 = step(a, ang + 180, ext), b2 = step(b, ang, ext);
      over.push(`<line class="mark dashed" x1="${f1(a2[0])}" y1="${f1(a2[1])}" x2="${f1(b2[0])}" y2="${f1(b2[1])}"/>`);
      pts.push([a2[0], a2[1], 2], [b2[0], b2[1], 2]);
    }
  }

  const xs = pts.flatMap(([x, , r]) => [x - r, x + r]);
  const ys = pts.flatMap(([, y, r]) => [y - r, y + r]);
  return {
    svg: [...back, ...body, ...over].join(""),
    floor: pose.floor !== false && (ex.floor !== false),
    ground,
    minX: Math.min(...xs), maxX: Math.max(...xs),
    top: Math.min(...ys), bottom: Math.max(ground, ...ys),
  };
}

// The exercise as one SVG: its frames side by side (or just one with `only`).
// A thumbnail (`only: "key"`) keeps at least MIN_THUMB units, so a compact pose isn't
// blown up bigger than the others.
const MIN_THUMB = 120;

export function figureSVG(key, { only, label = "" } = {}) {
  const ex = POSES[key];
  if (!ex) return "";
  const poses = only == null ? ex.frames : [ex.frames[only === "key" ? ex.key ?? ex.frames.length - 1 : only]];
  const frames = poses.map((p) => frame(p, ex));
  const min = only == null ? 0 : MIN_THUMB;
  const w = Math.max(min, Math.max(...frames.map((f) => f.maxX - f.minX)) + 2 * PAD);
  let above = Math.max(...frames.map((f) => f.ground - f.top)) + PAD;
  const below = Math.max(...frames.map((f) => f.bottom - f.ground)) + PAD;
  above = Math.max(above, min - below);
  const h = above + below;
  const parts = frames.map((f, i) => {
    const ox = i * (w + GAP) + (w - (f.maxX - f.minX)) / 2 - f.minX;
    const oy = above - f.ground;
    const floor = f.floor ? `<line class="floor" x1="${f1(f.minX - 4)}" x2="${f1(f.maxX + 4)}" y1="${f1(f.ground)}" y2="${f1(f.ground)}"/>` : "";
    const next = i < frames.length - 1
      ? `<path class="next" d="M${f1((i + 1) * w + i * GAP + GAP / 2 - 4)} ${f1(h / 2 - 7)}l7 7l-7 7"/>` : "";
    return `<g transform="translate(${f1(ox)} ${f1(oy)})">${floor}${f.svg}</g>${next}`;
  });
  const width = frames.length * w + (frames.length - 1) * GAP;
  return `<svg class="fig" viewBox="0 0 ${f1(width)} ${f1(h)}" width="${Math.round(width * PX)}" height="${Math.round(h * PX)}" role="img" aria-label="${label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}">${parts.join("")}</svg>`;
}

export const hasFigure = (key) => key in POSES;
