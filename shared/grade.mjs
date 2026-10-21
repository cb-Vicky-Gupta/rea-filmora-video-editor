// Color grading. A clip's grade (plus an optional imported .cube LUT) is baked into one 3D LUT:
// the preview uploads it as a 3D texture and the export writes it as a .cube file for ffmpeg's
// lut3d filter, so both apply exactly the same color transform. Vignette is spatial, so it is
// handled separately (shader / ffmpeg vignette filter).

export const LUT_SIZE = 33;

export const DEFAULT_GRADE = {
  exposure: 0, // stops, -2..2
  contrast: 0, // -1..1
  highlights: 0, // -1..1
  shadows: 0, // -1..1
  whites: 0, // -1..1
  blacks: 0, // -1..1
  temperature: 0, // -1 (cool) .. 1 (warm)
  tint: 0, // -1 (green) .. 1 (magenta)
  saturation: 0, // -1 (mono) .. 1
  vibrance: 0, // -1..1
  hue: 0, // degrees
  fade: 0, // 0..1, lifts blacks
  shadowTint: { hue: 200, amount: 0 }, // split toning
  highlightTint: { hue: 35, amount: 0 },
  vignette: 0, // 0..1
  lut: null, // { path, name } of an imported .cube file
  lutIntensity: 1,
};

// Built-in looks (ReaCut originals).
export const LOOKS = [
  { id: 'none', name: 'Original', grade: {} },
  { id: 'vivid', name: 'Vivid', grade: { saturation: 0.3, vibrance: 0.3, contrast: 0.12 } },
  { id: 'warm', name: 'Warm', grade: { temperature: 0.45, vibrance: 0.15 } },
  { id: 'cool', name: 'Cool', grade: { temperature: -0.45, tint: -0.05 } },
  {
    id: 'teal-orange',
    name: 'Teal & Orange',
    grade: { contrast: 0.15, shadowTint: { hue: 190, amount: 0.55 }, highlightTint: { hue: 30, amount: 0.45 }, vibrance: 0.2 },
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    grade: { contrast: 0.2, highlights: -0.3, shadows: 0.1, saturation: -0.15, shadowTint: { hue: 210, amount: 0.35 }, vignette: 0.35 },
  },
  { id: 'golden', name: 'Golden Hour', grade: { temperature: 0.6, exposure: 0.1, highlightTint: { hue: 40, amount: 0.4 }, vibrance: 0.2 } },
  { id: 'moody', name: 'Moody', grade: { exposure: -0.25, contrast: 0.25, saturation: -0.3, blacks: -0.2, vignette: 0.5 } },
  { id: 'faded', name: 'Faded', grade: { fade: 0.5, contrast: -0.15, saturation: -0.2 } },
  {
    id: 'vintage',
    name: 'Vintage',
    grade: { fade: 0.35, temperature: 0.3, saturation: -0.35, highlightTint: { hue: 45, amount: 0.3 }, vignette: 0.4 },
  },
  { id: 'pastel', name: 'Pastel', grade: { exposure: 0.2, contrast: -0.3, fade: 0.2, vibrance: 0.25 } },
  { id: 'sepia', name: 'Sepia', grade: { saturation: -1, shadowTint: { hue: 30, amount: 0.5 }, highlightTint: { hue: 40, amount: 0.5 } } },
  { id: 'bw', name: 'B&W', grade: { saturation: -1, contrast: 0.1 } },
  { id: 'noir', name: 'Noir', grade: { saturation: -1, contrast: 0.5, blacks: -0.3, vignette: 0.55 } },
].map((l) => ({ ...l, grade: { ...DEFAULT_GRADE, ...l.grade } }));

export const clipGrade = (c) => ({ ...DEFAULT_GRADE, ...c.grade });

const COLOR_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'saturation', 'vibrance', 'hue', 'fade'];

// True when the grade changes colors (vignette aside), i.e. a LUT is needed.
export function needsLut(grade) {
  return (
    COLOR_KEYS.some((k) => grade[k] !== 0) ||
    grade.shadowTint.amount > 0 ||
    grade.highlightTint.amount > 0 ||
    (!!grade.lut && grade.lutIntensity > 0)
  );
}

// Stable key for caching baked LUTs.
export function gradeKey(grade) {
  const g = { ...grade, vignette: 0 };
  return JSON.stringify(g);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Fully saturated color for a hue, centred on zero so it shifts color without changing brightness much.
function hueOffset(h) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const r = f(0);
  const g = f(8);
  const b = f(4);
  const m = luma(r, g, b);
  return [r - m, g - m, b - m];
}

function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

