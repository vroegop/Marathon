// Poses for the exercise pictures (drawn by figures.js), one entry per exercise key in
// plan/strength.toml (a test checks that every exercise has one).
//
// Angles: 0 down, 90 forward (right), 180 up, -90 back (left). Side view faces right;
// limb 1 is the near side (dark), 2 the far side (light). Front view: 1 is image-left.
//   t torso (pelvis -> neck), h head, a [[upper, fore, scale?], ...], l [[thigh, shin, foot, scale?], ...]
//   pt / st  front view: tilt of the hip / shoulder line; ts torso scale (foreshortening)
//   base + lift  which point rests on a support of that height (default: lowest point on the floor)
//   work  body parts drawn in the highlight colour: torso, upper1, fore1, thigh1, shin1, ...,
//         glute, pelvis, hip1, hip2
//   props kb, band, box (step, couch, chair), wall, cushion, anchor;  marks arrow, turn, line
// The last frame is the thumbnail unless `key` says otherwise.

const STAND = { t: 180, a: [[4, 8], [-4, -2]], l: [[2, 0, 90], [-2, 0, 90]] };
const GOBLET = [[15, 165], [15, 165]];
const PLANK = { t: 109, h: 100, a: [[0, 0], [0, 0]], l: [[-71, -71, 12], [-71, -71, 12]] };
const FRONT = { view: "front", t: 180, a: [[-6, -3], [6, 3]], l: [[-3, 0], [3, 0]] };

