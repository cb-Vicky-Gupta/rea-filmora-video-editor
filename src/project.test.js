import { describe, expect, it } from 'vitest';
import { clipEnd, historyReducer, newProject } from './project.js';

const media = {
  id: 'm',
  name: 'm.mp4',
  path: '/m.mp4',
  kind: 'video',
  hasAudio: true,
  duration: 4,
};

function setup(magnet = true) {
  let state = { past: [], present: newProject(), future: [] };
  const run = (action) => (state = historyReducer(state, action));
  run({ type: 'SET_SETTINGS', patch: { magnet } });
  run({ type: 'ADD_MEDIA', items: [media] });
  for (const id of ['a', 'b', 'c']) run({ type: 'ADD_CLIP', mediaId: 'm', clipId: id });
  const main = () =>
    state.present.tracks
      .find((t) => t.id === 'v1')
      .clips.slice()
      .sort((x, y) => x.start - y.start);
  return { run, main, state: () => state };
}

describe('magnetic timeline', () => {
  it('closes the gap when a clip is deleted', () => {
    const { run, main } = setup(true);
    run({ type: 'DELETE_CLIP', clipId: 'b' });
    expect(main().map((c) => [c.id, c.start])).toEqual([
      ['a', 0],
      ['c', 4],
    ]);
  });

  it('closes the gap after a cut-out section is deleted', () => {
    const { run, main } = setup(true);
    run({ type: 'SPLIT', clipId: 'b', time: 6, newId: 'b2' });
    run({ type: 'DELETE_CLIP', clipId: 'b' });
    expect(main().map((c) => [c.id, c.start])).toEqual([
      ['a', 0],
      ['b2', 4],
      ['c', 6],
    ]);
  });

  it('inserts a clip dropped between others', () => {
    const { run, main } = setup(true);
    run({ type: 'UPDATE_CLIP', clipId: 'c', patch: { start: 3.5 } });
    expect(main().map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(clipEnd(main()[2])).toBe(12);
  });

  it('leaves gaps when the magnet is off', () => {
    const { run, main } = setup(false);
    run({ type: 'DELETE_CLIP', clipId: 'b' });
    expect(main().map((c) => [c.id, c.start])).toEqual([
      ['a', 0],
      ['c', 8],
    ]);
  });
});

describe('editing', () => {
  it('removes only the transition, and undo brings it back', () => {
    const { run, state } = setup(true);
    run({ type: 'SET_TRANSITION', clipId: 'b', transition: { type: 'fade', duration: 1 } });
    run({ type: 'SET_TRANSITION', clipId: 'b', transition: null });
    const b = () =>
      state()
        .present.tracks.find((t) => t.id === 'v1')
        .clips.find((c) => c.id === 'b');
    expect(b()).toBeTruthy();
    expect(b().transition).toBeUndefined();
    run({ type: 'UNDO' });
    expect(b().transition).toEqual({ type: 'fade', duration: 1 });
  });

  it('adds video tracks on top and only deletes removable tracks', () => {
    const { run, state } = setup(true);
    run({ type: 'ADD_VIDEO_TRACK' });
    const added = state().present.tracks[0];
    expect(added.kind).toBe('video');
    run({ type: 'REMOVE_TRACK', trackId: 'v1' });
    run({ type: 'REMOVE_TRACK', trackId: 't1' });
    expect(state().present.tracks.some((t) => t.id === 'v1')).toBe(true);
    expect(state().present.tracks.some((t) => t.id === 't1')).toBe(true);
    run({ type: 'REMOVE_TRACK', trackId: added.id });
    expect(state().present.tracks.some((t) => t.id === added.id)).toBe(false);
  });

  it('ripples later clips when speed changes', () => {
    const { run, main } = setup(false);
    run({ type: 'SET_SPEED', clipId: 'a', speed: 2 });
    expect(main().map((c) => c.start)).toEqual([0, 2, 6]);
  });
});
