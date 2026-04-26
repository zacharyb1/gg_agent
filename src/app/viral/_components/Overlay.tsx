"use client";

import type { EditPlan } from "~/lib/ai-editor/types";
import type { ViralMoment } from "~/lib/ai-editor/viral";
import { FONT_DISPLAY, FONT_MONO, MOODS, type Mood, type MoodToken } from "./moods";

type ViralState = {
	status: "idle" | "detecting" | "done";
	moments: ViralMoment[];
};
type EditState = {
	status: "idle" | "loading" | "done" | "error";
	plan: EditPlan | null;
};
type VideoState = {
	status: "idle" | "rendering" | "done" | "error";
	progress: number;
	blobUrl: string | null;
};

type Props = {
	viralState: ViralState;
	editState: EditState;
	videoState: VideoState;
	matchSummary: { eventCount: number; snapshotCount: number; blobUrl: string | null };
	wave: number;
	kills: number;
	onAgain: () => void;
};

export function ViralOverlay(props: Props) {
	const phase = derivePhase(props);
	const mood = pickMood(props.editState.plan?.mood);

	return (
		<div
			className="absolute inset-0 z-50 overflow-hidden"
			style={{
				background: `radial-gradient(ellipse at 60% 35%, ${mood.bgDeep} 0%, #000 70%)`,
				color: mood.ink,
				fontFamily: 'var(--font-sans), system-ui, sans-serif',
				borderRadius: 38,
			}}
		>
			<Backdrop mood={mood} phase={phase} />
			<CornerHud mood={mood} label={hudLabel(phase)} />
			<div className="relative h-full w-full">
				{phase === "DETECTING" && <Detecting mood={mood} {...props} />}
				{phase === "NO_VIRAL" && <NoViral mood={mood} {...props} />}
				{phase === "DROP_READY" && <DropReady mood={mood} {...props} />}
			</div>
		</div>
	);
}

// ---------- phase + mood derivation ----------

function derivePhase(p: Props): "DETECTING" | "NO_VIRAL" | "DROP_READY" {
	if (p.viralState.status === "detecting") return "DETECTING";
	if (
		p.viralState.status === "done" &&
		p.viralState.moments.length === 0
	) {
		return "NO_VIRAL";
	}
	return "DROP_READY";
}

function pickMood(m: Mood | undefined): MoodToken {
	return MOODS[m ?? "menacing"];
}

function hudLabel(
	phase: "DETECTING" | "NO_VIRAL" | "DROP_READY",
): string {
	if (phase === "DETECTING") return "STATE / DETECTING";
	if (phase === "NO_VIRAL") return "STATE / NULL · 0 MOMENTS";
	return "STATE / READY";
}

// ---------- ambient backdrop ----------

function Backdrop({ mood, phase }: { mood: MoodToken; phase: string }) {
	// Game canvas is still rendering underneath this fixed layer; we paint
	// blurred radial blobs + grain on top of a deep-mood gradient so the
	// previous frame is masked and the takeover owns the viewport.
	const intensity = phase === "NO_VIRAL" ? 0.55 : 0.7;
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<div
				className="absolute -inset-12"
				style={{
					background: `radial-gradient(ellipse at 60% 40%, ${mood.bgDeep} 0%, #000 80%),
                        repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 4px)`,
					filter: "blur(28px) saturate(0.45)",
				}}
			/>
			{[
				[0.2, 0.3, 360],
				[0.7, 0.55, 480],
				[0.45, 0.7, 280],
				[0.85, 0.25, 220],
			].map(([x, y, s], i) => (
				<div
					key={i}
					className="absolute"
					style={{
						left: `${(x as number) * 100}%`,
						top: `${(y as number) * 100}%`,
						width: s,
						height: s,
						background: `radial-gradient(circle, ${mood.accent2}25 0%, transparent 70%)`,
						filter: "blur(60px)",
						transform: "translate(-50%,-50%)",
					}}
				/>
			))}
			<div
				className="absolute inset-0"
				style={{ background: `rgba(0,0,0,${intensity})` }}
			/>
		</div>
	);
}

// ---------- corner hud ----------

