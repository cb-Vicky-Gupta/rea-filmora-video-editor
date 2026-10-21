# ReaCut

<img src="build/icon.png" width="96" align="right" alt="" />

A video editor for **macOS, Windows and Android**: multi-track timeline, transitions, keyframes and animations, color grading with LUTs, audio EQ and a full export window. Built with React, WebGL and FFmpeg (Electron on desktop, Capacitor + ffmpeg.wasm on Android).

## Download

| Platform | Download | Notes |
| --- | --- | --- |
| **macOS** (Apple Silicon: M1–M4) | [ReaCut-mac-apple-silicon.dmg](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/releases/latest/download/ReaCut-mac-apple-silicon.dmg) | macOS 12 or newer |
| **macOS** (Intel) | [ReaCut-mac-intel.dmg](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/releases/latest/download/ReaCut-mac-intel.dmg) | macOS 12 or newer |
| **Windows** (64-bit) | [ReaCut-Setup-windows-x64.exe](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/releases/latest/download/ReaCut-Setup-windows-x64.exe) | Installer, Windows 10/11 |
| **Windows** (portable) | [ReaCut-windows-x64-portable.zip](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/releases/latest/download/ReaCut-windows-x64-portable.zip) | Unzip and run `ReaCut.exe`, no install |
| **Android** | [ReaCut-android.apk](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/releases/latest/download/ReaCut-android.apk) | Android 7.0 or newer |

All releases: [github.com/cb-Vicky-Gupta/rea-filmora-video-editor/releases](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/releases)

### Installing

The apps are not yet signed with Apple / Microsoft developer certificates, so the first launch shows a warning:

- **macOS**: open the DMG, drag ReaCut to Applications, then **right-click ReaCut → Open → Open**. If macOS says the app is damaged, run `xattr -cr /Applications/ReaCut.app` in Terminal once.
- **Windows**: if SmartScreen appears, click **More info → Run anyway**.
- **Android**: open the APK on your phone and allow **Install unknown apps** for your browser or file manager when asked.

### Android notes

- Export runs on the phone itself (FFmpeg compiled to WebAssembly), so it is slower than on a computer; short 720p/1080p videos work best. Exports are saved to **Documents/ReaCut** and can be shared from the finish screen.
- Imported media stays available while the app is open; after restarting, re-import the files of a saved project.
- HEIC photos aren't supported on Android (share them as JPG first). Hardware encoding is desktop-only.

## Features

- Import video, audio and images (button or drag and drop): MP4, MOV (incl. iPhone HEVC), WebM, MKV, AVI, WMV, MTS…, MP3, WAV, AIFF, FLAC…, JPG, PNG (with transparency), HEIC, TIFF…. Formats the preview can't decode get an optimized proxy automatically; export always uses the original file
- Library tabs: Media, Titles (presets), Transitions, Filters (drag onto clips)
- Multiple video tracks: tracks above the main track are overlays (picture in picture, logos, transparency), with PiP position presets
- Track headers: hide, mute, delete; drag clips between tracks; audio waveforms
- Split (`S`), delete (`⌫`), undo/redo, frame stepping (`←` `→`), play/pause (`Space`)
- **Transitions**: 24 types (dissolve, dips, wipes, slides, smooth wipes, circles, iris, box, clock, barn doors, pixel dissolve, zoom). Drag one onto a clip on the main track; with no clip right before it, it transitions in from black. Click a transition on the timeline and press ⌫ (or its ✕) to remove just the transition
- **Animations**: 13 In/Out presets (fade, zoom, slides, rise, drop, pop, spin, swing, whirl) for any clip or title
- **Keyframes**: position, scale, rotation and opacity, with linear or ease interpolation (`K` keys everything at the playhead)
- **Speed**: 0.25×–4× per clip, with pitch-preserved audio; later clips ripple
- **Color grading**: 14 built-in looks, exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance, hue, split toning, fade, vignette, and imported `.cube` 3D LUTs with intensity. One grade can be applied to every clip
- **Audio**: volume up to 200%, fades, 3-band EQ with presets, rumble filter, noise reduction (on export), detach audio from video
- Text titles: size, color, position, background box
- **Magnet** (magnetic timeline, on by default): the main track never has gaps; deleting, cutting or trimming closes them, dropping a clip between others inserts it. On other tracks, deleting a clip pulls later clips left
- **Export window**: file name and folder, formats (MP4 H.264 / H.265, MOV ProRes, WebM VP9, GIF, MP3, M4A, WAV), presets (YouTube, Reels/TikTok, Instagram, X, small file, master), resolution, frame rate, constant quality / VBR / CBR bitrate, encoding speed, hardware encoding on Mac, audio bitrate / sample rate / channels, custom range, size estimate, progress with time remaining, overwrite warning

The preview is rendered with WebGL using the same math as the export (grades are baked into one 3D LUT used by both; transitions port ffmpeg's xfade formulas), so what you see is what you export.

## Building from source

```sh
npm install
npm run dev            # desktop: Vite + Electron with hot reload
npm run dev:android    # Android UI in the browser at http://localhost:5174
npm run dist:mac       # release/ReaCut-<version>-arm64.dmg and -x64.dmg
npm run dist:win       # release/ReaCut-Setup-<version>-x64.exe and a portable .zip (builds on a Mac too)
npm run dist:android   # release/ReaCut-<version>.apk (signed)
```

`dist:android` needs JDK 21 and the Android SDK (`brew install openjdk@21 && brew install --cask android-commandlinetools`, then `sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"`), with `JAVA_HOME` and `ANDROID_HOME` set. Release APKs are signed with the key described by `~/.reacut-android/keystore.properties` (or the file in `REACUT_KEYSTORE_PROPERTIES`); it is never stored in this repo. Keep it backed up: Android only installs updates signed with the same key.

## Layout

- `electron/main.cjs`: window, file dialogs, `media://` protocol for local playback, media probing, export process
- `electron/exporter.cjs`, `electron/media.cjs`: desktop export and import (native ffmpeg)
- `shared/render.mjs`: turns the timeline JSON into an ffmpeg filter graph (desktop and Android)
- `shared/export.mjs`, `shared/probe.mjs`: export formats/presets and media probing rules
- `shared/`: timing, keyframe, transition (`model.mjs`) and color grading (`grade.mjs`) rules used by both preview and export
- `src/project.js`: reducer and undo history
- `src/preview/`: WebGL compositor, media element pools with Web Audio EQ, scene builder
- `src/components/`: MediaBin, Preview, Timeline, Inspector, ExportDialog
- `src/platform/web/`: the Android implementation of the app API (ffmpeg.wasm, file picker, saving and sharing)
- `android/`: Capacitor Android project
- `scripts/fetch-ffmpeg.cjs`: downloads the ffmpeg binary for each target platform into `vendor/`

## License

ReaCut is released under the [MIT License](LICENSE).

It bundles third-party software under its own licenses: [FFmpeg](https://ffmpeg.org/legal.html) (GPL, via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) on desktop and [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) on Android; source code at [ffmpeg.org](https://ffmpeg.org/download.html)), [Electron](https://www.electronjs.org/), [Capacitor](https://capacitorjs.com/), [React](https://react.dev/) and the [Roboto](https://github.com/googlefonts/roboto-2) font (Apache 2.0).
