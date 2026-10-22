// Turns a project (timeline JSON) into an ffmpeg argument list. Used by the desktop app (native
// ffmpeg) and the Android app (ffmpeg.wasm); `io` provides file access for each environment:
//   { exists(path), readText(path), writeText(path, text), join(...parts), fonts: [paths], platform }
import {
  EPS,
  REST,
  clipDur,
  clipSpeed,
  hasRamp,
  localTimeOf,
  sourceTime,
  projectDuration,
  mainVideoTrack,
  overlayTracks,
  transitionInto,
  transitionOutOf,
  effectiveFades,
  localKeyframes,
  staticValue,
  hasTransform,
  hasOpacity,
  clipAudio,
  clipAnimations,
  animFrom,
  isAdditive,
} from './model.mjs';
import { clipGrade, needsLut, bakeLut, lutToCube, parseCube } from './grade.mjs';
import { defaultSettings, encoderArgs, formatById } from './export.mjs';

// Border added around frames before `perspective`, which smears edge pixels outward.
const PAD = 2;

// Escapes a value for use inside a single-quoted filtergraph option. Windows paths use
// forward slashes, which ffmpeg accepts and which avoid backslash escaping.
function escapeFilterValue(v) {
  return String(v).replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

function hexColor(c) {
  return '0x' + String(c || '#ffffff').replace('#', '');
}

function n(x) {
  return Number(x).toFixed(3);
}

function num(x) {
  return (
    Number(x)
      .toFixed(5)
      .replace(/\.?0+$/, '') || '0'
  );
}

// Piecewise keyframe interpolation as an ffmpeg expression of local time `tv`.
function keyframeExpr(clip, prop, tv) {
  const kfs = localKeyframes(clip, prop);
  if (!kfs) return num(staticValue(clip, prop));
  let expr = num(kfs[kfs.length - 1].v);
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i];
    const b = kfs[i + 1];
    let u = `((${tv})-${num(a.local)})/${num(Math.max(EPS, b.local - a.local))}`;
    if (a.ease === 'ease') u = `(${u})*(${u})*(3-2*(${u}))`;
    expr = `if(lt(${tv},${num(b.local)}),${num(a.v)}+${num(b.v - a.v)}*${u},${expr})`;
  }
  return `if(lt(${tv},${num(kfs[0].local)}),${num(kfs[0].v)},${expr})`;
}

// In/Out animation contribution to `prop` (same math as animValue in shared/model.mjs).
function animExpr(clip, prop, tv) {
  const dur = clipDur(clip);
  const parts = [];
  for (const { anim, duration, dir } of clipAnimations(clip)) {
    const from = animFrom(anim, prop, dir);
    if (from === undefined) continue;
    const u =
      dir === 'in'
        ? `clip((${tv})/${num(duration)},0,1)`
        : `clip((${num(dur)}-(${tv}))/${num(duration)},0,1)`;
    const e =
      anim.ease === 'back'
        ? `(1+2.70158*pow((${u})-1,3)+1.70158*pow((${u})-1,2))`
        : `(1-pow(1-(${u}),3))`;
    parts.push(`(${num(from)}+${num(REST[prop] - from)}*${e})`);
  }
  return parts;
}

// Full value of a transform property: keyframes combined with animations.
function propExpr(clip, prop, tv) {
  const base = keyframeExpr(clip, prop, tv);
  const anim = animExpr(clip, prop, tv);
  if (!anim.length) return base;
  return isAdditive(prop)
    ? [base, ...anim].map((p) => `(${p})`).join('+')
    : [base, ...anim].map((p) => `(${p})`).join('*');
}