function CornerHud({ mood, label }: { mood: MoodToken; label: string }) {
	return (
		<>
			<div
				className="absolute top-6 left-8 flex items-center gap-2.5"
				style={{
					fontFamily: FONT_MONO,
					fontSize: 11,
					letterSpacing: "0.2em",
					color: mood.inkDim,
				}}
			>
				<span
					style={{
						width: 8,
						height: 8,
						background: mood.accent,
						borderRadius: "50%",
						boxShadow: `0 0 12px ${mood.accent}`,
					}}
				/>
				VIRAL.LIVE / SQUAD-VS-ZOMBIES
			</div>
			<div
				className="absolute top-6 right-8"
				style={{
					fontFamily: FONT_MONO,
					fontSize: 11,
					letterSpacing: "0.2em",
					color: mood.inkDim,
				}}
			>
				{label}
			</div>
			<CornerBracket mood={mood} pos="tl" />
			<CornerBracket mood={mood} pos="tr" />
			<CornerBracket mood={mood} pos="bl" />
			<CornerBracket mood={mood} pos="br" />
		</>
	);
}

function CornerBracket({
	mood,
	pos,
}: {
	mood: MoodToken;
	pos: "tl" | "tr" | "bl" | "br";
}) {
	const positions: Record<typeof pos, React.CSSProperties> = {
		tl: { top: 56, left: 32 },
		tr: { top: 56, right: 32 },
		bl: { bottom: 32, left: 32 },
		br: { bottom: 32, right: 32 },
	};
	const flip =
		(pos.includes("r") ? "scaleX(-1) " : "") +
		(pos.includes("b") ? "scaleY(-1)" : "");
	return (
		<svg
			className="absolute"
			width={20}
			height={20}
			style={{ ...positions[pos], transform: flip }}
		>
			<path
				d="M0 8 L0 0 L8 0"
				stroke={mood.accent}
				strokeWidth={1.5}
				fill="none"
			/>
		</svg>
	);
}

// ---------- DETECTING ----------

function Detecting({
	mood,
	matchSummary,
}: {
	mood: MoodToken;
	matchSummary: Props["matchSummary"];
}) {
	const reticleSize = "min(40vh, 180px)";
	return (
		<div className="grid h-full place-items-center px-4">
			<div
				className="flex w-full items-center justify-center gap-6"
				style={{ maxWidth: 720 }}
			>
				{/* reticle */}
				<div className="relative flex shrink-0 justify-center">
					<div
						className="relative"
						style={{
							width: reticleSize,
							height: reticleSize,
							borderRadius: "50%",
							border: `1px solid ${mood.accent}40`,
							boxShadow: `inset 0 0 40px ${mood.accent}20, 0 0 50px ${mood.accent}30`,
						}}
					>
						<div
							className="absolute"
							style={{
								inset: "8%",
								borderRadius: "50%",
								border: `1px dashed ${mood.accent}60`,
								animation: "viral-spin 14s linear infinite",
							}}
						/>
						<div
							className="absolute"
							style={{
								inset: "20%",
								borderRadius: "50%",
								border: `2px solid ${mood.accent}`,
								boxShadow: `0 0 24px ${mood.accent}`,
							}}
						/>
						<div
							className="absolute"
							style={{
								left: "50%",
								top: 0,
								bottom: 0,
								width: 1,
								background: `linear-gradient(180deg, transparent, ${mood.accent}, transparent)`,
								animation: "viral-scan 1.6s ease-in-out infinite",
							}}
						/>
						<div
							className="absolute"
							style={{
								left: "50%",
								top: "50%",
								width: 6,
								height: 6,
								background: mood.accent,
								borderRadius: "50%",
								transform: "translate(-50%,-50%)",
								boxShadow: `0 0 16px ${mood.accent}`,
							}}
						/>
					</div>
				</div>

				{/* readout */}
				<div className="min-w-0">
					<div
						style={{
							fontFamily: FONT_MONO,
							fontSize: 9,
							color: mood.inkDim,
							letterSpacing: "0.2em",
							marginBottom: 8,
						}}
					>
						EVENTS · {matchSummary.eventCount} · {matchSummary.snapshotCount}
					</div>
					<h1
						style={{
							fontFamily: FONT_DISPLAY,
							fontSize: "clamp(28px, 5.5vw, 56px)",
							lineHeight: 0.9,
							color: mood.ink,
							margin: 0,
							letterSpacing: "0.01em",
						}}
					>
						THE MODEL
						<br />
						IS{" "}
						<span style={{ color: mood.accent, fontStyle: "italic" }}>
							WATCHING.
						</span>
					</h1>
					<div
						className="mt-3"
						style={{
							fontFamily: FONT_MONO,
							fontSize: 9,
							color: mood.inkDim,
							lineHeight: 1.8,
							letterSpacing: "0.15em",
						}}
					>
						GEMINI · viral_classifier · ≥ 70
					</div>
				</div>
			</div>

			<div className="absolute right-6 bottom-6 left-6 flex items-center gap-3">
				<div
					style={{
						fontFamily: FONT_MONO,
						fontSize: 9,
						color: mood.inkDim,
						letterSpacing: "0.2em",
					}}
				>
					SCAN
				</div>
				<div
					className="relative flex-1 overflow-hidden"
					style={{ height: 2, background: `${mood.inkDim}30` }}
				>
					<div
						className="absolute h-full"
						style={{
							width: "40%",
							background: `linear-gradient(90deg, transparent, ${mood.accent}, transparent)`,
							animation: "viral-sweep 1.4s ease-in-out infinite",
						}}
					/>
				</div>
			</div>
		</div>
	);
}

