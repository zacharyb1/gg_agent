import Game from "./_components/game";

export const metadata = {
	title: "Arena — Squad vs Zombies",
};

export default function GamePage() {
	return (
		<main
			className="relative flex min-h-screen w-full items-center justify-center overflow-hidden p-3 sm:p-6"
			style={{
				background:
					"radial-gradient(100% 70% at 50% 0%, #8ad4ff 0%, #5eb0f5 32%, #3a7fe0 58%, #1a5090 88%, #0a2248 100%)",
			}}
		>
			{/* Brawl match sky + distant hills (closer to in-game key art) */}
			<div
				aria-hidden
				className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_100%_45%_at_50%_0%,rgba(255,255,255,0.4)_0%,transparent_58%)]"
			/>
			<div
				aria-hidden
				className="pointer-events-none fixed bottom-0 left-0 -z-10 h-[26%] w-full bg-gradient-to-t from-[#4a9e55] via-[#6bd478] to-transparent opacity-55"
			/>
			<Game />
		</main>
	);
}
