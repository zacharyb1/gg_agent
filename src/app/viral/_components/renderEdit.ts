import type { EditPlan, GameEvent } from "~/lib/ai-editor/types";

const W = 720;
const H = 1280;

type RenderOpts = {
	matchBlobUrl: string;
	events: GameEvent[];
	plan: EditPlan;
	onProgress?: (p: number) => void;
};

const moodColor: Record<EditPlan["mood"], string> = {
	hype: "#ff8a3d",
	cocky: "#22d3ee",
	menacing: "#a855f7",
	comeback: "#34d399",
};

function parseAccent(text: string) {
	const out: { text: string; accent: boolean }[] = [];
	const re = /\[([^\]]+)\]|([^\[\]]+)/g;
	let m: RegExpExecArray | null = null;
	// biome-ignore lint/suspicious/noAssignInExpressions: regex iteration
	while ((m = re.exec(text)) !== null) {
		out.push({ text: m[1] ?? m[2] ?? "", accent: m[1] != null });
	}
	return out;
}

function drawCaption(
	ctx: CanvasRenderingContext2D,
	text: string,
	color: string,
	t01: number,
) {
	const parts = parseAccent(text);
	const popK = Math.min(1, t01 * 6);
	const c1 = 1.70158;
	const c3 = c1 + 1;
	const eob = popK >= 1 ? 1 : 1 + c3 * (popK - 1) ** 3 + c1 * (popK - 1) ** 2;
	const scale = 0.4 + eob * 0.6;
	const alpha = Math.min(1, popK * 1.4);

	let fontSize = 76;
	ctx.font = `900 ${fontSize}px "Trebuchet MS", system-ui, sans-serif`;
	const cleanText = text.replace(/[\[\]]/g, "");
	const totalW = ctx.measureText(cleanText).width;
	const maxW = W * 0.86;
	if (totalW * scale > maxW) {
		fontSize = Math.max(32, Math.floor((fontSize * maxW) / (totalW * scale)));
		ctx.font = `900 ${fontSize}px "Trebuchet MS", system-ui, sans-serif`;
	}

	const widths = parts.map((p) => ctx.measureText(p.text).width);
	const total = widths.reduce((a, b) => a + b, 0);

	ctx.save();
	ctx.translate(W / 2, H * 0.22);
	ctx.scale(scale, scale);
	ctx.globalAlpha = alpha;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	let cursor = -total / 2;
	// Stroke pass
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		const widthsI = widths[i];
		if (!p || widthsI == null) continue;
		ctx.lineWidth = Math.max(8, fontSize * 0.13);
		ctx.strokeStyle = "#0d0d1a";
		ctx.strokeText(p.text, cursor + widthsI / 2, 0);
		cursor += widthsI;
	}
	// Fill pass
	cursor = -total / 2;
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		const widthsI = widths[i];
		if (!p || widthsI == null) continue;
		if (p.accent) {
			ctx.shadowColor = color;
			ctx.shadowBlur = 26;
			ctx.fillStyle = color;
		} else {
			ctx.shadowBlur = 0;
			ctx.fillStyle = "#fff";
		}
		ctx.fillText(p.text, cursor + widthsI / 2, 0);
		cursor += widthsI;
	}
	ctx.shadowBlur = 0;
	ctx.restore();
}

function drawCoverVideo(
	ctx: CanvasRenderingContext2D,
	video: HTMLVideoElement,
	zoom: number,
	shake: number,
) {
	if (!video.videoWidth) return;
	const sa = video.videoWidth / video.videoHeight;
	const da = W / H;
	let dw: number;
	let dh: number;
	let dx: number;
	let dy: number;
	if (sa > da) {
		dh = H;
		dw = H * sa;
		dx = (W - dw) / 2;
		dy = 0;
	} else {
		dw = W;
		dh = W / sa;
		dx = 0;
		dy = (H - dh) / 2;
	}
	const shx = (Math.random() - 0.5) * shake;
	const shy = (Math.random() - 0.5) * shake;
	ctx.save();
	ctx.translate(W / 2 + shx, H / 2 + shy);
	ctx.scale(zoom, zoom);
	ctx.translate(-W / 2, -H / 2);
	ctx.filter = "saturate(1.45) contrast(1.22) brightness(1.04)";
	ctx.drawImage(video, dx, dy, dw, dh);
	ctx.filter = "none";
	// Cheap RGB split via additive overlay.
	ctx.globalCompositeOperation = "lighter";
	ctx.globalAlpha = 0.4;
	ctx.filter = "sepia(1) saturate(8) hue-rotate(-50deg)";
	ctx.drawImage(video, dx - 5, dy, dw, dh);
	ctx.filter = "sepia(1) saturate(8) hue-rotate(180deg)";
	ctx.drawImage(video, dx + 5, dy, dw, dh);
	ctx.filter = "none";
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = "source-over";
	ctx.restore();
}