// Position/scale/rotation: map the corners of the (padded) frame with `perspective`.
function transformFilters(clip, W, H, fps, padColor) {
  const tv = `in/${fps}`;
  const X = propExpr(clip, 'x', tv);
  const Y = propExpr(clip, 'y', tv);
  const S = propExpr(clip, 'scale', tv);
  const R = `(${propExpr(clip, 'rotation', tv)})*PI/180`;
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sy], i) => {
    const dx = sx * (W / 2 + PAD);
    const dy = sy * (H / 2 + PAD);
    const x = `${PAD}+${W}*(${X})+(${S})*(${dx}*cos(${R})-(${dy})*sin(${R}))`;
    const y = `${PAD}+${H}*(${Y})+(${S})*(${dx}*sin(${R})+(${dy})*cos(${R}))`;
    return `x${i}='${x}':y${i}='${y}'`;
  });
  return [
    `pad=${W + 2 * PAD}:${H + 2 * PAD}:${PAD}:${PAD}:color=${padColor}`,
    `perspective=${corners.join(':')}:sense=destination:eval=frame`,
    `crop=${W}:${H}:${PAD}:${PAD}`,
  ];
}

// Opacity over black on the main track: scale luma and chroma towards black, per frame.
function opacityOverBlack(clip) {
  const K = `clip(${propExpr(clip, 'opacity', 't')},0,1)`;
  return `eq=eval=frame:contrast='${K}':brightness='((${K})-1)*0.43725':saturation='${K}'`;
}

// Opacity of an overlay clip: scale its alpha channel.
function opacityAlpha(clip) {
  const animated =
    localKeyframes(clip, 'opacity') ||
    clipAnimations(clip).some(({ anim }) => anim.props.opacity !== undefined);
  if (!animated) return `colorchannelmixer=aa=${num(staticValue(clip, 'opacity'))}`;
  const K = `clip(${propExpr(clip, 'opacity', 'T')},0,1)`;
  return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${K})'`;
}

function atempoChain(speed) {
  const out = [];
  let s = speed;
  while (s > 2 + EPS) {
    out.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5 - EPS) {
    out.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1) > EPS) out.push(`atempo=${num(s)}`);
  return out;
}

// Speed ramp retiming for `setpts`: the output time of the frame at source offset X is
// L·τ(X/L), with τ the ramp's time curve (same math as rampTimeAt in shared/model.mjs).
// Past the end of the curve the last speed continues, for transition tails.
function rampSetpts(clip) {
  const pts = clip.ramp.points;
  const L = clip.out - clip.in;
  const T = pts.map((p) => localTimeOf(clip, clip.in + p.x * L) / L);
  const x = `((PTS-STARTPTS)*TB/${num(L)})`;
  const last = pts[pts.length - 1];
  let e = `${num(T[T.length - 1])}+(${x}-1)/${num(last.s)}`;
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b.x <= a.x) continue;
    const k = (b.s - a.s) / (b.x - a.x);
    const seg =
      Math.abs(k) < 1e-9
        ? `${num(T[i])}+(${x}-${num(a.x)})/${num(a.s)}`
        : `${num(T[i])}+log(1+${num(k)}*(${x}-${num(a.x)})/${num(a.s)})/${num(k)}`;
    e = `if(lt(${x},${num(b.x)}),${seg},${e})`;
  }
  return `setpts='${num(L)}*(${e})/TB'`;
}

// Audio can't change tempo continuously, so a ramped clip's sound is cut into short pieces
// that each play at their own average speed: [{ from, to (source offsets), tempo }].
export function rampAudioPieces(clip) {
  const pts = clip.ramp.points;
  const L = clip.out - clip.in;
  const step = Math.max(0.15, L / 60);
  const pieces = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = (b.x - a.x) * L;
    if (len < 1e-4) continue;
    const count = Math.abs(b.s - a.s) < 1e-9 ? 1 : Math.ceil(len / step);
    for (let j = 0; j < count; j++) {
      const from = a.x * L + (len * j) / count;
      const to = a.x * L + (len * (j + 1)) / count;
      const t0 = localTimeOf(clip, clip.in + from);
      const t1 = localTimeOf(clip, clip.in + to);
      pieces.push({ from, to, tempo: (to - from) / Math.max(1e-6, t1 - t0) });
    }
  }
  return pieces;
}

function checkMediaFiles(project, io) {
  for (const track of project.tracks) {
    if (track.hidden && track.kind !== 'audio') continue;
    for (const c of track.clips) {
      const media = project.media[c.mediaId];
      if (media && !io.exists(media.path)) {
        throw new Error(
          `Media file not found: ${media.originalPath || media.path}\nRelink or remove "${media.name}" and try again.`,
        );
      }
    }
  }
}

