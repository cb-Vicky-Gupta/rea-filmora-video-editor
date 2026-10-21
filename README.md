<div align="center">

# 🎬 Rea Video Editor

**An open-source, browser-based video editor built with React, TypeScript and Vite.**

Import clips, preview them, trim with a timeline and export — all locally in your browser. No uploads, no accounts.

[![CI](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Good first issues](https://img.shields.io/github/issues/cb-Vicky-Gupta/rea-filmora-video-editor/good%20first%20issue)](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

</div>

---

## ✨ Features

- **Media bin** — import one or many videos with the file picker or drag and drop
- **Preview player** — play / pause (or press <kbd>Space</kbd>), live timecode
- **Timeline trimming** — set in / out points, click the track to seek
- **Export** — save the trimmed clip as a WebM file, rendered entirely in the browser
- **Private by design** — your files never leave your machine

> This project is in early development. See the [roadmap](#-roadmap) for what's coming and grab an issue if you'd like to help!

## 🚀 Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) **20.19+** (22 LTS recommended — see [`.nvmrc`](.nvmrc))
- npm (comes with Node)

### Install and run

```bash
git clone https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor.git
cd rea-filmora-video-editor
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

### Scripts

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Start the dev server with hot reload              |
| `npm run build`     | Type-check and build for production               |
| `npm run preview`   | Serve the production build locally                |
| `npm run lint`      | Lint with [oxlint](https://oxc.rs/)               |
| `npm run typecheck` | Run the TypeScript compiler                       |
| `npm test`          | Run unit tests with [Vitest](https://vitest.dev/) |
| `npm run format`    | Format the codebase with Prettier                 |

## 🗂️ Project structure

```
.
├── public/              # Static assets (favicon)
├── src/
│   ├── components/      # UI components (MediaBin, Preview, Timeline)
│   ├── App.tsx          # App state and layout
│   ├── exportClip.ts    # In-browser export via MediaRecorder
│   ├── time.ts          # Time formatting and trim helpers (+ tests)
│   └── types.ts         # Shared TypeScript types
└── .github/             # CI, issue and PR templates
```

## 🛣️ Roadmap

- [x] Import, preview and trim a single clip
- [x] Export trimmed clip (WebM)
- [ ] Multi-clip timeline with drag-to-reorder
- [ ] Split clip at playhead
- [ ] Text overlays and titles
- [ ] Audio track and volume control
- [ ] Transitions (fade, crossfade)
- [ ] Faster-than-realtime export with ffmpeg.wasm / WebCodecs (MP4 output)
- [ ] Undo / redo
- [ ] Project save / load

Have an idea? [Open a feature request](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/issues/new/choose).

## 🌐 Browser support

Editing works in all modern browsers. Export relies on `HTMLVideoElement.captureStream()` and `MediaRecorder`, which are best supported in Chromium-based browsers (Chrome, Edge, Brave) and Firefox. The Export button is disabled where unsupported.

## 🤝 Contributing

Contributions of all sizes are welcome — bug reports, docs, features and design ideas.

1. Read the [Contributing Guide](CONTRIBUTING.md)
2. Look for issues labelled [`good first issue`](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/labels/good%20first%20issue)
3. Fork, create a branch, and open a pull request

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md) in all interactions.

## 🔒 Security

Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md).

## 📄 License

Released under the [MIT License](LICENSE) © 2026 Vicky Gupta.

## ⚠️ Disclaimer

This is an independent open-source project. It is not affiliated with, endorsed by, or connected to Wondershare Filmora or any other commercial video editing product. All trademarks belong to their respective owners.
