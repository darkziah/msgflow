import { createFileRoute } from "@tanstack/react-router";
import { FacebookLegalLayout, LegalSection } from "@/components/legal/FacebookLegalLayout";

export const Route = createFileRoute("/facebook/privacy")({ component: FacebookPrivacyPolicy });

function FacebookPrivacyPolicy() {
	return (
		<FacebookLegalLayout
			eyebrow="Privacy policy"
			title="Privacy Policy for MsgFlow Messenger integration"
			description="Effective October 1, 2026. This policy explains how MsgFlow processes information when a business connects a Facebook Page or uses MsgFlow to manage Page conversations."
		>
			<LegalSection title="1. Scope">
				<p>MsgFlow is a business messaging workspace. This policy applies to the MsgFlow Meta app, its Facebook Messenger integration, and the related MsgFlow service. A business that connects a Facebook Page is responsible for its own privacy notices and for its communications with people who message that Page.</p>
			</LegalSection>
			<LegalSection title="2. Information we process">
				<p>When a business authorizes MsgFlow to connect a Facebook Page, we may process Page and Messenger information made available through Meta, including:</p>
				<ul><li>the Page ID, Page name, and connection status;</li><li>Page access credentials required to provide the integration, stored in encrypted form;</li><li>the Messenger-scoped ID of a person who messages the Page;</li><li>the person’s name and profile image when Meta makes them available;</li><li>messages, message timestamps, attachments, and delivery-related metadata; and</li><li>workspace configuration, assignments, tags, and activity records created by authorized business users.</li></ul>
				<p>We do not sell Messenger data or use message content for advertising.</p>
			</LegalSection>
			<LegalSection title="3. How we use information">
				<p>We use this information only to operate the requested messaging service: to receive and display Page conversations, send replies authorized by the business, route conversations within the business’s workspace, secure the integration, troubleshoot service issues, and comply with applicable legal obligations.</p>
			</LegalSection>
			<LegalSection title="4. How information is shared">
				<p>MsgFlow shares information only as needed to provide the service: with the business and its authorized MsgFlow workspace members; with Meta to receive and send Messenger communications; and with service providers that securely host or support MsgFlow. We may disclose information where required by law or to protect the security, rights, or safety of MsgFlow, the business, or others.</p>
			</LegalSection>
			<LegalSection title="5. Retention and security">
				<p>We retain Messenger data for as long as the applicable business maintains its MsgFlow workspace or as otherwise needed for the purposes above, legal obligations, dispute resolution, and security. A business can disconnect its Page or close its workspace subject to its agreement with MsgFlow. We use administrative, technical, and organizational safeguards designed to protect information, including access controls and encryption for sensitive integration credentials. No system is completely secure.</p>
			</LegalSection>
			<LegalSection title="6. Your choices and data-deletion requests">
				<p>If you communicate with a business through Messenger, contact that business first for questions about its messages, its use of MsgFlow, or its privacy practices. To request access, correction, or deletion of personal data processed by MsgFlow, use the support contact published in the applicable Meta App listing or contact the business that operates the connected Page. We may need to verify your identity and coordinate with the business before acting on a request.</p>
				<p>You can also remove this app’s access from Facebook through Facebook’s Apps and Websites settings. Removing access stops future app access through Facebook; it does not automatically remove information the business has already received or is required to retain.</p>
			</LegalSection>
			<LegalSection title="7. International transfers">
				<p>Information may be processed in countries where MsgFlow and its service providers operate. Those countries may have data-protection laws that differ from the laws where you live.</p>
			</LegalSection>
			<LegalSection title="8. Changes and contact">
				<p>We may update this policy when our service or legal requirements change. We will post the updated version here and change its effective date. For questions about this policy, use the support contact published in the applicable Meta App listing.</p>
			</LegalSection>
		</FacebookLegalLayout>
	);
}
