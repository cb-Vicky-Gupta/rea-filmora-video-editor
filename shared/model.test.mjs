import { describe, expect, it } from 'vitest';
import {
  animValue,
  clipDur,
  effectiveFades,
  layerProps,
  mainVideoTrack,
  overlayTracks,
  propAt,
  transitionInto,
  transitionOutOf,
} from './model.mjs';

const clip = (patch) => ({
  id: 'c',
  start: 0,
  in: 0,
  out: 4,
  speed: 1,
  fadeIn: 0,
  fadeOut: 0,
  ...patch,
});

describe('timing', () => {
  it('scales clip length by speed', () => {
    expect(clipDur(clip({ out: 4, speed: 2 }))).toBe(2);
    expect(clipDur(clip({ in: 1, out: 4, speed: 0.5 }))).toBe(6);
  });
});

describe('tracks', () => {
  it('treats the lowest video track as main and the others as overlays, bottom to top', () => {
    const project = {
      tracks: [
        { id: 'v3', kind: 'video' },
        { id: 'v2', kind: 'video' },
        { id: 'v1', kind: 'video' },
        { id: 't1', kind: 'text' },
      ],
    };
    expect(mainVideoTrack(project).id).toBe('v1');
    expect(overlayTracks(project).map((t) => t.id)).toEqual(['v2', 'v3']);
  });
});

describe('transitions', () => {
  const a = clip({ id: 'a', start: 0, out: 4 });
  const b = clip({
    id: 'b',
    start: 4,
    out: 4,
    transition: { type: 'fade', duration: 1 },
    fadeIn: 0.5,
  });
  const track = { clips: [a, b] };

  it('plays from the clip that ends where this one starts', () => {
    expect(transitionInto(track, b)).toMatchObject({ prev: a, type: 'fade', duration: 1 });
    expect(transitionOutOf(track, a)).toMatchObject({ next: b, duration: 1 });
  });

  it('comes in from black when nothing ends right before the clip', () => {
    const lone = clip({ id: 'x', start: 10, transition: { type: 'wipeleft', duration: 1 } });
    expect(transitionInto({ clips: [a, lone] }, lone)).toMatchObject({
      prev: null,
      type: 'wipeleft',
    });
    expect(transitionOutOf({ clips: [a, lone] }, a)).toBeNull();
  });

  it('is limited to the clip length and replaces the fade in', () => {
    const short = clip({ id: 's', start: 4, out: 0.5, transition: { type: 'fade', duration: 2 } });
    expect(transitionInto({ clips: [a, short] }, short).duration).toBe(0.5);
    expect(effectiveFades(track, b).fadeIn).toBe(0);
  });

  it('ignores unknown transition types', () => {
    expect(transitionInto(track, { ...b, transition: { type: 'nope', duration: 1 } })).toBeNull();
  });
});

describe('keyframes', () => {
  // Keyframe times are source timestamps; at speed 2 source 2s is timeline 1s.
  const c = clip({
    speed: 2,
    keyframes: {
      scale: [
        { t: 0, v: 1 },
        { t: 2, v: 2 },
      ],
    },
  });

  it('interpolates in clip-local timeline time and holds outside the keyframes', () => {
    expect(propAt(c, 'scale', 0)).toBe(1);
    expect(propAt(c, 'scale', 0.5)).toBeCloseTo(1.5);
    expect(propAt(c, 'scale', 1.5)).toBe(2);
  });

  it('eases when asked', () => {
    const eased = clip({
      keyframes: {
        x: [
          { t: 0, v: 0, ease: 'ease' },
          { t: 2, v: 1 },
        ],
      },
    });
    expect(propAt(eased, 'x', 0.5)).toBeLessThan(0.25);
    expect(propAt(eased, 'x', 1)).toBeCloseTo(0.5);
  });

  it('falls back to static transform values', () => {
    expect(propAt(clip({ transform: { rotation: 30 } }), 'rotation', 1)).toBe(30);
    expect(propAt(clip(), 'opacity', 1)).toBe(1);
  });
});

describe('animations', () => {
  const c = clip({
    out: 4,
    animIn: { type: 'zoom-in', duration: 1 },
    animOut: { type: 'slide-left', duration: 1 },
  });

  it('starts from the preset values and settles at rest', () => {
    expect(animValue(c, 'scale', 0)).toBeCloseTo(0.4);
    expect(animValue(c, 'opacity', 0)).toBe(0);
    expect(animValue(c, 'scale', 2)).toBe(1);
    expect(animValue(c, 'x', 2)).toBe(0);
  });

  it('leaves in the opposite direction it would enter from', () => {
    // Slide Left enters from the right (+x), so it exits to the left (-x).
    expect(animValue(c, 'x', 4)).toBe(-1);
  });

  it('combines with keyframes and clamps opacity', () => {
    const props = layerProps({ ...c, transform: { scale: 0.5, opacity: 1 } }, 0);
    expect(props.scale).toBeCloseTo(0.2);
    expect(props.opacity).toBe(0);
  });
});
