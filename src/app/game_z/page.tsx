export const metadata = {
	title: "Brrawl Stars — 3v3",
};

export default function GameZPage() {
	return (
		<main className="flex min-h-screen w-full items-center justify-center bg-neutral-950 p-4">
			<iframe
				src="/game_z/index.html"
				title="Brrawl Stars"
				scrolling="no"
				className="h-[760px] w-[1000px] max-w-full rounded-2xl border-0"
				allow="autoplay; fullscreen; clipboard-write"
			/>
		</main>
	);
}
