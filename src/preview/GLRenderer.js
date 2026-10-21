// WebGL2 compositor for the preview. It mirrors the export pipeline: grade LUT and vignette on the
// source frame, fit into the project frame, keyframed transform and opacity over black, then
// the transition formulas of ffmpeg's xfade filter between the outgoing and incoming clip.
// Overlay tracks are drawn on top afterwards with alpha blending.
import { TRANSITION_IDS } from '../../shared/model.mjs';
import { LUT_SIZE, bakeLut, gradeKey, needsLut } from '../../shared/grade.mjs';

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const T = Object.fromEntries(TRANSITION_IDS.map((id, i) => [id, i]));

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform vec2 uRes;     // project size in pixels
uniform vec2 uCanvas;  // canvas size in pixels
uniform int uTrans;    // -1: none
uniform bool uOverlay; // draw layer 0 as a transparent overlay instead of over black
uniform float uProg;   // xfade progress: 1 at the start of the transition, 0 at the end

// Layer 0 is the current clip (xfade's second input), layer 1 the outgoing clip (first input).
uniform bool uOn[2];
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform sampler3D uLut0;
uniform sampler3D uLut1;
uniform bool uHasLut[2];
uniform vec2 uSrc[2];
uniform vec4 uXf[2];   // x, y (fraction of frame), scale, rotation (radians)
uniform float uOp[2];
uniform float uVig[2];

out vec4 outColor;

vec3 shade(vec3 col, vec2 uv, int i) {
  if (uHasLut[i]) {
    float n = float(${LUT_SIZE});
    vec3 c = col * (n - 1.0) / n + 0.5 / n;
    col = i == 0 ? texture(uLut0, c).rgb : texture(uLut1, c).rgb;
  }
  if (uVig[i] > 0.0) {
    float dn = length((uv - 0.5) * uSrc[i]) / length(uSrc[i] * 0.5);
    float c = cos(uVig[i] * 1.5707963 * dn);
    col *= dn > 1.0 ? 0.0 : c * c * c * c;
  }
  return col;
}

// Straight color of layer i at p, with alpha = coverage * source alpha * opacity.
vec4 sampleLayer(int i, vec2 p) {
  if (!uOn[i]) return vec4(0.0);
  vec4 xf = uXf[i];
  vec2 d = (p - xf.xy * uRes) / xf.z;
  float cs = cos(xf.w);
  float sn = sin(xf.w);
  vec2 q = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y) + uRes * 0.5;
  float fit = min(uRes.x / uSrc[i].x, uRes.y / uSrc[i].y);
  vec2 rs = uSrc[i] * fit;
  vec2 uv = (q - (uRes - rs) * 0.5) / rs;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  vec4 col = i == 0 ? texture(uTex0, uv) : texture(uTex1, uv);
  return vec4(shade(col.rgb, uv, i), col.a * uOp[i]);
}

// Layer i over black.
vec3 layer(int i, vec2 p) {
  vec4 c = sampleLayer(i, p);
  return c.rgb * c.a;
}

// xfade's mix(a, b, m) = a * m + b * (1 - m)
vec3 xm(vec3 a, vec3 b, float m) { return mix(b, a, m); }
float frand(vec2 p) { return fract(sin(p.x * 12.9898 + p.y * 78.233) * 43758.545); }
float wrap(float v, float n) { return v - n * floor(v / n); }

