import Game from "./_components/game";
import { IPhoneFrame } from "./_components/IPhoneFrame";

export const metadata = {
	title: "Viral — AI clips your gameplay",
};

export default function ViralPage() {
	return (
		<main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#020305] p-2 md:p-6">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0"
				style={{
					background: `radial-gradient(ellipse at 60% 35%, #00E5FF18 0%, transparent 55%),
                       radial-gradient(ellipse at 20% 80%, #FF004018 0%, transparent 55%)`,
					filter: "blur(60px)",
				}}
			/>
			<IPhoneFrame>
				<div className="absolute inset-0 flex h-full w-full items-center justify-center overflow-hidden bg-[#020305]">
					<Game />
				</div>
			</IPhoneFrame>
		</main>
	);
}
