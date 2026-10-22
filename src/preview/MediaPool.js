// Pools of <video>/<audio> elements that chase the timeline clock. Elements are reused by clip,
// then by file, so cuts between clips of the same file don't reload, and the next clip is
// preloaded before the playhead reaches it. Audio goes through Web Audio for EQ and gain > 100%.

let ctx = null;
const graphs = new WeakMap();

function audioContext() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function resumeAudio() {
  if (ctx?.state === 'suspended') ctx.resume();
}

function graphFor(el) {
  let g = graphs.get(el);
  if (g) return g;
  const ac = audioContext();
  const src = ac.createMediaElementSource(el);
  const highpass = ac.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 10;
  const bass = ac.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 100;
  const mid = ac.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 1;
  const treble = ac.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 3000;
  const gain = ac.createGain();
  src
    .connect(highpass)
    .connect(bass)
    .connect(mid)
    .connect(treble)
    .connect(gain)
    .connect(ac.destination);
  g = { highpass, bass, mid, treble, gain };
  graphs.set(el, g);
  return g;
}

function setAudio(el, a) {
  const g = graphFor(el);
  g.gain.gain.value = a ? a.gain : 0;
  if (!a) return;
  g.highpass.frequency.value = a.highpass ? 80 : 10;
  g.bass.gain.value = a.bass;
  g.mid.gain.value = a.mid;
  g.treble.gain.value = a.treble;
}

const MAX_SLOTS = 10;

export class MediaPool {
  constructor(tag) {
    this.tag = tag;
    this.slots = [];
  }

  createSlot() {
    const el = document.createElement(this.tag);
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.playsInline = true;
    const slot = { el, key: null, url: null };
    this.slots.push(slot);
    return slot;
  }

  // items: [{ key, url, src, rate, frozen, preload, audio: { gain, bass, mid, treble, highpass } | null }]
  sync(items, playing) {
    const assigned = new Map();
    const used = new Set();
    const take = (item, slot) => {
      assigned.set(item, slot);
      used.add(slot);
    };
    for (const item of items) {
      const slot = this.slots.find((s) => !used.has(s) && s.key === item.key);
      if (slot) take(item, slot);
    }
    for (const item of items) {
      if (assigned.has(item)) continue;
      const slot = this.slots.find(
        (s) => !used.has(s) && s.url === item.url && !items.some((i) => i.key === s.key),
      );
      if (slot) take(item, slot);
    }
    for (const item of items) {
      if (assigned.has(item)) continue;
      let slot = this.slots.find((s) => !used.has(s) && !items.some((i) => i.key === s.key));
      if (!slot && this.slots.length < MAX_SLOTS) slot = this.createSlot();
      if (slot) take(item, slot);
    }

    for (const [item, slot] of assigned) this.apply(slot, item, playing);
    for (const slot of this.slots) {
      if (used.has(slot)) continue;
      if (!slot.el.paused) slot.el.pause();
      if (graphs.has(slot.el)) setAudio(slot.el, null);
    }
    return assigned;
  }

  apply(slot, item, playing) {
    const { el } = slot;
    slot.key = item.key;
    if (slot.url !== item.url) {
      slot.url = item.url;
      el.src = item.url;
    }
    if (!item.preload) setAudio(el, item.audio);
    else if (graphs.has(el)) setAudio(el, null);

    // Speed ramps change the rate every frame; rounding avoids needless updates.
    const rate = Math.round((item.rate || 1) * 100) / 100;
    if (el.playbackRate !== rate) el.playbackRate = rate;
    const run = playing && !item.preload && !item.frozen;
    const drift = Math.abs(el.currentTime - item.src);
    if (run) {
      if (drift > Math.max(0.12, 0.3 * rate) && !el.seeking) el.currentTime = item.src;
      if (el.paused) el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (drift > 0.02 && !el.seeking) el.currentTime = item.src;
    }
  }

  dispose() {
    for (const { el } of this.slots) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.slots = [];
  }
}