export const POSES = {
  "goblet-squat": {
    work: ["thigh1", "thigh2", "glute"],
    frames: [
      { ...STAND, a: GOBLET, props: [{ kb: "hand1" }], marks: [{ arrow: { at: "pelvis", dx: -20 }, dir: 0, len: 22 }] },
      { t: 145, a: [[5, 160], [5, 160]], l: [[80, -25, 90], [84, -22, 90]], props: [{ kb: "hand1" }] },
    ],
  },
  "reverse-lunge": {
    work: ["thigh1", "glute"],
    frames: [
      { ...STAND, marks: [{ arrow: { at: "ankle2", dx: -14, dy: -4 }, dir: -90, len: 22 }] },
      { t: 178, a: [[-4, 4], [4, 10]], l: [[80, -2, 90], [-20, -95, 45]], base: "ankle1", baseR: 3 },
    ],
  },
  "split-squat": {
    work: ["thigh1", "glute"],
    frames: [
      { t: 175, a: GOBLET, l: [[25, -8, 90], [-25, -88, -90]], props: [{ kb: "hand1" }, { box: "ankle2", pad: 4, w: 46, dx: -12 }],
        marks: [{ arrow: { at: "pelvis", dx: -18 }, dir: 0, len: 22 }] },
      { t: 172, a: GOBLET, l: [[82, -10, 90], [-10, -140, -90]], base: "ankle1", baseR: 3, props: [{ kb: "hand1" }, { box: "ankle2", pad: 4, w: 46, dx: -12 }] },
    ],
  },
  "step-up": {
    work: ["thigh1", "glute"],
    frames: [
      { t: 172, a: [[10, 15], [-4, 0]], l: [[70, -10, 90], [-8, 0, 90]], props: [{ kb: "hand2" }, { box: "ankle1", pad: 3, w: 46, dx: 8 }],
        marks: [{ arrow: { at: "pelvis", dx: -18, dy: 4 }, dir: 180, len: 22 }] },
      { t: 180, a: [[-25, -10], [10, 5]], l: [[0, 0, 90], [92, 2, 90]], base: "ankle1", baseR: 3, lift: 29, props: [{ kb: "hand2" }, { box: "ankle1", pad: 3, w: 46, dx: 8 }] },
    ],
  },
  "sl-rdl": {
    work: ["thigh1", "glute"],
    frames: [
      { ...STAND, l: [[0, 0, 90], [-12, -35, 60]], props: [{ kb: "hand2" }] },
      { t: 95, h: 100, a: [[2, 0], [-2, 0]], l: [[-3, 4, 90], [-92, -92, 0]], props: [{ kb: "hand2" }], marks: [{ line: ["head", "ankle2"], ext: 6 }] },
    ],
  },
  "kb-swing": {
    work: ["thigh1", "thigh2", "glute"],
    frames: [
      { t: 115, h: 105, a: [[-15, -25], [-15, -25]], l: [[22, -12, 90], [18, -14, 90]], props: [{ kb: "hand1", dir: -25 }] },
      { t: 182, a: [[85, 85], [85, 85]], l: [[1, 0, 90], [-1, 0, 90]], props: [{ kb: "hand1", dir: 85 }],
        marks: [{ turn: "neck", r: 66, from: 15, to: 70 }] },
    ],
  },
  "sl-glute-bridge": {
    work: ["glute", "thigh1"],
    frames: [
      { t: -90, h: -90, a: [[90, 90], [90, 90]], l: [[140, -2, 90], [215, 120, 150]],
        marks: [{ arrow: { at: "pelvis", dx: -8, dy: -14 }, dir: 180, len: 18 }] },
      { t: -66, h: -95, a: [[95, 90], [95, 90]], l: [[114, 0, 90], [190, 110, 150]], marks: [{ line: ["neck", "knee1"], ext: 8 }] },
    ],
  },
  "sl-hip-thrust": {
    work: ["glute", "thigh1"],
    frames: [
      { t: -130, h: -115, a: [[60, 60], [60, 60]], l: [[120, 38, 90], [170, 80, 150]], base: "ankle1", baseR: 3,
        props: [{ box: "neck", pad: 8, w: 40, dx: -18 }], marks: [{ arrow: { at: "pelvis", dx: 0, dy: 12 }, dir: 180, len: 18 }] },
      { t: -90, h: -80, a: [[60, 60], [60, 60]], l: [[90, 0, 90], [160, 70, 150]], props: [{ box: "neck", pad: 8, w: 40, dx: -18 }],
        marks: [{ line: ["neck", "knee1"], ext: 8 }] },
    ],
  },
  "calf-raise": {
    work: ["shin1"],
    frames: [
      { t: 180, a: [[70, 85], [-2, 0]], l: [[0, 0, 112], [-5, -85, -10]], base: "toe1", baseR: 3, lift: 22,
        props: [{ box: "toe1", pad: 3, w: 44, dx: 18 }, { wall: "hand1", dx: 2 }],
        marks: [{ arrow: { at: "ankle1", dx: -14, dy: -4 }, dir: 180, len: 18 }] },
      { t: 180, a: [[70, 85], [-2, 0]], l: [[0, 0, 35], [-5, -85, -10]], base: "toe1", baseR: 3, lift: 22,
        props: [{ box: "toe1", pad: 3, w: 44, dx: 18 }, { wall: "hand1", dx: 2 }] },
    ],
  },
  "bent-knee-calf": {
    work: ["shin1"],
    frames: [
      { t: 175, a: [[70, 85], [-2, 0]], l: [[22, -12, 112], [10, -80, -10]], base: "toe1", baseR: 3, lift: 22,
        props: [{ kb: "hand2" }, { box: "toe1", pad: 3, w: 44, dx: 18 }, { wall: "hand1", dx: 2 }],
        marks: [{ arrow: { at: "ankle1", dx: -14, dy: -4 }, dir: 180, len: 18 }] },
      { t: 175, a: [[70, 85], [-2, 0]], l: [[22, -12, 35], [10, -80, -10]], base: "toe1", baseR: 3, lift: 22,
        props: [{ kb: "hand2" }, { box: "toe1", pad: 3, w: 44, dx: 18 }, { wall: "hand1", dx: 2 }] },
    ],
  },
  "lateral-lunge": {
    view: "front",
    work: ["thigh1", "thigh2"],
    frames: [
      { ...FRONT, a: [[6, 130, [1, 0.55]], [-6, -130, [1, 0.55]]], l: [[-32, -32], [32, 32]], props: [{ kb: "hand1" }] },
      { ...FRONT, a: [[6, 130, [1, 0.55]], [-6, -130, [1, 0.55]]], l: [[-60, 5], [42, 42]], props: [{ kb: "hand1" }] },
    ],
  },
  "band-walk": {
    view: "front",
    work: ["hip1", "hip2"],
    frames: [
      { ...FRONT, a: [[-25, 37], [25, -37]], l: [[-6, -2], [6, 2]], props: [{ band: [{ at: "knee1", dy: -6 }, { at: "knee2", dy: -6 }] }] },
      { ...FRONT, a: [[-25, 37], [25, -37]], l: [[-6, -2], [24, 18]], base: "ankle1", baseR: 3,
        props: [{ band: [{ at: "knee1", dy: -6 }, { at: "knee2", dy: -6 }] }], marks: [{ arrow: { at: "ankle2", dx: 12, dy: -6 }, dir: 90, len: 18 }] },
    ],
  },
  "hip-airplane": {
    work: ["glute"],
    frames: [
      { t: 98, h: 100, a: [[60, 60], [2, 0]], l: [[-95, -95, 0], [-2, 3, 90]], base: "ankle2", baseR: 3, props: [{ wall: "hand1", dx: 3 }] },
      { t: 98, h: 120, a: [[60, 60], [175, 178]], l: [[-108, -108, 0], [-2, 3, 90]], base: "ankle2", baseR: 3, props: [{ wall: "hand1", dx: 3 }],
        marks: [{ turn: "pelvis", r: 24, from: 140, to: 230, both: true }] },
    ],
  },
  "hip-hike": {
    view: "front",
    work: ["hip1"],
    frames: [
      { ...FRONT, hw: 1.3, pt: -30, a: [[-10, -6], [10, 6]], l: [[0, 0], [0, 0]], base: "ankle1", baseR: 3, lift: 22,
        props: [{ box: "ankle1", pad: 3, w: 30, dx: -4 }], marks: [{ line: ["hip1", "hip2"], ext: 22 }, { arrow: { at: "ankle2", dx: 14, dy: 0 }, dir: 180, len: 18 }] },
      { ...FRONT, hw: 1.3, pt: 18, a: [[-10, -6], [10, 6]], l: [[0, 0], [0, 0]], base: "ankle1", baseR: 3, lift: 22,
        props: [{ box: "ankle1", pad: 3, w: 30, dx: -4 }], marks: [{ line: ["hip1", "hip2"], ext: 22 }] },
    ],
  },
  "side-plank-lift": {
    view: "front",
    work: ["torso", "hip2"],
    frames: [
      { t: -112, h: -112, a: [[0, -90, [1, 0.6]], [70, 50]], l: [[68, 150, 90, [1, 0.6, 0.5]], [68, 150, 90, [1, 0.6, 0.5]]],
        marks: [{ line: ["neck", "knee1"], ext: 10 }] },
      { t: -112, h: -112, a: [[0, -90, [1, 0.6]], [70, 50]], l: [[68, 150, 90, [1, 0.6, 0.5]], [84, 84, 84]],
        marks: [{ arrow: { at: "ankle2", dx: 6, dy: -12 }, dir: 180, len: 16 }] },
    ],
  },
  "copenhagen": {
    view: "front",
    work: ["thigh2", "torso"],
    frames: [
      { t: -100, h: -100, a: [[0, -90, [1, 0.6]], [70, 121]], l: [[75, 60], [80, 90, 90]],
        props: [{ box: "knee2", pad: 6, w: 64, dx: 24 }], marks: [{ line: ["neck", "knee2"], ext: 10 }] },
    ],
  },
  "pallof-press": {
    work: ["torso"],
    frames: [
      { ...STAND, a: [[20, 160], [20, 160]], props: [{ wall: "pelvis", dx: -4, h: 160 }, { band: [[0, -40], "hand1"] }] },
      { ...STAND, a: [[88, 90], [88, 90]], props: [{ wall: "pelvis", dx: -4, h: 160 }, { band: [[0, -40], "hand1"] }] },
    ],
  },
  "band-chop": {
    work: ["torso"],
    frames: [
      { t: 180, a: [[200, 200], [196, 198]], l: [[0, -90, -90], [85, 0, 90]], props: [{ anchor: [-26, -118] }, { band: [[-26, -118], "hand1"] }] },
      { t: 178, a: [[40, 60], [36, 60]], l: [[0, -90, -90], [85, 0, 90]], props: [{ anchor: [-26, -118] }, { band: [[-26, -118], "hand1"] }] },
    ],
  },
  "dead-bug": {
    work: ["torso"],
    frames: [
      { t: -90, h: -90, a: [[180, 180], [176, 178]], l: [[180, 90, 150], [176, 88, 150]] },
      { t: -90, h: -90, a: [[180, 180], [-100, -95]], l: [[100, 97, 120], [176, 88, 150]] },
    ],
  },
  "plank-taps": {
    work: ["torso"],
    frames: [
      { ...PLANK, marks: [{ line: ["neck", "ankle1"], ext: 10 }] },
      { ...PLANK, a: [[-20, 160], [0, 0]], base: "hand2", baseR: 4 },
    ],
  },
  "suitcase-carry": {
    view: "front",
    work: ["torso", "hip1"],
    frames: [
      { ...FRONT, a: [[-12, -6], [10, 4]], props: [{ kb: "hand2" }], marks: [{ line: ["shoulder1", "shoulder2"], ext: 14 }] },
    ],
  },
  "farmer-carry": {
    view: "front",
    work: ["fore1", "fore2", "torso"],
    frames: [
      { ...FRONT, a: [[-12, -6], [12, 6]], props: [{ kb: "hand1" }, { kb: "hand2" }], marks: [{ line: ["shoulder1", "shoulder2"], ext: 14 }] },
    ],
  },
  "kb-twist": {
    view: "front",
    work: ["torso"],
    frames: [
      { view: "front", t: 184, ts: 0.85, sw: 0.6, a: [[-50, 11, [1, 0.9]], [-39, -39]], l: [[200, 0, -90, 0.5], [160, 0, 90, 0.5]], props: [{ kb: "hand1" }],
        marks: [{ arrow: { at: "head", dx: -22, dy: -18 }, dir: 90, len: 44, both: true }] },
      { view: "front", t: 176, ts: 0.85, sw: 0.6, a: [[39, 39], [50, -11, [1, 0.9]]], l: [[200, 0, -90, 0.5], [160, 0, 90, 0.5]], props: [{ kb: "hand2" }] },
    ],
  },
  "push-up": {
    work: ["upper1", "torso"],
    frames: [
      { ...PLANK, marks: [{ line: ["neck", "ankle1"], ext: 10 }] },
      { t: 92, h: 95, a: [[-101, 30], [-101, 30]], l: [[-88, -88, 0], [-88, -88, 0]], marks: [{ line: ["neck", "ankle1"], ext: 10 }] },
    ],
  },
  "kb-row": {
    work: ["upper1"],
    frames: [
      { t: 92, h: 100, a: [[0, 0], [30, -30]], l: [[0, 0, 90], [0, -90, -90]], props: [{ box: "knee2", pad: 6, w: 84, dx: 26 }, { kb: "hand1" }] },
      { t: 92, h: 100, a: [[-150, 0], [30, -30]], l: [[0, 0, 90], [0, -90, -90]], props: [{ box: "knee2", pad: 6, w: 84, dx: 26 }, { kb: "hand1" }],
        marks: [{ arrow: { at: "hand1", dx: 14, dy: 30 }, dir: 180, len: 22 }] },
    ],
  },
  "kb-press": {
    work: ["upper1", "torso"],
    frames: [
      { t: 180, a: [[12, 172], [8, 4]], l: [[0, -90, -90], [85, 0, 90]], props: [{ kb: "hand1", dir: -130 }],
        marks: [{ arrow: { at: "hand1", dx: 14, dy: -6 }, dir: 180, len: 20 }] },
      { t: 180, a: [[178, 180], [8, 4]], l: [[0, -90, -90], [85, 0, 90]], props: [{ kb: "hand1", dir: -150 }] },
    ],
  },
  "jumping-jacks": {
    view: "front",
    work: ["shin1", "shin2"],
    frames: [
      { ...FRONT },
      { ...FRONT, a: [[205, 195], [155, 165]], l: [[-16, -16], [16, 16]], air: 6 },
    ],
  },
  "pogo-hops": {
    work: ["shin1", "shin2"],
    frames: [
      { t: 180, a: [[10, 70], [-6, 60]], l: [[2, 0, 40], [-2, 0, 40]] },
      { t: 180, a: [[10, 70], [-6, 60]], l: [[2, 0, 30], [-2, 0, 30]], air: 10,
        marks: [{ arrow: { at: "ankle1", dx: -16, dy: 6 }, dir: 180, len: 16, both: true }] },
    ],
  },
  "sl-pogo": {
    work: ["shin1", "pelvis"],
    frames: [
      { t: 180, a: [[10, 70], [-6, 60]], l: [[0, 0, 40], [10, -80, -20]] },
      { t: 180, a: [[10, 70], [-6, 60]], l: [[0, 0, 30], [10, -80, -20]], air: 10,
        marks: [{ arrow: { at: "ankle1", dx: -16, dy: 6 }, dir: 180, len: 16, both: true }] },
    ],
  },
  "bear-crawl": {
    work: ["torso", "upper1"],
    frames: [
      { t: 88, h: 100, a: [[0, 0], [0, 0]], l: [[0, -92, 20], [4, -90, 20]] },
      { t: 88, h: 100, a: [[22, 10], [0, 0]], l: [[0, -92, 20], [32, -62, 20]], base: "toe1", baseR: 3,
        marks: [{ arrow: { at: "neck", dx: 20, dy: -18 }, dir: 90, len: 20 }] },
    ],
  },
  "burpee": {
    work: ["thigh1", "thigh2", "upper1"],
    key: 1,
    frames: [
      { t: 128, h: 120, a: [[12, 8], [8, 6]], l: [[100, -30, 90], [104, -28, 90]] },
      { t: 92, h: 95, a: [[-101, 30], [-101, 30]], l: [[-88, -88, 0], [-88, -88, 0]] },
      { t: 180, a: [[155, 160], [148, 155]], l: [[2, 0, 30], [-2, 0, 30]], air: 14 },
    ],
  },

  // mobility
  "leg-swings": {
    work: ["thigh1"],
    frames: [
      { t: 180, a: [[-10, 60], [0, 0]], l: [[60, 45, 110], [-2, 0, 90]], base: "ankle2", baseR: 3, props: [{ wall: "pelvis", dx: -4, h: 160 }],
        marks: [{ turn: "pelvis", r: 70, from: 60, to: -25, both: true }] },
      { t: 180, a: [[-10, 60], [0, 0]], l: [[-32, -38, 50], [-2, 0, 90]], base: "ankle2", baseR: 3, props: [{ wall: "pelvis", dx: -4, h: 160 }] },
    ],
  },
  "hip-cars": {
    work: ["pelvis"],
    frames: [
      { t: 180, a: [[-10, 60], [0, 0]], l: [[95, 5, 90], [-2, 0, 90]], base: "ankle2", baseR: 3, props: [{ wall: "pelvis", dx: -4, h: 160 }],
        marks: [{ turn: "pelvis", r: 30, from: 110, to: 300 }] },
      { t: 180, a: [[-10, 60], [0, 0]], l: [[-40, -100, -40], [-2, 0, 90]], base: "ankle2", baseR: 3, props: [{ wall: "pelvis", dx: -4, h: 160 }] },
    ],
  },
  "ninety-ninety": {
    view: "front",
    floor: false,
    work: ["hip1", "hip2"],
    frames: [
      { view: "front", t: 180, ts: 0.85, a: [[-30, -20], [30, 20]], l: [[-100, 160, 180, [0.95, 0.35, 0.3]], [50, -82, -90, [0.8, 0.85, 0.6]]],
        marks: [{ turn: "pelvis", r: 30, from: -60, to: 60, both: true }] },
      { view: "front", t: 180, ts: 0.85, a: [[-30, -20], [30, 20]], l: [[-50, 82, 90, [0.8, 0.85, 0.6]], [100, -160, 180, [0.95, 0.35, 0.3]]] },
    ],
  },
  "worlds-greatest": {
    work: ["thigh2", "torso"],
    frames: [
      { t: 100, h: 110, a: [[12, 30], [-5, 0]], l: [[80, -5, 90], [-55, -75, 20]] },
      { t: 100, h: 160, a: [[180, 180], [-5, 0]], l: [[80, -5, 90], [-55, -75, 20]], marks: [{ turn: "neck", r: 30, from: 40, to: 160 }] },
    ],
  },
  "hip-flexor-stretch": {
    work: ["thigh1"],
    frames: [
      { t: 182, a: [[176, 170], [40, 20]], l: [[-15, -90, -90], [86, -8, 90]], props: [{ cushion: "knee1" }] },
    ],
  },
  "open-book": {
    floor: false,
    work: ["torso"],
    frames: [
      { t: 90, h: 90, a: [[0, 0], [4, 4]], l: [[0, -90, -90], [4, -88, -90]], props: [{ mat: true }] },
      { t: 90, h: 90, a: [[180, 180], [4, 4]], l: [[0, -90, -90], [4, -88, -90]], props: [{ mat: true }], marks: [{ turn: "neck", r: 44, from: 15, to: 165 }] },
    ],
  },
  "ankle-rocks": {
    work: ["shin1"],
    frames: [
      { t: 180, a: [[30, 60], [30, 60]], l: [[85, -5, 90], [0, -90, -90]], base: "ankle1", baseR: 3, props: [{ wall: "toe1", dx: 13 }] },
      { t: 175, a: [[40, 70], [40, 70]], l: [[85, -30, 90], [-25, -90, -90]], base: "ankle1", baseR: 3, props: [{ wall: "toe1", dx: 13 }] },
    ],
  },
  "calf-stretch": {
    work: ["shin1"],
    frames: [
      { t: 150, a: [[100, 100], [100, 100]], l: [[-28, -28, 90], [30, -20, 90]], base: "ankle1", baseR: 3, props: [{ wall: "hand1", dx: 3 }] },
      { t: 150, a: [[100, 100], [100, 100]], l: [[-20, -35, 90], [30, -20, 90]], base: "ankle1", baseR: 3, props: [{ wall: "hand1", dx: 3 }] },
    ],
  },
  "figure-four": {
    work: ["glute"],
    frames: [
      { t: -90, h: -90, a: [[120, 108], [120, 108]], l: [[130, -110, 170], [190, 100, 150]] },
    ],
  },
  "adductor-rockback": {
    work: ["thigh1"],
    frames: [
      { t: 102, h: 105, a: [[0, 0], [0, 0]], l: [[0, 0, 90, 0.57], [0, -90, -90]], base: "knee2", baseR: 6 },
      { t: 115, h: 110, a: [[-12, 0], [-12, 0]], l: [[-10, -10, 90, 0.45], [40, -90, -90]], base: "ankle2", baseR: 3,
        marks: [{ arrow: { at: "pelvis", dx: -6, dy: -18 }, dir: -90, len: 20 }] },
    ],
  },
  "deep-squat-hold": {
    work: ["pelvis", "shin1"],
    frames: [
      { t: 155, a: [[30, 160], [30, 160]], l: [[100, -32, 90], [104, -30, 90]], props: [{ kb: "hand1" }] },
    ],
  },
};