// ---------- NO VIRAL ----------

function NoViral({
	mood,
	matchSummary,
	onAgain,
}: {
	mood: MoodToken;
	matchSummary: Props["matchSummary"];
	onAgain: () => void;
}) {
	const bars = Array.from(
		{ length: 32 },
		(_, i) => 6 + Math.abs(Math.sin(i * 1.7)) * 18,
	);
	return (
		<div className="grid h-full place-items-center px-4">
			<div className="text-center">
				<div
					style={{
						fontFamily: FONT_MONO,
						fontSize: 9,
						letterSpacing: "0.3em",
						color: mood.inkDim,
						marginBottom: 12,
					}}
				>
					VERDICT — UNREMARKABLE
				</div>
				<h1
					style={{
						fontFamily: FONT_DISPLAY,
						fontSize: "clamp(36px, 7vw, 80px)",
						lineHeight: 0.88,
						color: mood.ink,
						margin: 0,
						letterSpacing: "-0.02em",
					}}
				>
					THE ALGORITHM
					<br />
					<span style={{ color: mood.accent, fontStyle: "italic" }}>
						WASN'T
					</span>{" "}
					IMPRESSED.
				</h1>
				<div
					className="mx-auto mt-3 leading-snug"
					style={{
						fontFamily: "var(--font-sans), system-ui, sans-serif",
						fontSize: 12,
						color: mood.inkDim,
						maxWidth: 360,
					}}
				>
					0 of {matchSummary.eventCount || 0} events cleared 70. No
					clutch, no streak, no long shot. This is on you.
				</div>

				<div
					className="mx-auto mt-5 grid items-end gap-0.5"
					style={{
						height: 40,
						gridTemplateColumns: "repeat(32, 1fr)",
						maxWidth: 360,
					}}
				>
					{bars.map((h, i) => (
						<div
							key={i}
							style={{
								height: h,
								background: mood.inkDim,
								opacity: 0.5,
							}}
						/>
					))}
				</div>

				<div className="mt-7">
					<button
						type="button"
						onClick={onAgain}
						style={{
							fontFamily: FONT_DISPLAY,
							fontSize: 22,
							letterSpacing: "0.04em",
							background: mood.accent,
							color: "#000",
							border: "none",
							padding: "10px 28px",
							cursor: "pointer",
							boxShadow: `0 0 30px ${mood.accent}70`,
						}}
					>
						RUN IT BACK →
					</button>
				</div>
			</div>
		</div>
	);
}

// ---------- DROP READY ----------

