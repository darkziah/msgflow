import { Link } from "@tanstack/react-router";
import { ArrowUpRight, MessageCircleMore, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

export function FacebookLegalLayout({
	children,
	eyebrow,
	title,
	description,
}: {
	children: ReactNode;
	eyebrow: string;
	title: string;
	description: string;
}) {
	return (
		<div className="min-h-screen bg-[#f6f5f1] text-[#17212d]">
			<header className="border-b border-[#17212d]/10 bg-[#f6f5f1]/90 backdrop-blur">
				<div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
					<Link to="/facebook" className="flex items-center gap-3 font-semibold tracking-tight">
						<span className="grid size-9 place-items-center rounded-xl bg-[#1877f2] text-white shadow-sm">
							<MessageCircleMore className="size-5" aria-hidden="true" />
						</span>
						<span>MsgFlow for Messenger</span>
					</Link>
					<nav aria-label="Legal navigation" className="flex items-center gap-4 text-sm font-medium text-[#405466] sm:gap-6">
						<Link to="/facebook/privacy" activeProps={{ className: "text-[#17212d]" }}>Privacy</Link>
						<Link to="/facebook/terms" activeProps={{ className: "text-[#17212d]" }}>Terms of Service</Link>
					</nav>
				</div>
			</header>
			<main className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
				<div className="mb-10 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#1877f2]">
					<ShieldCheck className="size-4" aria-hidden="true" />
					{eyebrow}
				</div>
				<h1 className="max-w-2xl text-4xl font-semibold tracking-[-0.045em] text-[#17212d] sm:text-5xl">{title}</h1>
				<p className="mt-6 max-w-2xl text-lg leading-8 text-[#52616e]">{description}</p>
				<div className="legal-prose mt-14">{children}</div>
			</main>
			<footer className="border-t border-[#17212d]/10 bg-white">
				<div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-[#52616e] sm:flex-row sm:items-center sm:justify-between sm:px-8">
					<p>© {new Date().getFullYear()} MsgFlow. Messenger integrations are operated by the applicable business.</p>
					<div className="flex gap-5 font-medium">
						<Link to="/facebook/privacy">Privacy Policy</Link>
						<Link to="/facebook/terms">Terms of Service</Link>
						<a href="https://www.facebook.com/policy.php" target="_blank" rel="noreferrer">Meta Privacy <ArrowUpRight className="inline size-3" aria-hidden="true" /></a>
					</div>
				</div>
			</footer>
		</div>
	);
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section>
			<h2>{title}</h2>
			{children}
		</section>
	);
}
