"use client";

import type { ReactNode } from "react";

// Screen rect inside /public/mockup/iphone-15-black-portrait.png (1419x2796).
// Tuned to match the visible glass area of the mockup. If the next mockup PNG
// changes, retune these four numbers — nothing else.
const SCREEN_TOP_PCT = 2.5;
const SCREEN_LEFT_PCT = 6.6;
const SCREEN_WIDTH_PCT = 86.6;
const SCREEN_HEIGHT_PCT = 95.0;

export function IPhoneFrame({ children }: { children: ReactNode }) {
	return (
		<div
			className="relative"
			style={{
				width: "min(420px, 92vw)",
				aspectRatio: "1419 / 2796",
				maxHeight: "94vh",
				filter: "drop-shadow(0 40px 80px rgba(0,0,0,0.6))",
			}}
		>
			{/* SCREEN (behind the mockup PNG) — content paints here. */}
			<div
				className="absolute overflow-hidden bg-black"
				style={{
					top: `${SCREEN_TOP_PCT}%`,
					left: `${SCREEN_LEFT_PCT}%`,
					width: `${SCREEN_WIDTH_PCT}%`,
					height: `${SCREEN_HEIGHT_PCT}%`,
					borderRadius: "8%",
				}}
			>
				{children}
			</div>

			{/* MOCKUP PNG (on top, transparent screen lets content show through). */}
			{/* biome-ignore lint/performance/noImgElement: mockup is fixed asset, not user-supplied */}
			<img
				alt=""
				className="pointer-events-none absolute inset-0 h-full w-full select-none"
				draggable={false}
				src="/mockup/iphone-15-black-portrait.png"
			/>
		</div>
	);
}
