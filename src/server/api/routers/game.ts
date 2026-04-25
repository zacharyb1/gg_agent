import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildLightweightFatality } from "~/lib/fatality-light";
import {
	runFatalityImageGen,
	runThemeImageGen,
} from "~/mastra/tools/fatality-image-tool";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

/**
 * No Mastra agent / no chat Completions: one DALL·E 2 (512) call, tiny prompt — avoids context_length_exceeded.
 */
export const gameRouter = createTRPCRouter({
	fatalityOnKill: publicProcedure
		.input(
			z.object({
				killCount: z.number().int().min(1),
				wave: z.number().int().min(0),
			}),
		)
		.mutation(async ({ input }) => {
			if (!process.env.OPENAI_API_KEY) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "OPENAI_API_KEY is not set — add it to use AI fatality art.",
				});
			}
			const { fatalityTitle, imagePrompt } = buildLightweightFatality(
				input.wave,
				input.killCount,
			);
			const out = await runFatalityImageGen(
				{ fatalityTitle, imagePrompt },
				{ fast: true },
			);
			return {
				ok: true as const,
				dataUrl: out.dataUrl,
				fatalityTitle: out.fatalityTitle,
				flavorText: `W${input.wave} — your last frag; allies couldn’t snipe it.`,
			};
		}),

	/** One round-trip; three DALL·E 2 (256) calls in parallel for minimum wall time. */
	themeArt: publicProcedure
		.input(
			z.object({
				arena: z.string().min(6).max(500),
				enemy: z.string().min(6).max(500),
				ally: z.string().min(6).max(500),
			}),
		)
		.mutation(async ({ input }) => {
			if (!process.env.OPENAI_API_KEY) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "OPENAI_API_KEY is not set — add it for themed looks.",
				});
			}
			const [arena, enemy, ally] = await Promise.all([
				runThemeImageGen("arena", input.arena),
				runThemeImageGen("enemy", input.enemy),
				runThemeImageGen("ally", input.ally),
			]);
			return {
				ok: true as const,
				arena: arena.dataUrl,
				enemy: enemy.dataUrl,
				ally: ally.dataUrl,
			};
		}),
});