// `settings` are the export dialog's choices (shared/export.mjs); missing ones fall back to defaults.
export function buildExportArgs(project, outPath, tmpDir, settings = {}, io) {
  const s = { ...defaultSettings(project), ...settings };
  const format = formatById(s.format);
  const W = Math.round(s.width / 2) * 2;
  const H = Math.round(s.height / 2) * 2;
  const fps = s.fps;
  const total = projectDuration(project);
  if (total <= 0) throw new Error('The timeline is empty.');
  checkMediaFiles(project, io);
  const wantVideo = !!format.video;
  const wantAudio = s.audio && !!format.audio;
  if (!wantVideo && !wantAudio)
    throw new Error('Nothing to export: this format has no video and audio is turned off.');
  const rangeStart = s.range === 'custom' ? Math.max(0, Math.min(s.rangeStart, total)) : 0;
  const rangeEnd = s.range === 'custom' ? Math.max(rangeStart, Math.min(s.rangeEnd, total)) : total;
  if (rangeEnd - rangeStart < 0.05) throw new Error('The export range is empty.');

  const inputs = [];
  const filters = [];
  const addInput = (args) => {
    inputs.push(...args);
    return inputs.filter((a) => a === '-i').length - 1;
  };
  let seg = 0;
  const label = (prefix) => `${prefix}${seg++}`;

  const mainTrack = mainVideoTrack(project);
  const textTrack = project.tracks.find((t) => t.kind === 'text');
  const audioTracks = project.tracks.filter((t) => t.kind === 'audio' && !t.muted);
  const audioSources = [];

  // Imported .cube files, parsed once per export.
  const cubes = new Map();
  const loadCube = (lut) => {
    if (!lut) return null;
    if (!cubes.has(lut.path)) cubes.set(lut.path, parseCube(io.readText(lut.path)));
    return cubes.get(lut.path);
  };
  let lutCount = 0;

  // Opens a clip's source and returns its input index plus the timing filters
  // (speed, frame rate, and padding to `len` seconds by repeating the last frame).
  const openClip = (c, media, len) => {
    const idx =
      media.kind === 'image'
        ? addInput(['-loop', '1', '-framerate', String(fps), '-t', n(len), '-i', media.path])
        : addInput([
            '-ss',
            n(c.in),
            '-t',
            n(sourceTime(c, c.start + len) - c.in),
            '-i',
            media.path,
          ]);
    const chain = [];
    if (media.kind !== 'image')
      chain.push(hasRamp(c) ? rampSetpts(c) : `setpts=(PTS-STARTPTS)/${num(clipSpeed(c))}`);
    chain.push(
      `fps=${fps}`,
      `tpad=stop_mode=clone:stop_duration=${n(len)}`,
      `trim=duration=${n(len)}`,
      'setpts=PTS-STARTPTS',
    );
    return { idx, chain };
  };

  const gradeFilters = (c) => {
    const grade = clipGrade(c);
    if (!needsLut(grade)) return [];
    const cubeFile = io.join(tmpDir, `grade-${lutCount++}.cube`);
    io.writeText(cubeFile, lutToCube(bakeLut(grade, grade.lut ? loadCube(grade.lut) : null)));
    return [`lut3d=file='${escapeFilterValue(cubeFile)}':interp=trilinear`];
  };
  const vignetteAngle = (c) => num((clipGrade(c).vignette * Math.PI) / 2);
  const fit = [`scale=${W}:${H}:force_original_aspect_ratio=decrease`];

  const wantsAudio = (track, c, media) =>
    media.kind === 'video' &&
    media.hasAudio &&
    !track.muted &&
    !c.muted &&
    !c.audioDetached &&
    c.volume > 0;

  // Builds the video graph and returns its output label. Also collects the audio of video clips.
  const buildVideo = () => {
    // ---- Main video track: clips in timeline order, joined by concat or xfade ----
    let cur = null;
    let curLen = 0;
    const append = (lbl, len, tr) => {
      if (!cur) {
        cur = lbl;
        curLen = len;
        return;
      }
      const out = label('vj');
      if (tr) {
        filters.push(
          `[${cur}][${lbl}]xfade=transition=${tr.type}:duration=${n(tr.duration)}:offset=${n(curLen - tr.duration)}[${out}]`,
        );
        curLen += len - tr.duration;
      } else {
        filters.push(`[${cur}][${lbl}]concat=n=2:v=1:a=0[${out}]`);
        curLen += len;
      }
      cur = out;
    };
    const blackSource = (dur) =>
      `color=c=black:s=${W}x${H}:r=${fps}:d=${n(dur)},format=yuv420p,setsar=1,settb=AVTB`;
    const pushGap = (dur) => {
      const lbl = label('vs');
      filters.push(`${blackSource(dur)}[${lbl}]`);
      append(lbl, dur);
    };

    const mainClips = mainTrack.hidden
      ? []
      : [...mainTrack.clips]
          .filter((c) => project.media[c.mediaId])
          .sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const c of mainClips) {
      const media = project.media[c.mediaId];
      const dur = clipDur(c);
      if (c.start > cursor + EPS) pushGap(c.start - cursor);

      // A following transition needs this clip to keep running underneath it.
      const ext = transitionOutOf(mainTrack, c)?.duration || 0;
      const len = dur + ext;
      const { idx, chain } = openClip(c, media, len);
      chain.push(...gradeFilters(c));
      if (clipGrade(c).vignette > 0)
        chain.push('format=rgb24', `vignette=angle=${vignetteAngle(c)}:dither=0`);
      // Transparent areas of images show black, like the preview.
      if (media.kind === 'image') chain.push('format=rgba', 'premultiply=inplace=1');
      chain.push(
        ...fit,
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
        'setsar=1',
        'format=yuv420p',
      );
      if (hasOpacity(c)) chain.push(opacityOverBlack(c));
      if (hasTransform(c)) chain.push(...transformFilters(c, W, H, fps, 'black'));
      const fades = effectiveFades(mainTrack, c);
      if (fades.fadeIn > 0) chain.push(`fade=t=in:st=0:d=${n(fades.fadeIn)}`);
      if (fades.fadeOut > 0)
        chain.push(`fade=t=out:st=${n(Math.max(0, dur - fades.fadeOut))}:d=${n(fades.fadeOut)}`);
      chain.push('format=yuv420p', 'settb=AVTB');

      let lbl = label('vs');
      filters.push(`[${idx}:v]${chain.join(',')}[${lbl}]`);
      const tr = transitionInto(mainTrack, c);
      if (tr && !tr.prev) {
        // Transition in from black: xfade from a black clip as long as the transition.
        const black = label('vb');
        const mixed = label('vf');
        filters.push(`${blackSource(tr.duration)}[${black}]`);
        filters.push(
          `[${black}][${lbl}]xfade=transition=${tr.type}:duration=${n(tr.duration)}:offset=0[${mixed}]`,
        );
        lbl = mixed;
      }
      append(lbl, len, tr?.prev ? tr : null);

      if (wantsAudio(mainTrack, c, media)) audioSources.push({ idx, clip: c });
      cursor = c.start + dur;
    }
    if (total > cursor + EPS) pushGap(total - cursor);

    // ---- Overlay tracks (picture in picture), composited bottom to top ----
    vLabel = cur;
    for (const track of overlayTracks(project)) {
      if (track.hidden) continue;
      for (const c of track.clips) {
        const media = project.media[c.mediaId];
        if (!media) continue;
        const dur = clipDur(c);
        const { idx, chain } = openClip(c, media, dur);
        chain.push(...gradeFilters(c), 'format=rgba');
        let src = `[${idx}:v]${chain.join(',')}`;
        if (clipGrade(c).vignette > 0) {
          // Vignette works on RGB only; keep the alpha channel aside.
          const [a, b, al, v] = [label('oa'), label('ob'), label('oal'), label('ov')];
          filters.push(`${src},split[${a}][${b}]`);
          filters.push(`[${b}]alphaextract[${al}]`);
          filters.push(
            `[${a}]format=rgb24,vignette=angle=${vignetteAngle(c)}:dither=0,format=rgba[${v}]`,
          );
          const merged = label('om');
          filters.push(`[${v}][${al}]alphamerge[${merged}]`);
          src = `[${merged}]null`;
        }
        const post = [
          ...fit,
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
          'setsar=1',
          'format=rgba',
        ];
        if (hasOpacity(c)) post.push(opacityAlpha(c));
        if (hasTransform(c)) post.push(...transformFilters(c, W, H, fps, 'black@0'));
        if (c.fadeIn > 0) post.push(`fade=t=in:st=0:d=${n(c.fadeIn)}:alpha=1`);
        if (c.fadeOut > 0)
          post.push(`fade=t=out:st=${n(Math.max(0, dur - c.fadeOut))}:d=${n(c.fadeOut)}:alpha=1`);
        post.push(`setpts=PTS-STARTPTS+${n(c.start)}/TB`);
        const ov = label('ovl');
        filters.push(`${src},${post.join(',')}[${ov}]`);
        const out = label('vo');
        filters.push(`[${vLabel}][${ov}]overlay=eof_action=pass:format=auto[${out}]`);
        vLabel = out;
        if (wantsAudio(track, c, media)) audioSources.push({ idx, clip: c });
      }
    }

    // ---- Titles: drawtext on top of everything ----
    const font = io.fonts.find((f) => io.exists(f));
    const scale = H / 1080;
    if (textTrack && !textTrack.hidden) {
      textTrack.clips.forEach((c, i) => {
        if (!c.text?.trim()) return;
        const textFile = io.join(tmpDir, `title-${i}.txt`);
        io.writeText(textFile, c.text);
        const end = c.start + clipDur(c);
        const tv = `t-${n(c.start)}`;
        const dx = animExpr(c, 'x', tv);
        const dy = animExpr(c, 'y', tv);
        const alpha = animExpr(c, 'opacity', tv);
        const X = [num(c.x), ...dx].join('+');
        const Y = [num(c.y), ...dy].join('+');
        const opts = [
          font ? `fontfile='${escapeFilterValue(font)}'` : null,
          `textfile='${escapeFilterValue(textFile)}'`,
          `fontsize=${Math.round(c.fontSize * scale)}`,
          `fontcolor=${hexColor(c.color)}`,
          `x='w*(${X})-text_w/2'`,
          `y='h*(${Y})-text_h/2'`,
          alpha.length ? `alpha='${alpha.join('*')}'` : null,
          c.box ? `box=1:boxcolor=black@0.55:boxborderw=${Math.round(20 * scale)}` : null,
          `enable='between(t,${n(c.start)},${n(end)})'`,
        ].filter(Boolean);
        const out = `vt${i}`;
        filters.push(`[${vLabel}]drawtext=${opts.join(':')}[${out}]`);
        vLabel = out;
      });
    }
    return vLabel;
  };

  // Audio-only exports still need the sound of clips on video tracks.
  const collectVideoTrackAudio = () => {
    for (const track of project.tracks.filter((t) => t.kind === 'video' && !t.hidden)) {
      for (const c of track.clips) {
        const media = project.media[c.mediaId];
        if (!media || !wantsAudio(track, c, media)) continue;
        const idx = addInput([
          '-ss',
          n(c.in),
          '-t',
          n(clipDur(c) * clipSpeed(c)),
          '-i',
          media.path,
        ]);
        audioSources.push({ idx, clip: c });
      }
    }
  };

  let vLabel = null;
  if (wantVideo) vLabel = buildVideo();
  else collectVideoTrackAudio();

  if (format.video === 'gif') {
    // GIFs look best with a palette made from the video itself.
    filters.push(
      `[${vLabel}]fps=${Math.min(fps, 15)},split[g1][g2]`,
      `[g1]palettegen=stats_mode=diff[gp]`,
      `[g2][gp]paletteuse=dither=bayer:bayer_scale=4[gif]`,
    );
    vLabel = 'gif';
  }

  if (wantAudio) {
    // ---- Audio: process every source, delay it to its timeline position and mix ----
    for (const track of audioTracks) {
      for (const c of track.clips) {
        const media = project.media[c.mediaId];
        if (!media || c.muted || c.volume <= 0 || !media.hasAudio) continue;
        const idx = addInput([
          '-ss',
          n(c.in),
          '-t',
          n(clipDur(c) * clipSpeed(c)),
          '-i',
          media.path,
        ]);
        audioSources.push({ idx, clip: c });
      }
    }

    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n(total)}[abase]`);
    const aLabels = ['abase'];
    audioSources.forEach(({ idx, clip }, i) => {
      const dur = clipDur(clip);
      const fx = clipAudio(clip);
      const srcLen = clip.out - clip.in;
      let head = `[${idx}:a]`;
      const chain = [`atrim=duration=${n(srcLen)}`, 'asetpts=PTS-STARTPTS'];
      if (hasRamp(clip)) {
        const pieces = rampAudioPieces(clip);
        const split = pieces.map(() => label('ras'));
        const parts = pieces.map(() => label('rap'));
        filters.push(
          `${head}${chain.join(',')},asplit=${pieces.length}${split.map((l) => `[${l}]`).join('')}`,
        );
        pieces.forEach((p, k) => {
          const tempo = atempoChain(p.tempo);
          filters.push(
            `[${split[k]}]atrim=start=${n(p.from)}:end=${n(p.to)},asetpts=PTS-STARTPTS,${tempo.length ? tempo.join(',') : 'anull'}[${parts[k]}]`,
          );
        });
        const joined = label('raj');
        filters.push(
          `${parts.map((l) => `[${l}]`).join('')}concat=n=${pieces.length}:v=0:a=1[${joined}]`,
        );
        head = `[${joined}]`;
        chain.length = 0;
      } else {
        chain.push(...atempoChain(clipSpeed(clip)));
      }
      chain.push('aformat=sample_rates=48000:channel_layouts=stereo', `volume=${n(clip.volume)}`);
      if (fx.highpass) chain.push('highpass=f=80');
      if (fx.bass) chain.push(`bass=g=${num(fx.bass)}:f=100`);
      if (fx.mid) chain.push(`equalizer=f=1000:t=q:w=1:g=${num(fx.mid)}`);
      if (fx.treble) chain.push(`treble=g=${num(fx.treble)}:f=3000`);
      if (fx.denoise) chain.push('afftdn=nr=12:nf=-35');
      if (clip.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${n(clip.fadeIn)}`);
      if (clip.fadeOut > 0)
        chain.push(`afade=t=out:st=${n(Math.max(0, dur - clip.fadeOut))}:d=${n(clip.fadeOut)}`);
      chain.push(`adelay=${Math.round(clip.start * 1000)}:all=1`);
      filters.push(`${head}${chain.join(',')}[as${i}]`);
      aLabels.push(`as${i}`);
    });
    filters.push(
      `${aLabels.map((l) => `[${l}]`).join('')}amix=inputs=${aLabels.length}:duration=first:normalize=0[aout]`,
    );
  }

  // The filter graph can get long; pass it through a file to stay under command-line limits.
  const graphFile = io.join(tmpDir, 'graph.txt');
  io.writeText(graphFile, filters.join(';\n'));

  const args = [
    '-hide_banner',
    '-y',
    ...inputs,
    '-filter_complex_script',
    graphFile,
    ...(wantVideo ? ['-map', `[${vLabel}]`] : []),
    ...(wantAudio ? ['-map', '[aout]'] : []),
    ...encoderArgs(s, io.platform),
    ...(wantVideo && format.video !== 'gif' ? ['-r', String(fps)] : []),
    ...(rangeStart > 0 ? ['-ss', n(rangeStart)] : []),
    '-t',
    n(rangeEnd - rangeStart),
    '-progress',
    'pipe:1',
    '-nostats',
    outPath,
  ];
  return { args, total: rangeEnd - rangeStart };
}