function DropReady(props: {
	mood: MoodToken;
	viralState: ViralState;
	editState: EditState;
	videoState: VideoState;
	matchSummary: Props["matchSummary"];
	onAgain: () => void;
}) {
	const { mood, viralState, editState, videoState, onAgain } = props;
	const moments = viralState.moments
		.slice()
		.sort((a, b) => b.score - a.score)
		.slice(0, 3);
	const isReady = videoState.status === "done" && !!videoState.blobUrl;
	const progressLabel =
		videoState.status === "rendering"
			? "CUTTING…"
			: editState.status === "loading"
				? "DIRECTING…"
				: "PREPARING…";
	const pct = Math.round(videoState.progress * 100);

	return (
		<div className="relative flex h-full flex-col items-center justify-between gap-3 px-3 pt-3 pb-4">
			{/* huge mood word backdrop */}
			<div
				className="pointer-events-none absolute"
				style={{
					left: "-2%",
					top: "10%",
					fontFamily: FONT_DISPLAY,
					fontSize: "clamp(120px, 38vh, 280px)",
					lineHeight: 0.85,
					color: `${mood.accent}10`,
					letterSpacing: "-0.02em",
					fontStyle: mood.italic ? "italic" : "normal",
					whiteSpace: "nowrap",
				}}
			>
				{mood.name}
			</div>

			{/* TOP — moment chips */}
			<div className="relative flex w-full flex-wrap items-center justify-center gap-1.5">
				<span
					style={{
						fontFamily: FONT_MONO,
						fontSize: 9,
						letterSpacing: "0.22em",
						color: mood.inkDim,
					}}
				>
					{String(moments.length).padStart(2, "0")} VIRAL · MOOD={mood.name}
				</span>
				{moments.map((m) => (
					<span
						key={m.eventIndex}
						style={{
							fontFamily: FONT_MONO,
							fontSize: 9,
							letterSpacing: "0.18em",
							background: isReady ? mood.accent : `${mood.accent}25`,
							color: isReady ? "#000" : mood.ink,
							padding: "3px 8px",
							border: `1px solid ${mood.accent}50`,
						}}
					>
						{m.label}
					</span>
				))}
			</div>

			{/* MIDDLE — video or render progress */}
			<div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
				{isReady ? (
					<div
						className="relative h-full"
						style={{
							aspectRatio: "9 / 16",
							maxWidth: "100%",
							boxShadow: mood.glow,
						}}
					>
						{/* biome-ignore lint/a11y/useMediaCaption: gameplay clip */}
						<video
							autoPlay
							className="absolute inset-0 h-full w-full"
							controls
							loop
							playsInline
							src={videoState.blobUrl ?? undefined}
							style={{ borderRadius: 14, background: "#000" }}
						/>
					</div>
				) : (
					<div className="flex flex-col items-center gap-3">
						<div
							style={{
								fontFamily: FONT_DISPLAY,
								fontSize: "clamp(40px, 8vw, 96px)",
								lineHeight: 0.88,
								color: mood.ink,
								textAlign: "center",
								fontStyle: mood.italic ? "italic" : "normal",
							}}
						>
							YOUR{" "}
							<span style={{ color: mood.accent }}>
								{mood.tagline.split(" / ")[0]?.toUpperCase()}
							</span>
							<br />
							CUT IS COMING.
						</div>
						<div
							className="relative h-1 w-56 overflow-hidden"
							style={{ background: `${mood.inkDim}40` }}
						>
							<div
								className="h-full"
								style={{
									width: `${Math.max(8, pct)}%`,
									background: mood.accent,
									boxShadow: `0 0 16px ${mood.accent}`,
									transition: "width 200ms ease",
								}}
							/>
						</div>
						<div
							style={{
								fontFamily: FONT_MONO,
								fontSize: 9,
								letterSpacing: "0.22em",
								color: mood.inkDim,
							}}
						>
							{progressLabel} · {pct}%
						</div>
					</div>
				)}
			</div>

			{/* BOTTOM — CTA */}
			<div className="relative flex w-full items-center justify-center gap-2">
				{isReady ? (
					<>
						<a
							className="flex items-center gap-2"
							download="brrawl-clip.webm"
							href={videoState.blobUrl ?? undefined}
							style={{
								fontFamily: FONT_DISPLAY,
								fontSize: "clamp(20px, 3vw, 30px)",
								letterSpacing: "0.04em",
								background: mood.accent,
								color: "#000",
								padding: "10px 26px",
								cursor: "pointer",
								boxShadow: `0 0 40px ${mood.accent}80`,
								textDecoration: "none",
							}}
						>
							<span>SAVE CLIP</span>
							<span>↓</span>
						</a>
						<button
							type="button"
							onClick={onAgain}
							style={{
								fontFamily: FONT_MONO,
								fontSize: 10,
								letterSpacing: "0.22em",
								background: "transparent",
								color: mood.inkDim,
								border: `1px solid ${mood.inkDim}40`,
								padding: "9px 16px",
								cursor: "pointer",
							}}
						>
							AGAIN
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={onAgain}
						style={{
							fontFamily: FONT_MONO,
							fontSize: 10,
							letterSpacing: "0.22em",
							background: "transparent",
							color: mood.inkDim,
							border: `1px solid ${mood.inkDim}40`,
							padding: "9px 16px",
							cursor: "pointer",
						}}
					>
						CANCEL
					</button>
				)}
			</div>
		</div>
	);
}

