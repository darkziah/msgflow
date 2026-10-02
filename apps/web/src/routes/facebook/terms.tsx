import { createFileRoute } from "@tanstack/react-router";
import { FacebookLegalLayout, LegalSection } from "@/components/legal/FacebookLegalLayout";

export const Route = createFileRoute("/facebook/terms")({ component: FacebookTerms });

function FacebookTerms() {
	return (
		<FacebookLegalLayout
			eyebrow="Terms of service"
			title="Terms of Service for MsgFlow"
			description="Effective October 1, 2026. These terms govern a business’s use of MsgFlow and its Facebook Messenger integration."
		>
			<LegalSection title="1. Acceptance and authority">
				<p>By accessing or using MsgFlow, you agree to these Terms of Service on behalf of yourself and, if applicable, the business or organization you represent. You confirm that you have authority to bind that business or organization to these terms.</p>
			</LegalSection>
			<LegalSection title="2. The service">
				<p>MsgFlow provides tools for authorized teams to manage communications from connected Facebook Pages and other supported business channels. The service is intended for business use. We may change, suspend, or discontinue features where reasonably necessary to operate, secure, or improve the service.</p>
			</LegalSection>
			<LegalSection title="3. Account and Page connection responsibilities">
				<p>You must provide accurate account information, protect your access credentials, and promptly revoke access for people who should no longer use your workspace. You may connect only Facebook Pages that you are authorized to manage. You are responsible for keeping your Meta app, Page permissions, Page policies, and Messenger settings compliant with Meta’s requirements.</p>
			</LegalSection>
			<LegalSection title="4. Acceptable use">
				<p>You must not use MsgFlow to violate law, infringe rights, send spam or unlawful content, deceive people, distribute malware, interfere with the service, attempt unauthorized access, or process data without a valid legal basis. You must respect applicable messaging-consent, consumer-protection, and data-protection requirements.</p>
			</LegalSection>
			<LegalSection title="5. Your content and customer data">
				<p>You retain responsibility for the content and personal data you submit to or process through MsgFlow. You instruct MsgFlow to process that information only to provide, secure, and support the service. You must provide any required notices to people who communicate with your business and handle their privacy requests in accordance with applicable law.</p>
			</LegalSection>
			<LegalSection title="6. Meta platform terms">
				<p>Your use of Facebook and Messenger through MsgFlow is also subject to Meta’s applicable terms, policies, and platform requirements. Meta is not responsible for MsgFlow, and MsgFlow is not endorsed by or affiliated with Meta except as permitted for the integration. If these terms conflict with a mandatory Meta platform requirement, that requirement controls for the Meta-related portion of the service.</p>
			</LegalSection>
			<LegalSection title="7. Availability, disclaimers, and liability">
				<p>MsgFlow is provided on an “as is” and “as available” basis to the extent permitted by law. We do not guarantee uninterrupted operation, error-free service, message delivery, or continued availability of any third-party platform. To the maximum extent permitted by law, MsgFlow is not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenue, data, goodwill, or business opportunity arising from use of the service.</p>
			</LegalSection>
			<LegalSection title="8. Suspension and termination">
				<p>We may suspend or terminate access where we reasonably believe use violates these terms, applicable law, Meta requirements, or the security of the service. You may stop using MsgFlow and disconnect your Page at any time, subject to any separate agreement with MsgFlow and applicable retention obligations.</p>
			</LegalSection>
			<LegalSection title="9. Changes to these terms">
				<p>We may update these terms by posting a revised version on this page. Continued use after the effective date of an update means you accept the revised terms to the extent permitted by law.</p>
			</LegalSection>
			<LegalSection title="10. Contact">
				<p>For questions about these terms, use the support contact published in the applicable Meta App listing.</p>
			</LegalSection>
		</FacebookLegalLayout>
	);
}
