import type { TrimRange } from './time';

type CapturableVideo = HTMLVideoElement & { captureStream?: () => MediaStream };

/** True when the browser can record a `<video>` element to a file. */
export function canExport(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof (HTMLVideoElement.prototype as CapturableVideo).captureStream === 'function'
  );
}

function pickMimeType(): string | undefined {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Records the trimmed section of a clip in real time using an off-screen
 * `<video>` element and `MediaRecorder`, and resolves with a WebM blob.
 *
 * This is a lightweight, dependency-free first version. A future version
 * may switch to ffmpeg.wasm / WebCodecs for faster-than-realtime exports.
 */
export function exportClip(
  url: string,
  trim: TrimRange,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video') as CapturableVideo;
    video.src = url;
    video.playsInline = true;
    video.preload = 'auto';

    const cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Could not load the clip for export.'));
    };

    video.onloadedmetadata = () => {
      video.currentTime = trim.start;
    };

    video.onseeked = () => {
      video.onseeked = null;
      if (!video.captureStream) {
        cleanup();
        reject(new Error('This browser does not support exporting video.'));
        return;
      }

      const stream = video.captureStream();
      const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        cleanup();
        onProgress?.(1);
        resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
      };

      video.ontimeupdate = () => {
        const length = trim.end - trim.start;
        onProgress?.(length > 0 ? (video.currentTime - trim.start) / length : 1);
        if (video.currentTime >= trim.end && recorder.state === 'recording') {
          recorder.stop();
        }
      };
      video.onended = () => {
        if (recorder.state === 'recording') recorder.stop();
      };

      recorder.start(250);
      video.play().catch((err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    };
  });
}
