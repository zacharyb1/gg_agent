import Game from "./_components/game";

export const metadata = {
	title: "Viral — AI clips your gameplay",
};

export default function ViralPage() {
	return (
		<main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#050108] p-2 md:p-6">
			{/* Layered ambient mood haze — multiple drifting blobs in mood accents */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 -z-20"
				style={{
					background:
						"radial-gradient(ellipse at 50% 50%, #1a0530 0%, #050108 70%)",
				}}
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 -z-10"
				style={{
					filter: "blur(80px)",
					animation: "viral-drift 18s ease-in-out infinite",
				}}
			>
				<div
					className="absolute"
					style={{
						top: "10%",
						left: "8%",
						width: "44vw",
						height: "44vw",
						borderRadius: "50%",
						background: "#00E5FF",
						opacity: 0.22,
					}}
				/>
				<div
					className="absolute"
					style={{
						top: "55%",
						right: "5%",
						width: "40vw",
						height: "40vw",
						borderRadius: "50%",
						background: "#FF0040",
						opacity: 0.18,
					}}
				/>
				<div
					className="absolute"
					style={{
						bottom: "-10%",
						left: "30%",
						width: "50vw",
						height: "30vw",
						borderRadius: "50%",
						background: "#FF7A1A",
						opacity: 0.16,
					}}
				/>
				<div
					className="absolute"
					style={{
						top: "-10%",
						right: "30%",
						width: "32vw",
						height: "32vw",
						borderRadius: "50%",
						background: "#A855F7",
						opacity: 0.18,
					}}
				/>
				<div
					className="absolute"
					style={{
						top: "30%",
						left: "40%",
						width: "26vw",
						height: "26vw",
						borderRadius: "50%",
						background: "#FFD400",
						opacity: 0.08,
					}}
				/>
			</div>
			{/* subtle dot grid on top to keep the bg from looking like a screensaver */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 -z-5"
				style={{
					backgroundImage:
						"radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
					backgroundSize: "32px 32px",
				}}
			/>
			<Game />
		</main>
	);
}