function drawChrome(
	ctx: CanvasRenderingContext2D,
	moodAccent: string,
	beatPulse: number,
) {
	// Scanlines
	ctx.fillStyle = "rgba(0,0,0,0.16)";
	for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
	// Vignette
	const vg = ctx.createRadialGradient(
		W / 2,
		H / 2,
		Math.min(W, H) * 0.28,
		W / 2,
		H / 2,
		Math.max(W, H) * 0.7,
	);
	vg.addColorStop(0, "rgba(0,0,0,0)");
	vg.addColorStop(1, `rgba(0,0,0,${0.55 + beatPulse * 0.18})`);
	ctx.fillStyle = vg;
	ctx.fillRect(0, 0, W, H);
	// Recording dot
	ctx.beginPath();
	ctx.arc(W - 26, 28, 6, 0, Math.PI * 2);
	ctx.fillStyle = `rgba(255,80,80,${0.4 + beatPulse * 0.6})`;
	ctx.fill();
	// Watermark
	ctx.font = "bold 14px monospace";
	ctx.textAlign = "left";
	ctx.fillStyle = "rgba(255,255,255,0.85)";
	ctx.fillText("► BEST MOMENTS", 16, 28);
	ctx.fillStyle = "rgba(255,255,255,0.5)";
	ctx.fillText("#brrawl  #phonk  #edit", 16, 48);
	// Bottom caption strip with mood color
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.fillRect(0, H - 80, W, 80);
	ctx.fillStyle = moodAccent;
	ctx.fillRect(0, H - 80, W, 3);
}