vec3 transition(vec2 p) {
  float P = uProg;
  float W = uRes.x;
  float H = uRes.y;
  float x = p.x;
  float y = p.y;
  int t = uTrans;
  vec3 black = vec3(0.0);
  if (t == ${T.fade}) return xm(layer(1, p), layer(0, p), P);
  if (t == ${T.fadeblack} || t == ${T.fadewhite}) {
    vec3 bg = t == ${T.fadeblack} ? black : vec3(1.0);
    return xm(xm(layer(1, p), bg, smoothstep(0.8, 1.0, P)), xm(bg, layer(0, p), smoothstep(0.2, 1.0, P)), P);
  }
  if (t == ${T.wipeleft}) return x > W * P ? layer(0, p) : layer(1, p);
  if (t == ${T.wiperight}) return x > W * (1.0 - P) ? layer(1, p) : layer(0, p);
  if (t == ${T.wipeup}) return y > H * P ? layer(0, p) : layer(1, p);
  if (t == ${T.wipedown}) return y > H * (1.0 - P) ? layer(1, p) : layer(0, p);
  if (t == ${T.slideleft} || t == ${T.slideright}) {
    float zx = (t == ${T.slideleft} ? -P : P) * W + x;
    vec2 q = vec2(wrap(zx, W), y);
    return zx >= 0.0 && zx < W ? layer(0, q) : layer(1, q);
  }
  if (t == ${T.slideup} || t == ${T.slidedown}) {
    float zy = (t == ${T.slideup} ? -P : P) * H + y;
    vec2 q = vec2(x, wrap(zy, H));
    return zy >= 0.0 && zy < H ? layer(0, q) : layer(1, q);
  }
  float s = 0.0;
  if (t == ${T.smoothleft}) s = 1.0 + x / W - P * 2.0;
  else if (t == ${T.smoothright}) s = 1.0 + (W - 1.0 - x) / W - P * 2.0;
  else if (t == ${T.smoothup}) s = 1.0 + y / H - P * 2.0;
  else if (t == ${T.smoothdown}) s = 1.0 + (H - 1.0 - y) / H - P * 2.0;
  else if (t == ${T.horzopen}) s = 2.0 - abs((y - H / 2.0) / (H / 2.0)) - P * 2.0;
  else if (t == ${T.vertopen}) s = 2.0 - abs((x - W / 2.0) / (W / 2.0)) - P * 2.0;
  else if (t == ${T.radial}) s = atan(x - W / 2.0, y - H / 2.0) - (P - 0.5) * (3.14159265 * 2.5);
  else if (t == ${T.circleopen}) {
    s = length(vec2(x - W / 2.0, y - H / 2.0)) / length(vec2(W, H) / 2.0) + (P - 0.5) * 3.0;
    return xm(layer(1, p), layer(0, p), smoothstep(0.0, 1.0, s));
  } else if (t == ${T.circleclose}) {
    s = length(vec2(x - W / 2.0, y - H / 2.0)) / length(vec2(W, H) / 2.0) + (0.5 - P) * 3.0;
  } else if (t == ${T.circlecrop}) {
    float z = pow(2.0 * abs(P - 0.5), 3.0) * length(vec2(W, H) / 2.0);
    vec3 val = P < 0.5 ? layer(0, p) : layer(1, p);
    return z < length(vec2(x - W / 2.0, y - H / 2.0)) ? black : val;
  } else if (t == ${T.rectcrop}) {
    bool inside = abs(x - W / 2.0) < abs(P - 0.5) * W && abs(y - H / 2.0) < abs(P - 0.5) * H;
    return inside ? (P < 0.5 ? layer(0, p) : layer(1, p)) : black;
  } else if (t == ${T.dissolve}) {
    return frand(floor(p)) * 2.0 + P * 2.0 - 1.5 >= 0.5 ? layer(1, p) : layer(0, p);
  } else if (t == ${T.zoomin}) {
    float zf = smoothstep(0.5, 1.0, P);
    vec2 uv = 0.5 + (p / uRes - 0.5) * zf;
    return xm(layer(1, ceil(uv * (uRes - 1.0))), layer(0, p), smoothstep(0.0, 0.5, P));
  }
  return xm(layer(0, p), layer(1, p), smoothstep(0.0, 1.0, s));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) * uRes / uCanvas;
  if (uOverlay) {
    outColor = sampleLayer(0, p);
    return;
  }
  vec3 col = uTrans < 0 ? layer(0, p) : transition(p);
  outColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

