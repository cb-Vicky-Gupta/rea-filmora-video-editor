# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-21

ReaCut replaces the earlier browser-only trimmer prototype with a full editor for macOS, Windows and Android.

### Added

- Desktop apps for macOS (Apple Silicon and Intel) and Windows (installer and portable), built with Electron and native FFmpeg
- Android app (Capacitor) with export on the device through ffmpeg.wasm, saving to Documents/ReaCut and sharing
- Multi-track timeline: overlay video tracks (picture in picture), titles, several audio tracks; hide, mute and delete tracks; drag clips between tracks; magnetic main track
- 24 transitions (also from black), 13 In/Out animations, keyframes for position, scale, rotation and opacity, speed 0.25×–4×
- Color grading: 14 looks, light and color controls, split toning, fade, vignette and `.cube` LUTs; the WebGL preview matches the export
- Audio: waveforms, volume up to 200 %, fades, 3-band EQ, rumble filter, noise reduction, detach audio
- Import of iPhone HEVC/HEIC, AVI, MKV, WMV and more, with automatic preview proxies
- Export window: MP4 (H.264/H.265), ProRes, WebM, GIF, MP3/M4A/WAV, presets, resolution, frame rate, quality or VBR/CBR bitrate, hardware encoding on Mac, custom range, size estimate
- Unit tests for timeline, animation, transition, magnet, color, export and probing rules
- Open-source community files: contributing guide, code of conduct, security policy, issue and PR templates, CI

[Unreleased]: https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/releases/tag/v0.1.0