async function waitFrame(): Promise<void> {
	return new Promise((r) => requestAnimationFrame(() => r()));
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function easeOutBack(t: number): number {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function drawHookVignette(ctx: CanvasRenderingContext2D, t01: number) {
	const vg = ctx.createRadialGradient(
		W / 2,
		H / 2,
		Math.min(W, H) * 0.18,
		W / 2,
		H / 2,
		Math.max(W, H) * 0.7,
	);
	vg.addColorStop(0, "rgba(0,0,0,0)");
	vg.addColorStop(1, `rgba(0,0,0,${0.55 + t01 * 0.25})`);
	ctx.fillStyle = vg;
	ctx.fillRect(0, 0, W, H);
}

function drawHookTag(ctx: CanvasRenderingContext2D, mood: string, accent: string) {
	ctx.save();
	ctx.font = "bold 16px monospace";
	ctx.textBaseline = "top";
	ctx.textAlign = "left";
	const label = `VIRAL.LIVE / ${mood.toUpperCase()}`;
	const padX = 14;
	const padY = 8;
	const tx = 24;
	const ty = H * 0.14;
	const w = ctx.measureText(label).width + padX * 2;
	ctx.fillStyle = "rgba(0,0,0,0.6)";
	ctx.fillRect(tx, ty, w, 32);
	ctx.fillStyle = accent;
	ctx.fillRect(tx, ty, 4, 32);
	ctx.fillStyle = "rgba(255,255,255,0.92)";
	ctx.fillText(label, tx + padX, ty + padY);
	ctx.restore();
}

function drawLightStreak(
	ctx: CanvasRenderingContext2D,
	t01: number,
	accent: string,
) {
	const eased = clamp01(t01);
	const x = -W * 0.4 + eased * (W + W * 0.8);
	const streakH = 14;
	const cy = H / 2;
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	// Outer glow halo
	const glow = ctx.createRadialGradient(x, cy, 0, x, cy, W * 0.55);
	glow.addColorStop(0, accent);
	glow.addColorStop(0.18, "rgba(255,240,210,0.55)");
	glow.addColorStop(1, "rgba(0,0,0,0)");
	ctx.globalAlpha = 0.85 * Math.sin(eased * Math.PI);
	ctx.fillStyle = glow;
	ctx.fillRect(0, cy - H * 0.4, W, H * 0.8);
	// Bright core bar with motion blur
	ctx.globalAlpha = 1;
	ctx.filter = "blur(6px)";
	ctx.fillStyle = "#fff";
	ctx.fillRect(x - W * 0.6, cy - streakH / 2, W * 1.2, streakH);
	ctx.filter = "none";
	// Sharp center line
	ctx.fillStyle = "rgba(255,255,255,0.9)";
	ctx.fillRect(x - W * 0.5, cy - 1, W, 2);
	ctx.restore();
}

function drawBrandMark(
	ctx: CanvasRenderingContext2D,
	wordmark: string,
	subtitle: string,
	accent: string,
	revealT: number,
	pulse: number,
) {
	const eased = easeOutBack(clamp01(revealT));
	const scale = 0.85 + eased * 0.15;
	const finalScale = scale * pulse;
	const alpha = clamp01(revealT * 1.4);

	ctx.save();
	ctx.translate(W / 2, H / 2);
	ctx.scale(finalScale, finalScale);
	ctx.globalAlpha = alpha;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	// Wordmark with glow
	const wmFont = `900 italic 110px "Trebuchet MS", system-ui, sans-serif`;
	ctx.font = wmFont;
	ctx.shadowColor = accent;
	ctx.shadowBlur = 40 + pulse * 18;
	ctx.lineWidth = 10;
	ctx.strokeStyle = "#0d0d1a";
	ctx.strokeText(wordmark, 0, -8);
	ctx.fillStyle = "#fff";
	ctx.fillText(wordmark, 0, -8);
	ctx.shadowBlur = 0;

	// Accent underline draws across
	const wmW = ctx.measureText(wordmark).width;
	const lineW = wmW * clamp01(revealT * 1.6);
	ctx.fillStyle = accent;
	ctx.fillRect(-lineW / 2, 56, lineW, 6);

	// Subtitle (plan.outro line) — tighter, smaller, accent parsing
	ctx.font = `800 26px "Trebuchet MS", system-ui, sans-serif`;
	ctx.globalAlpha = alpha * 0.95;
	const cleanSub = subtitle.replace(/[\[\]]/g, "");
	ctx.lineWidth = 5;
	ctx.strokeStyle = "#0d0d1a";
	ctx.strokeText(cleanSub, 0, 110);
	ctx.fillStyle = "#fff";
	ctx.fillText(cleanSub, 0, 110);

	ctx.restore();
}

async function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
	const target = Math.max(0, Math.min(video.duration - 0.1, t));
	video.currentTime = target;
	await new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			video.removeEventListener("seeked", finish);
			resolve();
		};
		video.addEventListener("seeked", finish);
		setTimeout(finish, 800);
	});
}