export class GLRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = new Proxy(
      {},
      { get: (cache, name) => (cache[name] ??= gl.getUniformLocation(prog, name)) },
    );
    gl.uniform1i(this.u.uTex0, 0);
    gl.uniform1i(this.u.uTex1, 1);
    gl.uniform1i(this.u.uLut0, 2);
    gl.uniform1i(this.u.uLut1, 3);

    this.textures = new WeakMap(); // source element -> { tex, w, h }
    this.luts = new Map(); // grade key -> 3D texture
    this.blank3d = this.makeLut(new Float32Array(2 * 2 * 2 * 3), 2);
    this.blank2d = this.makeTex();
  }

  makeTex() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    return tex;
  }

  makeLut(data, size) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
      gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, size, size, size, 0, gl.RGB, gl.FLOAT, data);
    return tex;
  }

  lutFor(grade, cube) {
    const key = gradeKey(grade) + (cube ? ':cube' : '');
    let tex = this.luts.get(key);
    if (!tex) {
      const { data, size } = bakeLut(grade, cube);
      tex = this.makeLut(data, size);
      this.luts.set(key, tex);
      if (this.luts.size > 24) {
        const [oldKey, oldTex] = this.luts.entries().next().value;
        this.gl.deleteTexture(oldTex);
        this.luts.delete(oldKey);
      }
    }
    return tex;
  }

  // Uploads the source's current frame; returns its size, or null if no frame is available yet.
  upload(source, unit) {
    const gl = this.gl;
    let entry = this.textures.get(source);
    if (!entry) {
      entry = { tex: this.makeTex(), w: 0, h: 0, static: false };
      this.textures.set(source, entry);
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    const isVideo = source instanceof HTMLVideoElement;
    const ready = isVideo
      ? source.readyState >= 2 && source.videoWidth > 0
      : source.complete && source.naturalWidth > 0;
    if (ready && !entry.static) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      entry.w = isVideo ? source.videoWidth : source.naturalWidth;
      entry.h = isVideo ? source.videoHeight : source.naturalHeight;
      entry.static = !isVideo;
      entry.src = source.currentSrc || source.src;
    }
    // A pooled <video> that just switched files still holds the previous file's frame; never show it.
    if (entry.src !== (source.currentSrc || source.src)) return null;
    return entry.w ? entry : null;
  }

  setLayer(i, layer) {
    const gl = this.gl;
    const entry = layer?.source && this.upload(layer.source, i);
    if (!entry) {
      gl.uniform1i(gl.getUniformLocation(this.prog, `uOn[${i}]`), 0);
      return;
    }
    const at = (name) => gl.getUniformLocation(this.prog, `${name}[${i}]`);
    gl.uniform1i(at('uOn'), 1);
    gl.uniform2f(at('uSrc'), entry.w, entry.h);
    gl.uniform4f(
      at('uXf'),
      layer.x,
      layer.y,
      Math.max(0.001, layer.scale),
      (layer.rotation * Math.PI) / 180,
    );
    gl.uniform1f(at('uOp'), layer.opacity);
    gl.uniform1f(at('uVig'), layer.grade.vignette);
    const useLut = needsLut(layer.grade) && (!layer.grade.lut || layer.cube);
    gl.uniform1i(at('uHasLut'), useLut ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2 + i);
    gl.bindTexture(gl.TEXTURE_3D, useLut ? this.lutFor(layer.grade, layer.cube) : this.blank3d);
  }

  draw(width, height, scene) {
    const gl = this.gl;
    const { canvas } = this;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uRes, width, height);
    gl.uniform2f(this.u.uCanvas, canvas.width, canvas.height);
    // Every sampler needs a texture bound, even for layers that aren't drawn.
    for (const unit of [0, 1]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.blank2d);
      gl.activeTexture(gl.TEXTURE2 + unit);
      gl.bindTexture(gl.TEXTURE_3D, this.blank3d);
    }
    gl.disable(gl.BLEND);
    gl.uniform1i(this.u.uOverlay, 0);
    this.setLayer(0, scene.current);
    this.setLayer(1, scene.prev);
    gl.uniform1i(this.u.uTrans, scene.transition ? T[scene.transition.type] : -1);
    gl.uniform1f(this.u.uProg, scene.transition ? scene.transition.progress : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!scene.overlays?.length) return;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(this.u.uOverlay, 1);
    gl.uniform1i(this.u.uTrans, -1);
    this.setLayer(1, null);
    for (const layer of scene.overlays) {
      this.setLayer(0, layer);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
  }
}
