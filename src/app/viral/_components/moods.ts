// Mood-as-template token system, lifted from the Claude Design hand-off.
// Every mood drives: bg/surface, ink, accent, glow, video grade, motion
// intensity, type weight. The LLM editorial mood selects the whole
// language, not just a hue.

import type { EditPlan } from "~/lib/ai-editor/types";

export type Mood = EditPlan["mood"];

export type MoodToken = {
	name: string;
	tagline: string;
	bg: string;
	bgDeep: string;
	surface: string;
	ink: string;
	inkDim: string;
	accent: string;
	accent2: string;
	glow: string;
	grade: string;
	motion: "low" | "medium" | "high";
	weight: 700 | 800 | 900;
	italic: boolean;
	transitionSig: "cut" | "whip" | "flash" | "glitch";
	captionStyle: "stamp" | "tabloid" | "terminal" | "underline";
};

export const MOODS: Record<Mood, MoodToken> = {
	hype: {
		name: "HYPE",
		tagline: "velocity / overdrive",
		bg: "#FF2D2D",
		bgDeep: "#7A0010",
		surface: "#1A0507",
		ink: "#FFE9DA",
		inkDim: "#FFB199",
		accent: "#FFD400",
		accent2: "#FF5EDC",
		glow: "0 0 80px rgba(255,212,0,0.55), 0 0 160px rgba(255,45,45,0.35)",
		grade: "saturate(1.35) contrast(1.1) brightness(1.05)",
		motion: "high",
		weight: 900,
		italic: true,
		transitionSig: "whip",
		captionStyle: "stamp",
	},
	cocky: {
		name: "COCKY",
		tagline: "gold / lean-back swagger",
		bg: "#0E0B05",
		bgDeep: "#1F1808",
		surface: "#100B03",
		ink: "#F6E7C2",
		inkDim: "#A78F5A",
		accent: "#E9B949",
		accent2: "#FFFFFF",
		glow: "0 0 60px rgba(233,185,73,0.45), 0 0 200px rgba(233,185,73,0.18)",
		grade: "saturate(0.9) contrast(1.15) sepia(0.12)",
		motion: "low",
		weight: 800,
		italic: false,
		transitionSig: "cut",
		captionStyle: "tabloid",
	},
	menacing: {
		name: "MENACING",
		tagline: "cold / surveillance",
		bg: "#06080B",
		bgDeep: "#020305",
		surface: "#0A0E14",
		ink: "#E6F0FF",
		inkDim: "#5A6878",
		accent: "#00E5FF",
		accent2: "#FF0040",
		glow: "0 0 80px rgba(0,229,255,0.35), 0 0 200px rgba(0,229,255,0.12)",
		grade: "saturate(0.6) contrast(1.25) brightness(0.85) hue-rotate(-8deg)",
		motion: "medium",
		weight: 700,
		italic: false,
		transitionSig: "glitch",
		captionStyle: "terminal",
	},
	comeback: {
		name: "COMEBACK",
		tagline: "dawn / underdog",
		bg: "#0B1220",
		bgDeep: "#050912",
		surface: "#0C1426",
		ink: "#F2EAD3",
		inkDim: "#9AAAC0",
		accent: "#FF7A1A",
		accent2: "#7DE3FF",
		glow: "0 0 80px rgba(255,122,26,0.35), 0 0 200px rgba(125,227,255,0.18)",
		grade: "saturate(1.05) contrast(1.1) brightness(0.95)",
		motion: "medium",
		weight: 800,
		italic: true,
		transitionSig: "flash",
		captionStyle: "underline",
	},
};

export const FONT_DISPLAY =
	'"Bebas Neue", "Anton", "Oswald", Impact, sans-serif';
export const FONT_MONO =
	'"Geist Mono", "JetBrains Mono", ui-monospace, monospace';