function PhoneBezel({
	mood,
	videoState,
}: {
	mood: MoodToken;
	videoState: VideoState;
}) {
	return (
		<div className="relative grid place-items-center">
			<div
				className="pointer-events-none absolute"
				style={{
					width: "min(620px, 90%)",
					aspectRatio: "9 / 16",
					background: `radial-gradient(ellipse at center, ${mood.accent}30 0%, transparent 60%)`,
					filter: "blur(60px)",
				}}
			/>
			<div
				className="relative overflow-hidden"
				style={{
					width: "clamp(360px, 34vw, 480px)",
					aspectRatio: "9 / 16",
					height: "auto",
					background: "#000",
					borderRadius: 48,
					border: `10px solid #1a1a1a`,
					boxShadow: `0 50px 100px rgba(0,0,0,0.8), 0 0 0 1px #2a2a2a, ${mood.glow}`,
				}}
			>
				<div
					className="absolute z-10"
					style={{
						top: 10,
						left: "50%",
						transform: "translateX(-50%)",
						width: "32%",
						height: 30,
						background: "#000",
						borderRadius: 16,
					}}
				/>
				{videoState.status === "done" && videoState.blobUrl ? (
					// biome-ignore lint/a11y/useMediaCaption: gameplay clip
					<video
						autoPlay
						className="absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)] rounded-[38px]"
						controls
						loop
						playsInline
						src={videoState.blobUrl}
					/>
				) : (
					<RenderProgress mood={mood} videoState={videoState} />
				)}
			</div>
		</div>
	);
}

function RenderProgress({
	mood,
	videoState,
}: {
	mood: MoodToken;
	videoState: VideoState;
}) {
	const pct = Math.max(8, videoState.progress * 100);
	return (
		<div
			className="absolute inset-2 flex flex-col items-center justify-center gap-4 rounded-[32px]"
			style={{
				background: `radial-gradient(ellipse at 50% 60%, ${mood.bgDeep} 0%, #000 80%)`,
			}}
		>
			<div
				className="text-center"
				style={{
					fontFamily: FONT_DISPLAY,
					fontSize: 36,
					lineHeight: 0.92,
					color: mood.ink,
					letterSpacing: "0.02em",
				}}
			>
				{videoState.status === "rendering"
					? "CUTTING\nYOUR CLIP"
					: "QUEUING…"}
			</div>
			<div
				style={{
					height: 3,
					width: 200,
					background: `${mood.inkDim}40`,
					position: "relative",
					overflow: "hidden",
				}}
			>
				<div
					className="h-full transition-[width] duration-200"
					style={{
						width: `${pct}%`,
						background: mood.accent,
						boxShadow: `0 0 16px ${mood.accent}`,
					}}
				/>
			</div>
			<div
				style={{
					fontFamily: FONT_MONO,
					fontSize: 11,
					color: mood.inkDim,
					letterSpacing: "0.2em",
				}}
			>
				{videoState.status === "rendering"
					? `${Math.round(videoState.progress * 100)}% · MUX`
					: "GEMINI · directing"}
			</div>
		</div>
	);
}
