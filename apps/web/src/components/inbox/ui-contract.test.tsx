import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ConversationSummary } from "@msgflow/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppMobileHeader } from "@/components/layout/AppMobileHeader";
import { AppShell } from "@/components/layout/AppShell";

import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { emailApi } from "@/lib/email-api";
import {
	Inbox,
	queueIdentity,
	Route,
	resetFiltersForStatus,
} from "@/routes/index";
import { Composer } from "./Composer";
import { ConversationActions } from "./ConversationActions";
import { ConversationList } from "./ConversationList";
import { ConversationThread } from "./ConversationThread";
import { KeyboardShortcutsProvider } from "./KeyboardShortcutsProvider";
import { activeFilterCount, SearchBar } from "./SearchBar";
import { TagPicker } from "./TagPicker";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
	HTMLElement.prototype,
	"scrollIntoView",
);

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
}));

vi.mock("@/lib/api", () => ({
	api: {
		createComment: vi.fn(),
		completeFirstSignInWalkthrough: vi.fn(),
		addConversationTag: vi.fn(),
		getConversation: vi.fn(),
		getFirstSignInWalkthrough: vi.fn(),
		getMessages: vi.fn(),
		listConversations: vi.fn(),
		listCannedReplies: vi.fn(),
		workspaceListInboxes: vi.fn(),
		listTags: vi.fn(),
		listUsers: vi.fn(),
		listWorkspaces: vi.fn(),
		markRead: vi.fn(),
		removeConversationTag: vi.fn(),
		sendMessage: vi.fn(),
		updateConversation: vi.fn(),
	},
	conversationSocketUrl: vi.fn(() => "ws://localhost/ws"),
}));

vi.mock("@/lib/email-api", () => ({
	emailApi: {
		attachmentUrl: vi.fn((id: string) => `/attachments/${id}`),
		context: vi.fn(),
		deleteDraft: vi.fn(),
		getDraft: vi.fn(),
		saveDraft: vi.fn(),
		upload: vi.fn(),
	},
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: { signOut: vi.fn() },
	useSession: () => ({
		data: { user: { id: "user_123", email: "morgan@example.com" } },
	}),
}));

vi.mock("@/components/sidebar/Sidebar", () => ({
	Sidebar: () => null,
}));

const conversation: ConversationSummary = {
	id: "conv_123",
	channel: "email",
	channelId: "channel_support",
	channelDisplayName: "Support",
	inboxId: "inbox_support",
	subject: "Billing question",
	status: "open",
	assigneeId: null,
	contact: {
		id: "contact_123",
		displayName: "Avery Chen",
		primaryEmail: "avery@example.com",
		avatarUrl: null,
	},
	lastMessageAt: "2026-09-26T12:00:00.000Z",
	lastMessagePreview: "Could you send my latest invoice?",
	messageCount: 3,
	unreadCount: 2,
	snoozedUntil: null,
	createdAt: "2026-09-25T12:00:00.000Z",
	updatedAt: "2026-09-26T12:00:00.000Z",
	tags: [
		{
			id: "tag_billing",
			name: "Billing",
			color: "blue",
			visibility: "shared",
			parentTagId: null,
			ownerUserId: null,
			createdAt: "2026-09-25T12:00:00.000Z",
		},
	],
};

function renderWithQueryClient(ui: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>{ui}</TooltipProvider>
		</QueryClientProvider>,
	);
}

function renderThreadWithShortcuts(threadConversation = conversation) {
	vi.mocked(api.getConversation).mockResolvedValue(threadConversation);
	vi.mocked(api.getMessages).mockResolvedValue({
		messages: [],
		comments: [],
		activities: [],
	} as never);
	return renderWithQueryClient(
		<KeyboardShortcutsProvider>
			<ConversationThread
				conversationId={threadConversation.id}
				workspaceId="workspace-1"
			/>
		</KeyboardShortcutsProvider>,
	);
}

const shortcutConversation: ConversationSummary = {
	...conversation,
	channel: "facebook",
	channelDisplayName: "Messenger",
};

