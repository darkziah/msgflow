import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, LockKeyhole, MessageSquareText } from "lucide-react";
import type { ReactNode } from "react";
import { FacebookLegalLayout } from "@/components/legal/FacebookLegalLayout";

export const Route = createFileRoute("/facebook/")({ component: FacebookAppPage });

function FacebookAppPage() {
	return (
		<FacebookLegalLayout
			eyebrow="Meta app information"
			title="A clear place to manage Messenger conversations."
			description="MsgFlow helps authorized teams receive, organize, and respond to messages sent to their connected Facebook Pages."
		>
			<div className="grid gap-5 sm:grid-cols-3">
				<Feature icon={<MessageSquareText />} title="Page messaging" text="Messages are handled through the Facebook Page a business explicitly connects." />
				<Feature icon={<LockKeyhole />} title="Access controlled" text="Only authorized members of the applicable MsgFlow workspace can access its inbox." />
				<Feature icon={<CheckCircle2 />} title="Built for support" text="Teams can assign, organize, and respond to customer conversations in one place." />
			</div>
			<div className="mt-14 rounded-3xl border border-[#1877f2]/15 bg-[#eaf3ff] p-7 sm:p-9">
				<p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#1877f2]">Before you connect</p>
				<h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#17212d]">Understand how this app handles data.</h2>
				<p className="mt-3 max-w-xl leading-7 text-[#405466]">Our Privacy Policy explains what Messenger data is processed and how to request access or deletion. The Terms of Service set the rules for business use of MsgFlow.</p>
				<div className="mt-6 flex flex-wrap gap-3">
					<Link to="/facebook/privacy" className="inline-flex items-center gap-2 rounded-xl bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1465cd]">Read Privacy Policy <ArrowRight className="size-4" aria-hidden="true" /></Link>
					<Link to="/facebook/terms" className="inline-flex items-center gap-2 rounded-xl border border-[#17212d]/15 bg-white px-4 py-2.5 text-sm font-semibold text-[#17212d] transition hover:bg-[#f6f5f1]">Read Terms of Service</Link>
				</div>
			</div>
		</FacebookLegalLayout>
	);
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
	return (
		<div className="rounded-2xl border border-[#17212d]/10 bg-white p-6 shadow-[0_10px_30px_-24px_rgba(23,33,45,0.5)]">
			<span className="grid size-10 place-items-center rounded-xl bg-[#eaf3ff] text-[#1877f2]">{icon}</span>
			<h2 className="mt-5 text-lg font-semibold tracking-tight">{title}</h2>
			<p className="mt-2 text-sm leading-6 text-[#52616e]">{text}</p>
		</div>
	);
}