// Trilinear sample of a parsed .cube LUT.
function sampleCube(cube, r, g, b) {
  const n = cube.size;
  const d = cube.data;
  const fr = clamp01((r - cube.min[0]) / (cube.max[0] - cube.min[0])) * (n - 1);
  const fg = clamp01((g - cube.min[1]) / (cube.max[1] - cube.min[1])) * (n - 1);
  const fb = clamp01((b - cube.min[2]) / (cube.max[2] - cube.min[2])) * (n - 1);
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(n - 1, r0 + 1), g1 = Math.min(n - 1, g0 + 1), b1 = Math.min(n - 1, b0 + 1);
  const tr = fr - r0, tg = fg - g0, tb = fb - b0;
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const at = (ri, gi, bi) => d[(ri + gi * n + bi * n * n) * 3 + ch];
    const c00 = at(r0, g0, b0) * (1 - tr) + at(r1, g0, b0) * tr;
    const c10 = at(r0, g1, b0) * (1 - tr) + at(r1, g1, b0) * tr;
    const c01 = at(r0, g0, b1) * (1 - tr) + at(r1, g0, b1) * tr;
    const c11 = at(r0, g1, b1) * (1 - tr) + at(r1, g1, b1) * tr;
    out[ch] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
  }
  return out;
}

// Returns a function mapping an input RGB (0..1) to the graded RGB (0..1).
export function makeGradeFn(grade, cube) {
  const expo = Math.pow(2, grade.exposure);
  const tempR = 1 + 0.2 * grade.temperature + 0.05 * grade.tint;
  const tempG = 1 - 0.12 * grade.tint;
  const tempB = 1 - 0.2 * grade.temperature + 0.05 * grade.tint;
  const contrast = 1 + grade.contrast;
  const fade = grade.fade;
  const sat = 1 + grade.saturation;
  const vib = grade.vibrance;
  const sTone = hueOffset(grade.shadowTint.hue).map((v) => v * grade.shadowTint.amount * 0.5);
  const hTone = hueOffset(grade.highlightTint.hue).map((v) => v * grade.highlightTint.amount * 0.5);
  const hm = grade.hue ? hueMatrix(grade.hue) : null;
  const useLut = cube && grade.lutIntensity > 0;

  return (r, g, b) => {
    if (useLut) {
      const [lr, lg, lb] = sampleCube(cube, r, g, b);
      const k = grade.lutIntensity;
      r += (lr - r) * k;
      g += (lg - g) * k;
      b += (lb - b) * k;
    }
    // White balance and exposure.
    r *= expo * tempR;
    g *= expo * tempG;
    b *= expo * tempB;
    // Contrast around mid grey.
    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;
    // Tonal ranges, weighted by luminance.
    let L = clamp01(luma(r, g, b));
    const tonal =
      grade.shadows * 0.25 * (1 - smooth(0, 0.55, L)) +
      grade.highlights * 0.25 * smooth(0.45, 1, L) +
      grade.blacks * 0.15 * (1 - smooth(0, 0.25, L)) +
      grade.whites * 0.15 * smooth(0.75, 1, L);
    r += tonal;
    g += tonal;
    b += tonal;
    // Split toning.
    L = clamp01(luma(r, g, b));
    const ws = (1 - L) * (1 - L);
    const wh = L * L;
    r += sTone[0] * ws + hTone[0] * wh;
    g += sTone[1] * ws + hTone[1] * wh;
    b += sTone[2] * ws + hTone[2] * wh;
    // Saturation and vibrance (boosts muted colors more than saturated ones).
    L = luma(r, g, b);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const s = Math.max(0, sat * (1 + vib * (1 - clamp01(chroma))));
    r = L + (r - L) * s;
    g = L + (g - L) * s;
    b = L + (b - L) * s;
    if (hm) {
      [r, g, b] = [
        hm[0] * r + hm[1] * g + hm[2] * b,
        hm[3] * r + hm[4] * g + hm[5] * b,
        hm[6] * r + hm[7] * g + hm[8] * b,
      ];
    }
    // Fade: lift blacks, soften whites.
    if (fade) {
      r = r * (1 - 0.2 * fade) + 0.12 * fade;
      g = g * (1 - 0.2 * fade) + 0.12 * fade;
      b = b * (1 - 0.2 * fade) + 0.12 * fade;
    }
    return [clamp01(r), clamp01(g), clamp01(b)];
  };
}

// Bakes a grade into an RGB float LUT (red varies fastest, as in .cube files).
export function bakeLut(grade, cube, size = LUT_SIZE) {
  const fn = makeGradeFn(grade, cube);
  const data = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = fn(r / (size - 1), g / (size - 1), b / (size - 1));
        data[i++] = out[0];
        data[i++] = out[1];
        data[i++] = out[2];
      }
    }
  }
  return { size, data };
}

export function lutToCube({ size, data }) {
  const lines = ['TITLE "ReaCut grade"', `LUT_3D_SIZE ${size}`];
  for (let i = 0; i < data.length; i += 3) {
    lines.push(`${data[i].toFixed(6)} ${data[i + 1].toFixed(6)} ${data[i + 2].toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}

export function parseCube(text) {
  let size = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') size = +parts[1];
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported; use a 3D .cube LUT.');
    else if (/^[-+\d.]/.test(parts[0]) && parts.length >= 3) values.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || values.length !== size * size * size * 3) throw new Error('Not a valid 3D .cube LUT.');
  return { size, min, max, data: Float32Array.from(values) };
}
