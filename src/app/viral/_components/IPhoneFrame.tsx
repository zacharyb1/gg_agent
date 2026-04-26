"use client";

import type { ReactNode } from "react";

// Screen rect inside /public/mockup/iphone-15-black-portrait.png (1419x2796).
// Tuned to match the visible glass area of the mockup. If the mockup PNG
// changes, retune these four numbers — nothing else.
const SCREEN_TOP_PCT = 2.5; // top inset in portrait
const SCREEN_LEFT_PCT = 6.6; // left inset in portrait
const SCREEN_WIDTH_PCT = 86.6; // screen width in portrait
const SCREEN_HEIGHT_PCT = 95.0; // screen height in portrait

type Orientation = "landscape" | "portrait";

export function IPhoneFrame({
	orientation = "landscape",
	children,
}: {
	orientation?: Orientation;
	children: ReactNode;
}) {
	const isLandscape = orientation === "landscape";
	return (
		<div
			className="relative"
			style={{
				width: isLandscape ? "min(880px, 94vw)" : "min(420px, 94vw)",
				aspectRatio: isLandscape ? "2796 / 1419" : "1419 / 2796",
				maxHeight: isLandscape ? "78vh" : "94vh",
				transition:
					"width 600ms cubic-bezier(.22,1,.36,1), aspect-ratio 600ms cubic-bezier(.22,1,.36,1)",
				filter: "drop-shadow(0 40px 80px rgba(0,0,0,0.6))",
			}}
		>
			{/* SCREEN — content paints here, behind the mockup PNG */}
			<div
				className="absolute overflow-hidden bg-black"
				style={
					isLandscape
						? {
								top: `${SCREEN_LEFT_PCT}%`,
								left: `${SCREEN_TOP_PCT}%`,
								width: `${SCREEN_HEIGHT_PCT}%`,
								height: `${SCREEN_WIDTH_PCT}%`,
								borderRadius: "4%",
							}
						: {
								top: `${SCREEN_TOP_PCT}%`,
								left: `${SCREEN_LEFT_PCT}%`,
								width: `${SCREEN_WIDTH_PCT}%`,
								height: `${SCREEN_HEIGHT_PCT}%`,
								borderRadius: "8%",
							}
				}
			>
				{children}
			</div>

			{/* MOCKUP PNG — rotated 90° via CSS for landscape */}
			{/* biome-ignore lint/performance/noImgElement: mockup is fixed asset */}
			<img
				alt=""
				className="pointer-events-none absolute select-none"
				draggable={false}
				src="/mockup/iphone-15-black-portrait.png"
				style={
					isLandscape
						? {
								// Container is W × H landscape (e.g., 820 × 416, aspect 2796/1419).
								// Want the rotated PNG to fill it visually.
								// PNG natural is 1419×2796 (portrait, aspect 1419/2796).
								// CSS box at width=H, height=W (portrait box matching the
								// rotated landscape) — then rotate 90° around its center fills
								// the container exactly.
								width: `calc(100% * 1419 / 2796)`,
								aspectRatio: "1419 / 2796",
								height: "auto",
								top: "50%",
								left: "50%",
								transform: "translate(-50%, -50%) rotate(90deg)",
								transformOrigin: "center",
							}
						: {
								top: 0,
								left: 0,
								width: "100%",
								height: "100%",
							}
				}
			/>
		</div>
	);
}
