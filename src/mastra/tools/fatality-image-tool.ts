import { createTool } from "@mastra/core/tools";
import OpenAI from "openai";
import { z } from "zod";

/** Short: minimal overhead. */
const SAFETY_PREFIX = "Stylized game art, no real people: ";

export type FatalityImageOptions = {
	/** default true for the game: faster, cheaper, smaller image */
	fast?: boolean;
};

export async function runFatalityImageGen(
	input: { fatalityTitle: string; imagePrompt: string },
	options: FatalityImageOptions = {},
): Promise<{ dataUrl: string; fatalityTitle: string }> {
	const { fast = true } = options;
	const key = process.env.OPENAI_API_KEY;
	if (!key) {
		throw new Error("OPENAI_API_KEY is not set");
	}
	const openai = new OpenAI({ apiKey: key, maxRetries: 0 });
	// dalle-2 max prompt 1000; keep tiny = faster to validate server-side
	const maxLen = fast ? 220 : 3800;
	const fullPrompt = `${SAFETY_PREFIX}${input.imagePrompt}`.slice(0, maxLen);
	const res = fast
		? await openai.images.generate({
				model: "dall-e-2",
				prompt: fullPrompt,
				n: 1,
				// 256 = smallest / fastest on Images API; panel scales it up
				size: "256x256",
				response_format: "b64_json",
			})
		: await openai.images.generate({
				model: "dall-e-3",
				prompt: fullPrompt,
				n: 1,
				size: "1024x1024",
				response_format: "b64_json",
				quality: "standard",
			});
	const first = res.data?.[0];
	const b64 = first?.b64_json;
	if (!b64) {
		throw new Error("No image data returned from OpenAI");
	}
	return {
		dataUrl: `data:image/png;base64,${b64}`,
		fatalityTitle: input.fatalityTitle,
	};
}

export type ThemeImageRole = "arena" | "enemy" | "ally";

const ARENA_PROMPT =
	"Seamless top-down battle arena ground, cartoon brawler, readable sand & grass patches, no characters, no UI, no text: ";

const SPRITE_PROMPT =
	"One single game character sprite, top-down view, centered on canvas, " +
	"filling 85% of the frame. Chunky bold black outline, vibrant colors, " +
	"Brawl Stars / Clash Royale art style. Transparent background. ";

const SPRITE_SUFFIX: Record<"enemy" | "ally", string> = {
	enemy: "This is an ENEMY unit. Menacing, aggressive pose. ",
	ally: "This is a friendly ALLY unit. Heroic, protective pose. ",
};

/**
 * Arena background: DALL·E 2 256×256 (fast, no transparency needed).
 * Sprites: gpt-image-1 1024×1024 low quality, transparent PNG.
 * Call all three with Promise.all for minimum wall time.
 */
export async function runThemeImageGen(
	role: ThemeImageRole,
	userPrompt: string,
): Promise<{ dataUrl: string }> {
	const key = process.env.OPENAI_API_KEY;
	if (!key) {
		throw new Error("OPENAI_API_KEY is not set");
	}
	const openai = new OpenAI({ apiKey: key, maxRetries: 0 });
	const trimmed = userPrompt.trim().slice(0, 300);

	if (role === "arena") {
		const full = `${SAFETY_PREFIX}${ARENA_PROMPT}${trimmed}`.slice(0, 990);
		const res = await openai.images.generate({
			model: "dall-e-2",
			prompt: full,
			n: 1,
			size: "256x256",
			response_format: "b64_json",
		});
		const b64 = res.data?.[0]?.b64_json;
		if (!b64) throw new Error("No image data returned from OpenAI");
		return { dataUrl: `data:image/png;base64,${b64}` };
	}

	const full =
		`${SAFETY_PREFIX}${SPRITE_PROMPT}${SPRITE_SUFFIX[role]}${trimmed}`;
	const res = await openai.images.generate({
		model: "gpt-image-1",
		prompt: full,
		n: 1,
		size: "1024x1024",
		quality: "low",
		background: "transparent",
		output_format: "png",
	});
	const b64 = res.data?.[0]?.b64_json;
	if (!b64) throw new Error("No image data returned from OpenAI");
	return { dataUrl: `data:image/png;base64,${b64}` };
}

export const renderFatalityImageTool = createTool({
	id: "render-fatality-image",
	description:
		"OpenAI DALL·E: MK-style static frame. Titles 2–32 chars, imagePrompt 40–400 chars (keep short).",
	inputSchema: z.object({
		fatalityTitle: z.string().min(2).max(32),
		imagePrompt: z.string().min(30).max(500),
	}),
	outputSchema: z.object({
		dataUrl: z.string(),
		fatalityTitle: z.string(),
	}),
	execute: async (inputData) => {
		return runFatalityImageGen(
			{
				fatalityTitle: inputData.fatalityTitle,
				imagePrompt: inputData.imagePrompt,
			},
			{ fast: true },
		);
	},
});
