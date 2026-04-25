import type { HighlightClip, StateSnapshot } from "./highlight-recorder";

type RenderFn = (ctx: CanvasRenderingContext2D, frame: StateSnapshot) => void;

export async function exportClipToVideo(
	clip: HighlightClip,
	renderFrame: RenderFn,
	width: number,
	height: number,
	onProgress?: (pct: number) => void,
): Promise<Blob> {
	const canvas = document.createElement("canvas");
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	canvas.width = width * dpr;
	canvas.height = height * dpr;
	const ctx = canvas.getContext("2d")!;
	ctx.scale(dpr, dpr);

	const stream = canvas.captureStream(0);
	const mimeType = MediaRecorder.isTypeSupported("video/webm; codecs=vp9")
		? "video/webm; codecs=vp9"
		: "video/webm";
	const recorder = new MediaRecorder(stream, {
		mimeType,
		videoBitsPerSecond: 4_000_000,
	});

	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => {
		if (e.data.size > 0) chunks.push(e.data);
	};

	return new Promise<Blob>((resolve, reject) => {
		recorder.onstop = () => {
			resolve(new Blob(chunks, { type: mimeType }));
		};
		recorder.onerror = () => reject(new Error("MediaRecorder error"));

		recorder.start();
		let frameIdx = 0;
		const total = clip.frames.length;
		const interval = 1000 / clip.fps;

		const track = stream.getVideoTracks()[0];

		const drawNext = () => {
			if (frameIdx >= total) {
				recorder.stop();
				return;
			}
			renderFrame(ctx, clip.frames[frameIdx]!);

			if (track && "requestFrame" in track) {
				(track as unknown as { requestFrame: () => void }).requestFrame();
			}

			onProgress?.(frameIdx / total);
			frameIdx++;
			setTimeout(drawNext, interval);
		};

		drawNext();
	});
}

export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