describe("inbox UI contracts", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"WebSocket",
			class {
				onmessage: ((event: MessageEvent) => void) | null = null;
				close() {}
			},
		);
		vi.mocked(emailApi.context).mockResolvedValue({
			mailboxes: [],
			deliveryStates: [],
			receivingMailboxId: null,
			receivingMailboxType: "shared",
			recipient: null,
			subject: null,
		} as never);
		vi.mocked(emailApi.getDraft).mockResolvedValue({ draft: null } as never);
		HTMLElement.prototype.scrollIntoView = vi.fn();
		vi.mocked(api.listUsers).mockResolvedValue({
			users: [
				{ id: "user_123", name: "Morgan Lee", email: "morgan@example.com" },
			],
		});
		vi.mocked(api.workspaceListInboxes).mockResolvedValue({
			inboxes: [
				{
					id: "inbox_support",
					name: "Support",
					description: null,
					color: "#2563eb",
					icon: null,
					teamId: null,
					teamName: null,
					sortOrder: 0,
					isArchived: false,
					assignmentStrategy: "manual",
					isDefault: true,
					channels: [],
					memberIds: [],
					conversationCount: 1,
					createdAt: "2026-09-25T12:00:00.000Z",
					updatedAtMs: null,
				},
			],
		});
		vi.mocked(api.listTags).mockResolvedValue({ tags: [] });
		vi.mocked(api.listCannedReplies).mockResolvedValue({ cannedReplies: [] });
		vi.mocked(api.addConversationTag).mockResolvedValue({} as never);
		vi.mocked(api.removeConversationTag).mockResolvedValue({} as never);
		vi.mocked(api.listWorkspaces).mockResolvedValue({
			workspaces: [
				{
					id: "workspace_123",
					name: "Support",
					slug: "support",
					role: "member",
					createdAt: "2026-09-25T12:00:00.000Z",
				},
			],
		});
		vi.mocked(api.getFirstSignInWalkthrough).mockResolvedValue({
			completed: true,
		});
		vi.mocked(api.listConversations).mockResolvedValue({ conversations: [] });
		vi.mocked(api.updateConversation).mockResolvedValue({
			success: true,
			conversation,
		});
	});

	afterEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		if (originalScrollIntoView) {
			Object.defineProperty(
				HTMLElement.prototype,
				"scrollIntoView",
				originalScrollIntoView,
			);
		} else {
			Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
		}
	});

	it("renders selected contact, preview, channel, unread count, and tags", () => {
		render(
			<ConversationList
				conversations={[conversation]}
				selectedId={conversation.id}
				onSelect={vi.fn()}
			/>,
		);

		const selectedConversation = screen.getByRole("button", {
			name: /avery chen/i,
		});
		expect(selectedConversation).toHaveClass("bg-primary/10");
		expect(selectedConversation).toHaveAttribute("aria-pressed", "true");
		expect(selectedConversation).toHaveAttribute("aria-current", "true");
		expect(
			within(selectedConversation).getByText("Avery Chen"),
		).toBeInTheDocument();
		expect(
			within(selectedConversation).getByText(
				"Could you send my latest invoice?",
			),
		).toBeInTheDocument();
		expect(
			selectedConversation.querySelector("svg.lucide-mail"),
		).toBeInTheDocument();
		expect(within(selectedConversation).getByText("2")).toBeInTheDocument();
		expect(
			within(selectedConversation).getByText("Billing"),
		).toBeInTheDocument();
	});

	it("renders WhatsApp with explicit WhatsApp text and icon semantics", () => {
		const whatsappConversation: ConversationSummary = {
			...conversation,
			id: "wa:phone-1:customer-1",
			channel: "whatsapp",
			channelDisplayName: "WhatsApp Support",
		};
		render(
			<ConversationList
				conversations={[whatsappConversation]}
				onSelect={vi.fn()}
			/>,
		);

		const row = screen.getByRole("button", { name: /avery chen/i });
		expect(within(row).getByRole("img", { name: "WhatsApp" })).toBeInTheDocument();
		expect(row.querySelector('[title="WhatsApp"]')).toBeInTheDocument();
		expect(row.querySelector("svg.lucide-message-circle-more")).toBeInTheDocument();
	});

	it("renders an empty state when no conversations match", () => {
		render(<ConversationList conversations={[]} onSelect={vi.fn()} />);

		expect(screen.getByText("No conversations here yet.")).toBeInTheDocument();
		expect(document.querySelector('[data-slot="empty"]')).toBeInTheDocument();
	});

	it("archives an open conversation through the API", async () => {
		renderWithQueryClient(
			<ConversationActions
				conversation={conversation}
				workspaceId="workspace-1"
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Archive conversation" }),
		);

		await waitFor(() => {
			expect(api.updateConversation).toHaveBeenCalledWith(conversation.id, {
				status: "archived",
				workspaceId: "workspace-1",
			});
		});
	});

	it("reopens an archived conversation with the exact API payload", async () => {
		renderWithQueryClient(
			<ConversationActions
				conversation={{ ...conversation, status: "archived" }}
				workspaceId="workspace-1"
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Reopen conversation" }),
		);

		await waitFor(() => {
			expect(api.updateConversation).toHaveBeenCalledWith(conversation.id, {
				status: "open",
				workspaceId: "workspace-1",
			});
		});
	});

	it("keeps detail actions compact and exposes their purpose", () => {
		renderWithQueryClient(
			<ConversationActions
				conversation={conversation}
				workspaceId="workspace-1"
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Archive conversation" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Assign conversation" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Move conversation" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Snooze conversation" }),
		).toBeInTheDocument();
	});

	it("shows a loading surface before conversation data arrives", () => {
		vi.mocked(api.getConversation).mockReturnValue(new Promise(() => {}));
		vi.mocked(api.getMessages).mockReturnValue(new Promise(() => {}));
		renderWithQueryClient(
			<KeyboardShortcutsProvider>
				<ConversationThread
					conversationId={conversation.id}
					workspaceId="workspace-1"
				/>
			</KeyboardShortcutsProvider>,
		);
		expect(screen.getByLabelText("Loading conversation")).toBeInTheDocument();
	});

	it("renders the detail header with its contact and channel", async () => {
		vi.mocked(api.getConversation).mockResolvedValue(conversation);
		vi.mocked(api.getMessages).mockResolvedValue({
			messages: [],
			comments: [],
			activities: [],
		} as never);
		renderWithQueryClient(
			<KeyboardShortcutsProvider>
				<ConversationThread
					conversationId={conversation.id}
					workspaceId="workspace-1"
				/>
			</KeyboardShortcutsProvider>,
		);

		expect(
			await screen.findByRole("heading", { name: "Avery Chen" }),
		).toBeInTheDocument();
		expect(screen.getByText("Support")).toBeInTheDocument();
		expect(screen.getByText("Billing question")).toBeInTheDocument();
	});

	it("archives through the thread shortcut with the exact existing payload", async () => {
		renderThreadWithShortcuts(shortcutConversation);

		await screen.findByRole("heading", { name: "Avery Chen" });
		fireEvent.keyDown(document, { key: "e", cancelable: true });

		await waitFor(() => {
			expect(api.updateConversation).toHaveBeenCalledWith(conversation.id, {
				status: "archived",
				workspaceId: "workspace-1",
			});
		});
	});

	it("focuses the reply composer through the R shortcut", async () => {
		renderThreadWithShortcuts(shortcutConversation);

		await screen.findByRole("heading", { name: "Avery Chen" });
		fireEvent.click(screen.getByRole("radio", { name: "Comment" }));
		fireEvent.keyDown(document, { key: "r", cancelable: true });

		const reply = await screen.findByRole("textbox", { name: "Reply text" });
		await waitFor(() => expect(reply).toHaveFocus());
	});

	it("switches to and focuses the comment composer through Cmd/Ctrl+.", async () => {
		renderThreadWithShortcuts(shortcutConversation);

		await screen.findByRole("heading", { name: "Avery Chen" });
		fireEvent.keyDown(document, { key: ".", metaKey: true, cancelable: true });

		const comment = await screen.findByRole("textbox", { name: "Comment text" });
		await waitFor(() => expect(comment).toHaveFocus());
	});

	it("opens saved replies through Cmd/Ctrl+Shift+O only in Reply mode", async () => {
		vi.mocked(api.listCannedReplies).mockResolvedValue({
			cannedReplies: [
				{
					id: "reply_billing",
					name: "Billing follow-up",
					body: "I will send your invoice today.",
					createdAt: "2026-09-26T12:00:00.000Z",
					updatedAt: "2026-09-26T12:00:00.000Z",
				},
			],
		});
		renderThreadWithShortcuts(shortcutConversation);

		await screen.findByRole("button", { name: "Saved replies" });
		fireEvent.keyDown(document, {
			key: "o",
			metaKey: true,
			shiftKey: true,
			cancelable: true,
		});
		expect(
			await screen.findByRole("dialog", { name: "Saved replies" }),
		).toBeInTheDocument();
		fireEvent.keyDown(document, { key: "Escape", cancelable: true });
		await waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "Saved replies" }),
			).not.toBeInTheDocument(),
		);
		fireEvent.click(screen.getByRole("radio", { name: "Comment" }));
		const commentSavedReplies = new KeyboardEvent("keydown", {
			key: "o",
			metaKey: true,
			shiftKey: true,
			cancelable: true,
		});
		document.dispatchEvent(commentSavedReplies);
		expect(commentSavedReplies.defaultPrevented).toBe(false);
		expect(
			screen.queryByRole("dialog", { name: "Saved replies" }),
		).not.toBeInTheDocument();
	});

	it("submits the existing composer payload through Cmd/Ctrl+Enter without archiving", async () => {
		vi.mocked(api.sendMessage).mockResolvedValue({
			success: true,
			sent: true,
			message: {},
		} as never);
		renderThreadWithShortcuts(shortcutConversation);

		const reply = await screen.findByRole("textbox", { name: "Reply text" });
		fireEvent.change(reply, { target: { value: "  I can help with that.  " } });
		fireEvent.keyDown(reply, {
			key: "Enter",
			metaKey: true,
			cancelable: true,
		});

		await waitFor(() => {
			expect(api.sendMessage).toHaveBeenCalledWith(
				conversation.id,
				"workspace-1",
					expect.objectContaining({ text: "I can help with that." }),
			);
		});
		expect(api.updateConversation).not.toHaveBeenCalled();
	});

	it("keeps ordinary Enter on the composer submit path", async () => {
		vi.mocked(api.sendMessage).mockResolvedValue({
			success: true,
			sent: true,
			message: {},
		} as never);
		renderThreadWithShortcuts(shortcutConversation);

		const reply = await screen.findByRole("textbox", { name: "Reply text" });
		fireEvent.change(reply, { target: { value: "I can help with that." } });
		fireEvent.keyDown(reply, { key: "Enter", cancelable: true });

		await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
	});

	it("opens the existing tag picker and action menus through thread shortcuts", async () => {
		renderThreadWithShortcuts(shortcutConversation);

		await screen.findByRole("heading", { name: "Avery Chen" });
		fireEvent.keyDown(document, { key: "t", cancelable: true });
		expect(
			await screen.findByRole("dialog", { name: "Add a tag" }),
		).toBeInTheDocument();
		expect(api.addConversationTag).not.toHaveBeenCalled();
		fireEvent.keyDown(document, { key: "Escape", cancelable: true });

		fireEvent.keyDown(document, { key: "A", shiftKey: true, cancelable: true });
		expect(
			await screen.findByRole("menu", { name: "Assign conversation" }),
		).toBeInTheDocument();
		fireEvent.keyDown(document, { key: "Escape", cancelable: true });

		fireEvent.keyDown(document, { key: "M", shiftKey: true, cancelable: true });
		expect(
			await screen.findByRole("menu", { name: "Move conversation" }),
		).toBeInTheDocument();
		fireEvent.keyDown(document, { key: "Escape", cancelable: true });

		fireEvent.keyDown(document, { key: "s", cancelable: true });
		expect(
			await screen.findByRole("menu", { name: "Snooze conversation" }),
		).toBeInTheDocument();
	});

	it("does not archive while the tag picker or an action menu is open", async () => {
		renderThreadWithShortcuts(shortcutConversation);

		await screen.findByRole("heading", { name: "Avery Chen" });
		fireEvent.keyDown(document, { key: "t", cancelable: true });
		await screen.findByRole("dialog", { name: "Add a tag" });
		const tagArchiveEvent = new KeyboardEvent("keydown", {
			key: "e",
			cancelable: true,
		});
		document.dispatchEvent(tagArchiveEvent);
		expect(tagArchiveEvent.defaultPrevented).toBe(false);
		expect(api.updateConversation).not.toHaveBeenCalled();
		fireEvent.keyDown(document, { key: "Escape", cancelable: true });

		fireEvent.keyDown(document, { key: "A", shiftKey: true, cancelable: true });
		await screen.findByRole("menu", { name: "Assign conversation" });
		const assignArchiveEvent = new KeyboardEvent("keydown", {
			key: "e",
			cancelable: true,
		});
		document.dispatchEvent(assignArchiveEvent);
		expect(assignArchiveEvent.defaultPrevented).toBe(false);
		expect(api.updateConversation).not.toHaveBeenCalled();
	});

	it("collapses earlier emails while keeping the newest email open", async () => {
		vi.mocked(api.getConversation).mockResolvedValue(conversation);
		vi.mocked(api.markRead).mockResolvedValue(undefined as never);
		vi.mocked(api.getMessages).mockResolvedValue({
			messages: [
				{
					id: "message_old",
					kind: "inbound",
					seq: 1,
					text: "Earlier email body",
					attachments: [],
					createdAt: "2026-09-25T12:00:00.000Z",
				},
				{
					id: "message_latest",
					kind: "outbound",
					seq: 2,
					text: "Latest email body",
					attachments: [],
					createdAt: "2026-09-26T12:00:00.000Z",
				},
			],
			comments: [],
			activities: [],
		} as never);
		renderWithQueryClient(
			<KeyboardShortcutsProvider>
				<ConversationThread
					conversationId={conversation.id}
					workspaceId="workspace-1"
				/>
			</KeyboardShortcutsProvider>,
		);

		const earlierEmail = await screen.findByText("Earlier email body");
		expect(earlierEmail).not.toBeVisible();
		expect(screen.getByText("Latest email body")).toBeVisible();
		expect(
			screen.getByText("Incoming email").closest("article"),
		).toHaveAttribute("data-email-direction", "received");
		expect(screen.getByText("Sent email").closest("article")).toHaveAttribute(
			"data-email-direction",
			"sent",
		);

		fireEvent.click(screen.getByRole("button", { name: "Show email" }));
		expect(earlierEmail).toBeVisible();
		expect(screen.getAllByRole("button", { name: "Hide email" })).toHaveLength(
			2,
		);
	});

	it("disables an empty reply and sends the preserved message payload", async () => {
		vi.mocked(api.sendMessage).mockResolvedValue({
			success: true,
			sent: true,
			message: {},
		} as never);
		renderWithQueryClient(
			<Composer conversationId={conversation.id} workspaceId="workspace-1" />,
		);

		const send = screen.getByRole("button", { name: "Send" });
		expect(send).toBeDisabled();
		fireEvent.change(screen.getByRole("textbox", { name: "Reply text" }), {
			target: { value: "  I can help with that.  " },
		});
		fireEvent.click(send);

		await waitFor(() => {
			expect(api.sendMessage).toHaveBeenCalledWith(
				conversation.id,
				"workspace-1",
				expect.objectContaining({ text: "I can help with that." }),
			);
		});
	});

	it("inserts a saved reply into the composer without sending it", async () => {
		vi.mocked(api.listCannedReplies).mockResolvedValue({
			cannedReplies: [
				{
					id: "reply_billing",
					name: "Billing follow-up",
					body: "I will send your invoice today.",
					createdAt: "2026-09-26T12:00:00.000Z",
					updatedAt: "2026-09-26T12:00:00.000Z",
				},
				{
					id: "reply_shipping",
					name: "Shipping follow-up",
					body: "I will check your delivery status.",
					createdAt: "2026-09-26T12:00:00.000Z",
					updatedAt: "2026-09-26T12:00:00.000Z",
				},
			],
		});
		renderWithQueryClient(
			<Composer conversationId={conversation.id} workspaceId="workspace-1" />,
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Saved replies" }),
		);
		expect(
			await screen.findByRole("dialog", { name: "Saved replies" }),
		).toBeInTheDocument();
		fireEvent.change(
			screen.getByRole("textbox", { name: "Search saved replies" }),
			{
				target: { value: "invoice" },
			},
		);
		fireEvent.click(screen.getByRole("button", { name: /billing follow-up/i }));

		expect(screen.getByRole("textbox", { name: "Reply text" })).toHaveValue(
			"I will send your invoice today.",
		);
		expect(
			screen.queryByRole("dialog", { name: "Saved replies" }),
		).not.toBeInTheDocument();
		expect(api.sendMessage).not.toHaveBeenCalled();
	});

	it("prevents a second send while the first request is pending", async () => {
		vi.mocked(api.sendMessage).mockImplementation(() => new Promise(() => {}));
		renderWithQueryClient(
			<Composer conversationId={conversation.id} workspaceId="workspace-1" />,
		);

		fireEvent.change(screen.getByRole("textbox", { name: "Reply text" }), {
			target: { value: "I can help with that." },
		});
		const send = screen.getByRole("button", { name: "Send" });
		fireEvent.click(send);
		fireEvent.click(send);
		await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
	});

	it("uses a focusable attachment button to open the hidden file input", () => {
		renderWithQueryClient(
			<Composer conversationId={conversation.id} workspaceId="workspace-1" />,
		);

		const input =
			document.querySelector<HTMLInputElement>('input[type="file"]');
		if (!input) throw new Error("Expected attachment input");
		const click = vi.spyOn(input, "click");
		fireEvent.click(screen.getByRole("button", { name: "Add attachments" }));
		expect(click).toHaveBeenCalledOnce();
	});

	it("uses a labeled popover and preserves tag mutation payloads", async () => {
		const availableTag = {
			...conversation.tags[0],
			id: "tag_urgent",
			name: "Urgent",
		};
		vi.mocked(api.listTags).mockResolvedValue({
			tags: [...conversation.tags, availableTag],
		});
		renderWithQueryClient(
			<TagPicker
				conversationId={conversation.id}
				workspaceId="workspace-1"
				tags={conversation.tags}
			/>,
		);

		await waitFor(() => expect(api.listTags).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: "Tag" }));
		expect(
			await screen.findByRole("dialog", { name: "Add a tag" }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Urgent" }));
		await waitFor(() => {
			expect(api.addConversationTag).toHaveBeenCalledWith(
				"workspace-1",
				conversation.id,
				availableTag.id,
			);
		});

		fireEvent.click(screen.getByRole("button", { name: "Remove tag Billing" }));
		await waitFor(() => {
			expect(api.removeConversationTag).toHaveBeenCalledWith(
				"workspace-1",
				conversation.id,
				"tag_billing",
			);
		});
	});

	it("uses exclusive toggle semantics for Reply and Comment", () => {
		renderWithQueryClient(
			<Composer conversationId={conversation.id} workspaceId="workspace-1" />,
		);

		const reply = screen.getByRole("radio", { name: "Reply" });
		const comment = screen.getByRole("radio", { name: "Comment" });
		expect(reply).toBeChecked();
		expect(comment).not.toBeChecked();

		fireEvent.click(comment);
		expect(reply).not.toBeChecked();
		expect(comment).toBeChecked();
		expect(
			screen.getByRole("textbox", { name: "Comment text" }),
		).toBeInTheDocument();
	});

	it("disables email sending when the required email context is absent", async () => {
		renderWithQueryClient(
			<Composer
				conversationId={conversation.id}
				workspaceId="workspace-1"
				showSubject
			/>,
		);

		const reply = await screen.findByRole("textbox", { name: "Reply text" });
		fireEvent.change(reply, { target: { value: "I can help with that." } });
		expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
		expect(emailApi.context).toHaveBeenCalledWith(
			conversation.id,
			"workspace-1",
		);
		expect(emailApi.getDraft).toHaveBeenCalledWith(
			conversation.id,
			"workspace-1",
		);
	});

	it("enables WhatsApp text replies while keeping attachments unavailable", () => {
		renderWithQueryClient(
			<Composer
				conversationId="wa:phone-1:customer-1"
				workspaceId="workspace-1"
				attachmentUnavailable
			/>,
		);

		expect(screen.getByRole("textbox", { name: "Reply text" })).toBeEnabled();
		expect(screen.getByRole("button", { name: "Add attachments" })).toBeDisabled();
		expect(screen.getByRole("status")).toHaveTextContent(
			"WhatsApp supports text replies only; attachments are unavailable.",
		);
	});

	it("opens the activity dialog with its accessible name", async () => {
		vi.mocked(api.getConversation).mockResolvedValue(conversation);
		vi.mocked(api.getMessages).mockResolvedValue({
			messages: [],
			comments: [],
			activities: [],
		} as never);
		renderWithQueryClient(
			<KeyboardShortcutsProvider>
				<ConversationThread
					conversationId={conversation.id}
					workspaceId="workspace-1"
				/>
			</KeyboardShortcutsProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Activity" }));
		expect(
			screen.getByRole("dialog", { name: "Activity" }),
		).toBeInTheDocument();
	});

	it("submits an entered search query only on Enter", () => {
		const onChange = vi.fn();
		renderWithQueryClient(
			<SearchBar filters={{}} workspaceId="workspace-1" onChange={onChange} />,
		);

		const input = screen.getByPlaceholderText("Search conversations… (Enter)");
		fireEvent.change(input, { target: { value: " invoice  " } });
		fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
		expect(onChange).toHaveBeenCalledWith({ q: "invoice" });
	});

	it("syncs the visible search query after an external filter reset", async () => {
		const onChange = vi.fn();
		const view = renderWithQueryClient(
			<SearchBar
				filters={{ q: "invoice" }}
				workspaceId="workspace-1"
				onChange={onChange}
			/>,
		);
		const input = screen.getByRole("textbox", { name: "Search conversations" });
		expect(input).toHaveValue("invoice");

		view.rerender(
			<QueryClientProvider client={new QueryClient()}>
				<TooltipProvider>
					<SearchBar
						filters={{}}
						workspaceId="workspace-1"
						onChange={onChange}
					/>
				</TooltipProvider>
			</QueryClientProvider>,
		);

		await waitFor(() => expect(input).toHaveValue(""));
		expect(onChange).not.toHaveBeenCalled();
	});

	it("focuses search and navigates visible conversations with inbox shortcuts", async () => {
		const conversations = [
			conversation,
			{
				...conversation,
				id: "conv_456",
				contact: { ...conversation.contact, displayName: "Blair Fox" },
			},
			{
				...conversation,
				id: "conv_789",
				contact: { ...conversation.contact, displayName: "Casey Rowe" },
			},
		];
		let search: { workspace?: string; c?: string } = {};
		const useSearch = vi
			.spyOn(Route, "useSearch")
			.mockImplementation(() => search);
		navigate.mockImplementation(({ search: nextSearch }) => {
			search = nextSearch;
		});
		vi.mocked(api.listConversations).mockResolvedValue({ conversations });
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const view = render(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<Inbox />
				</TooltipProvider>
			</QueryClientProvider>,
		);

		const searchInputs = await screen.findAllByRole("textbox", {
			name: "Search conversations",
		});
		await screen.findAllByRole("button", { name: /avery chen/i });
		navigate.mockClear();
		const focusSearchEvent = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "f",
			ctrlKey: true,
			shiftKey: true,
		});
		document.dispatchEvent(focusSearchEvent);
		expect(searchInputs).toContain(document.activeElement);
		expect(focusSearchEvent.defaultPrevented).toBe(true);

		if (document.activeElement instanceof HTMLElement)
			document.activeElement.blur();

		search = { workspace: "workspace_123" };
		view.rerender(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<Inbox />
				</TooltipProvider>
			</QueryClientProvider>,
		);
		navigate.mockClear();
		fireEvent.keyDown(document, { key: "ArrowUp" });
		await waitFor(() =>
			expect(navigate).toHaveBeenLastCalledWith({
				to: "/",
				search: { workspace: "workspace_123", c: "conv_789" },
			}),
		);

		search = { workspace: "workspace_123" };
		view.rerender(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<Inbox />
				</TooltipProvider>
			</QueryClientProvider>,
		);
		navigate.mockClear();
		const firstNextEvent = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "ArrowDown",
		});
		document.dispatchEvent(firstNextEvent);
		await waitFor(() =>
			expect(navigate).toHaveBeenLastCalledWith({
				to: "/",
				search: { workspace: "workspace_123", c: "conv_123" },
			}),
		);
		expect(firstNextEvent.defaultPrevented).toBe(true);

		view.rerender(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<Inbox />
				</TooltipProvider>
			</QueryClientProvider>,
		);
		fireEvent.keyDown(document, { key: "ArrowDown" });
		await waitFor(() =>
			expect(navigate).toHaveBeenLastCalledWith({
				to: "/",
				search: { workspace: "workspace_123", c: "conv_456" },
			}),
		);

		view.rerender(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<Inbox />
				</TooltipProvider>
			</QueryClientProvider>,
		);
		fireEvent.keyDown(document, { key: "ArrowDown" });
		await waitFor(() =>
			expect(navigate).toHaveBeenLastCalledWith({
				to: "/",
				search: { workspace: "workspace_123", c: "conv_789" },
			}),
		);

		const callCountAtBoundary = navigate.mock.calls.length;
		view.rerender(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<Inbox />
				</TooltipProvider>
			</QueryClientProvider>,
		);
		const boundaryEvent = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "ArrowDown",
		});
		document.dispatchEvent(boundaryEvent);
		expect(navigate).toHaveBeenCalledTimes(callCountAtBoundary);
		expect(boundaryEvent.defaultPrevented).toBe(false);

		const typingInput = screen.getAllByRole("textbox", {
			name: "Search conversations",
		})[0];
		fireEvent.focus(typingInput);
		const typingEvent = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "ArrowUp",
		});
		typingInput.dispatchEvent(typingEvent);
		expect(navigate).toHaveBeenCalledTimes(callCountAtBoundary);
		expect(typingEvent.defaultPrevented).toBe(false);
		useSearch.mockRestore();
	});

	it("leaves ArrowUp and ArrowDown unhandled when there are no conversations", async () => {
		const useSearch = vi
			.spyOn(Route, "useSearch")
			.mockReturnValue({ workspace: "workspace_123" });
		vi.mocked(api.listConversations).mockResolvedValue({ conversations: [] });
		renderWithQueryClient(<Inbox />);

		await screen.findAllByText("No conversations here yet.");
		navigate.mockClear();
		for (const key of ["ArrowUp", "ArrowDown"]) {
			const event = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key,
			});
			document.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(navigate).not.toHaveBeenCalled();
		useSearch.mockRestore();
	});

	it("leaves ArrowUp unhandled at the first conversation", async () => {
		const useSearch = vi.spyOn(Route, "useSearch").mockReturnValue({
			workspace: "workspace_123",
			c: conversation.id,
		});
		vi.mocked(api.listConversations).mockResolvedValue({
			conversations: [conversation],
		});
		renderWithQueryClient(<Inbox />);

		await screen.findByRole("button", { name: /avery chen/i });
		navigate.mockClear();
		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "ArrowUp",
		});
		document.dispatchEvent(event);
		expect(navigate).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		useSearch.mockRestore();
	});

	it("clears all search filters", () => {
		const onChange = vi.fn();
		renderWithQueryClient(
			<SearchBar
				filters={{ channel: "email", q: "invoice" }}
				workspaceId="workspace-1"
				onChange={onChange}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /filters/i }));
		fireEvent.click(screen.getByRole("button", { name: "Clear" }));
		expect(onChange).toHaveBeenCalledWith({});
	});

	it("shows advanced facets in a popover and clears them", () => {
		const onChange = vi.fn();
		renderWithQueryClient(
			<SearchBar
				filters={{ channel: "email", q: "invoice" }}
				workspaceId="workspace-1"
				onChange={onChange}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /filters/i }));
		expect(
			screen.getByRole("dialog", { name: "Advanced filters" }),
		).toBeInTheDocument();
		expect(screen.getByText("Assignee")).toBeInTheDocument();
		expect(screen.getByText("Channel")).toBeInTheDocument();
		expect(screen.getByText("Tag")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Clear" }));
		expect(onChange).toHaveBeenLastCalledWith({});
	});

	it("clears route query facets after applying one", async () => {
		vi.spyOn(Route, "useSearch").mockReturnValue({});
		renderWithQueryClient(<Inbox />);

		await screen.findAllByRole("button", { name: /filters/i });
		fireEvent.click(screen.getAllByRole("button", { name: /filters/i })[0]);
		fireEvent.click(screen.getByLabelText("Channel"));
		fireEvent.click(await screen.findByRole("option", { name: "Email" }));

		await waitFor(() => {
			expect(api.listConversations).toHaveBeenLastCalledWith(
				expect.objectContaining({ channel: "email" }),
			);
		});

		fireEvent.click(screen.getByRole("button", { name: "Clear" }));

		await waitFor(() => {
			expect(api.listConversations).toHaveBeenLastCalledWith(
				expect.objectContaining({ channel: undefined }),
			);
		});
	});

	it("applies the WhatsApp channel facet from advanced filters", async () => {
		vi.spyOn(Route, "useSearch").mockReturnValue({});
		renderWithQueryClient(<Inbox />);

		await screen.findAllByRole("button", { name: /filters/i });
		fireEvent.click(screen.getAllByRole("button", { name: /filters/i })[0]);
		fireEvent.click(screen.getByLabelText("Channel"));
		fireEvent.click(await screen.findByRole("option", { name: "WhatsApp" }));

		await waitFor(() => {
			expect(api.listConversations).toHaveBeenLastCalledWith(
				expect.objectContaining({ channel: "whatsapp" }),
			);
		});
	});

	it("counts active filters without counting absent values", () => {
		expect(
			activeFilterCount({ q: "invoice", channel: "email", tagId: undefined }),
		).toBe(2);
	});

	it("resets status-scoped filters when switching status tabs", () => {
		expect(
			resetFiltersForStatus(
				{
					q: "invoice",
					channel: "email",
					inboxId: "inbox_support",
					assigneeId: "user_123",
					unassigned: true,
					snoozed: true,
				},
				"archived",
			),
		).toEqual({
			q: "invoice",
			channel: "email",
			status: "archived",
			inboxId: undefined,
			assigneeId: undefined,
			unassigned: undefined,
			snoozed: undefined,
		});
	});

	it("clears a selected mailbox when switching status tabs", () => {
		expect(
			resetFiltersForStatus(
				{
					q: "invoice",
					mailboxId: "mailbox_support",
				},
				"archived",
			),
		).toEqual({
			q: "invoice",
			mailboxId: undefined,
			status: "archived",
			inboxId: undefined,
			assigneeId: undefined,
			unassigned: undefined,
			snoozed: undefined,
		});

		expect(
			resetFiltersForStatus(
				{
					mailboxId: "mailbox_support",
					channel: "email",
				},
				"all",
			),
		).toMatchObject({
			status: "all",
			mailboxId: undefined,
			channel: "email",
		});
	});

	it("shows a queue identity for selected Sidebar filters", () => {
		expect(queueIdentity({ unassigned: true }, "open")).toBe("Unassigned");
		expect(queueIdentity({}, "open")).toBe("Inbox");
	});

	it("keeps named inbox sources free of raw gray/slate utilities and hex literals", () => {
		const inboxDirectory = path.resolve(
			path.dirname(fileURLToPath(import.meta.url)),
		);
		const prohibitedColor =
			/(?:text|bg)-(?:gray|slate)(?:-[\w[\]/.]+)?|#[0-9a-fA-F]{3,8}\b/;

		for (const filename of [
			"SearchBar.tsx",
			"ConversationList.tsx",
			"TagChip.tsx",
			"ContactAvatar.tsx",
			"ConversationActions.tsx",
			"ConversationThread.tsx",
			"Composer.tsx",
			"TagPicker.tsx",
		]) {
			const source = readFileSync(
				path.resolve(inboxDirectory, filename),
				"utf8",
			).replace(/\s+/g, " ");
			expect(source, filename).not.toMatch(prohibitedColor);
		}
	});

	it("opens the mobile navigation in a named Sheet", () => {
		render(
			<AppShell
				detail={<div>Conversation detail</div>}
				hasDetail={false}
				list={<div>Conversation list</div>}
				onBack={vi.fn()}
				sidebar={<div>Workspace navigation</div>}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
		expect(
			screen.getByRole("dialog", { name: "Navigation" }),
		).toBeInTheDocument();
	});

	it("shows a back control for a direct selected detail", () => {
		const onBack = vi.fn();
		render(
			<AppMobileHeader hasDetail onBack={onBack} onOpenNavigation={vi.fn()} />,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Back to conversations" }),
		);
		expect(onBack).toHaveBeenCalledOnce();
	});
});