export async function renderEdit({
	matchBlobUrl,
	events,
	plan,
	onProgress,
}: RenderOpts): Promise<{ blobUrl: string; durationMs: number }> {
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2d context");

	const video = document.createElement("video");
	video.src = matchBlobUrl;
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	await new Promise<void>((resolve, reject) => {
		const t = setTimeout(() => reject(new Error("video metadata timeout")), 4000);
		video.addEventListener(
			"loadedmetadata",
			() => {
				clearTimeout(t);
				resolve();
			},
			{ once: true },
		);
	});

	// Audio
	const audioEl = new Audio(`/audio/${plan.audio}.mp3`);
	audioEl.loop = true;
	audioEl.volume = 0.85;

	// Compose canvas video stream + audio track for the recorder.
	const stream = canvas.captureStream(30);
	let audioCtx: AudioContext | null = null;
	try {
		audioCtx = new AudioContext();
		const src = audioCtx.createMediaElementSource(audioEl);
		const dest = audioCtx.createMediaStreamDestination();
		src.connect(dest);
		src.connect(audioCtx.destination);
		for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
	} catch (err) {
		console.warn("[render] audio mix failed:", err);
	}

	const supportsVp9 = MediaRecorder.isTypeSupported(
		"video/webm;codecs=vp9,opus",
	);
	const recorder = new MediaRecorder(stream, {
		mimeType: supportsVp9
			? "video/webm;codecs=vp9,opus"
			: "video/webm;codecs=vp8,opus",
		videoBitsPerSecond: 4_000_000,
	});
	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => {
		if (e.data.size > 0) chunks.push(e.data);
	};
	const stopped = new Promise<void>((resolve) => {
		recorder.onstop = () => resolve();
	});
	recorder.start(200);

	try {
		await audioEl.play();
	} catch (err) {
		console.warn("[render] audio play failed:", err);
	}

	const accent = moodColor[plan.mood] ?? "#ffd54f";
	const beatMs = 60_000 / 142;
	const totalMs = plan.shots.reduce((a, s) => a + s.lengthMs, 0);
	const renderStart = performance.now();

	// Hook: 1.2s opening card before the first shot.
	const hookMs = 1200;
	{
		const start = performance.now();
		while (performance.now() - start < hookMs) {
			const elapsed = performance.now() - start;
			const t01 = elapsed / hookMs;
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, W, H);
			const beatPhase = ((performance.now() - renderStart) % beatMs) / beatMs;
			const beatPulse = (1 - beatPhase) ** 2;
			drawCaption(ctx, plan.hook, accent, t01);
			drawChrome(ctx, accent, beatPulse);
			onProgress?.((elapsed / hookMs) * 0.05);
			await waitFrame();
		}
	}

	let elapsedMs = 0;
	for (let i = 0; i < plan.shots.length; i++) {
		const shot = plan.shots[i];
		if (!shot) continue;
		const ev = events[shot.eventIndex];
		if (!ev) continue;

		const seekTo = Math.max(0, ev.t / 1000 - 1.0);
		await seekVideo(video, seekTo);
		video.playbackRate = 0.65;
		try {
			await video.play();
		} catch {}

		const start = performance.now();
		while (performance.now() - start < shot.lengthMs) {
			const t01 = (performance.now() - start) / shot.lengthMs;
			const beatPhase = ((performance.now() - renderStart) % beatMs) / beatMs;
			const beatPulse = (1 - beatPhase) ** 2;
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, W, H);
			const zoom = 1.05 + t01 * 0.16 + beatPulse * 0.04;
			const shake = beatPulse * 5;
			drawCoverVideo(ctx, video, zoom, shake);
			drawCaption(ctx, shot.caption, accent, t01);
			drawChrome(ctx, accent, beatPulse);
			const overall = 0.05 + (elapsedMs + t01 * shot.lengthMs) / totalMs * 0.9;
			onProgress?.(overall);
			await waitFrame();
		}
		elapsedMs += shot.lengthMs;
		try {
			video.pause();
		} catch {}
	}

	// Outro card 1.2s
	{
		const outroMs = 1200;
		const start = performance.now();
		while (performance.now() - start < outroMs) {
			const t01 = (performance.now() - start) / outroMs;
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, W, H);
			const beatPhase = ((performance.now() - renderStart) % beatMs) / beatMs;
			const beatPulse = (1 - beatPhase) ** 2;
			drawCaption(ctx, plan.outro, accent, t01);
			drawChrome(ctx, accent, beatPulse);
			onProgress?.(0.95 + t01 * 0.05);
			await waitFrame();
		}
	}

	recorder.stop();
	await stopped;
	audioEl.pause();
	if (audioCtx) {
		try {
			await audioCtx.close();
		} catch {}
	}

	const blob = new Blob(chunks, { type: "video/webm" });
	const blobUrl = URL.createObjectURL(blob);
	onProgress?.(1);
	return { blobUrl, durationMs: performance.now() - renderStart };
}
