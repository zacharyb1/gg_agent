import Game from "./_components/game";

export const metadata = {
	title: "Viral — AI clips your gameplay",
};

export default function ViralPage() {
	return (
		<main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#020305] p-2 md:p-6">
			{/* ambient mood haze */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0"
				style={{
					background: `radial-gradient(ellipse at 60% 35%, #00E5FF12 0%, transparent 60%),
                       radial-gradient(ellipse at 20% 80%, #FF004012 0%, transparent 60%)`,
					filter: "blur(40px)",
				}}
			/>
			<Game />
		</main>
	);
}
