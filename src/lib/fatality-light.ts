/**
 * Client + server: deterministic copy only (no network). Keeps DALL·E prompts short for speed.
 */

const TITLES = [
	"BALLISTIC OBLIVION",
	"ELEPHANT SUPREMACY",
	"DONKEY D-DAY",
	"FATAL FUMBLE",
	"CHROME FUMIGATION",
	"ARENA APOCALYPSE",
	"RAGING TRUNK",
	"POLITICAL KO",
	"CARNAGE CROWN",
	"MEGA MAMMOTH",
	"WAVE WIPER",
	"ULTRA BRAWL",
] as const;

const ACCENTS = [
	"crimson gold",
	"electric blue",
	"violet",
	"ember",
	"nitro",
] as const;

export function buildLightweightFatality(
	wave: number,
	personalKills: number,
): { fatalityTitle: string; imagePrompt: string } {
	const t = (wave * 17 + personalKills * 31) % TITLES.length;
	const a = (wave + personalKills) % ACCENTS.length;
	const title = TITLES[t] ?? TITLES[0];
	const accent = ACCENTS[a] ?? ACCENTS[0];
	// ~90 chars: fits DALL·E-2 1000 limit with a tiny safety prefix
	const imagePrompt = `MK static "${title}", ${accent} light, embers, scanlines, cartoon, poster.`;
	return { fatalityTitle: title, imagePrompt };
}
