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
import { activeFilterCount, SearchBar } from "./SearchBar";
import { TagPicker } from "./TagPicker";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/api", () => ({
	api: {
		createComment: vi.fn(),
		addConversationTag: vi.fn(),
		getConversation: vi.fn(),
		getMessages: vi.fn(),
		listConversations: vi.fn(),
		listInboxes: vi.fn(),
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
		vi.mocked(api.listInboxes).mockResolvedValue({
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
		vi.mocked(api.addConversationTag).mockResolvedValue({} as never);
		vi.mocked(api.removeConversationTag).mockResolvedValue({} as never);
		vi.mocked(api.listWorkspaces).mockResolvedValue({
			workspaces: [
				{
					id: "workspace_123",
					name: "Support",
					slug: "support",
					role: "member",
				},
			],
		});
		vi.mocked(api.listConversations).mockResolvedValue({ conversations: [] });
		vi.mocked(api.updateConversation).mockResolvedValue({
			success: true,
			conversation,
		});
	});

	afterEach(() => vi.clearAllMocks());

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

	it("renders an empty state when no conversations match", () => {
		render(<ConversationList conversations={[]} onSelect={vi.fn()} />);

		expect(screen.getByText("No conversations here yet.")).toBeInTheDocument();
		expect(document.querySelector('[data-slot="empty"]')).toBeInTheDocument();
	});

	it("archives an open conversation through the API", async () => {
		renderWithQueryClient(<ConversationActions conversation={conversation} />);

		fireEvent.click(
			screen.getByRole("button", { name: "Archive conversation" }),
		);

		await waitFor(() => {
			expect(api.updateConversation).toHaveBeenCalledWith(conversation.id, {
				status: "archived",
			});
		});
	});

	it("reopens an archived conversation with the exact API payload", async () => {
		renderWithQueryClient(
			<ConversationActions
				conversation={{ ...conversation, status: "archived" }}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Reopen conversation" }),
		);

		await waitFor(() => {
			expect(api.updateConversation).toHaveBeenCalledWith(conversation.id, {
				status: "open",
			});
		});
	});

	it("keeps detail actions compact and exposes their purpose", () => {
		renderWithQueryClient(<ConversationActions conversation={conversation} />);

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
			<ConversationThread conversationId={conversation.id} />,
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
			<ConversationThread conversationId={conversation.id} />,
		);

		expect(
			await screen.findByRole("heading", { name: "Avery Chen" }),
		).toBeInTheDocument();
		expect(screen.getByText("Support")).toBeInTheDocument();
		expect(screen.getByText("Billing question")).toBeInTheDocument();
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
			<ConversationThread conversationId={conversation.id} />,
		);

		const earlierEmail = await screen.findByText("Earlier email body");
		expect(earlierEmail).not.toBeVisible();
		expect(screen.getByText("Latest email body")).toBeVisible();
		expect(screen.getByText("Incoming email").closest("article")).toHaveAttribute(
			"data-email-direction",
			"received",
		);
		expect(screen.getByText("Sent email").closest("article")).toHaveAttribute(
			"data-email-direction",
			"sent",
		);

		fireEvent.click(screen.getByRole("button", { name: "Show email" }));
		expect(earlierEmail).toBeVisible();
		expect(screen.getAllByRole("button", { name: "Hide email" })).toHaveLength(2);
	});

	it("disables an empty reply and sends the preserved message payload", async () => {
		vi.mocked(api.sendMessage).mockResolvedValue({
			success: true,
			sent: true,
			message: {},
		} as never);
		renderWithQueryClient(<Composer conversationId={conversation.id} />);

		const send = screen.getByRole("button", { name: "Send" });
		expect(send).toBeDisabled();
		fireEvent.change(screen.getByRole("textbox", { name: "Reply text" }), {
			target: { value: "  I can help with that.  " },
		});
		fireEvent.click(send);

		await waitFor(() => {
			expect(api.sendMessage).toHaveBeenCalledWith(
				conversation.id,
				expect.objectContaining({ text: "I can help with that." }),
			);
		});
	});

	it("prevents a second send while the first request is pending", async () => {
		vi.mocked(api.sendMessage).mockImplementation(() => new Promise(() => {}));
		renderWithQueryClient(<Composer conversationId={conversation.id} />);

		fireEvent.change(screen.getByRole("textbox", { name: "Reply text" }), {
			target: { value: "I can help with that." },
		});
		const send = screen.getByRole("button", { name: "Send" });
		fireEvent.click(send);
		fireEvent.click(send);
		await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
	});

	it("uses a focusable attachment button to open the hidden file input", () => {
		renderWithQueryClient(<Composer conversationId={conversation.id} />);

		const input = document.querySelector<HTMLInputElement>('input[type="file"]');
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
			<TagPicker conversationId={conversation.id} tags={conversation.tags} />,
		);

		await waitFor(() => expect(api.listTags).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: "Tag" }));
		expect(
			await screen.findByRole("dialog", { name: "Add a tag" }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Urgent" }));
		await waitFor(() => {
			expect(api.addConversationTag).toHaveBeenCalledWith(
				conversation.id,
				availableTag.id,
			);
		});

		fireEvent.click(screen.getByRole("button", { name: "Remove tag Billing" }));
		await waitFor(() => {
			expect(api.removeConversationTag).toHaveBeenCalledWith(
				conversation.id,
				"tag_billing",
			);
		});
	});

	it("uses exclusive toggle semantics for Reply and Comment", () => {
		renderWithQueryClient(<Composer conversationId={conversation.id} />);

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
			<Composer conversationId={conversation.id} showSubject />,
		);

		const reply = await screen.findByRole("textbox", { name: "Reply text" });
		fireEvent.change(reply, { target: { value: "I can help with that." } });
		expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
	});

	it("opens the activity dialog with its accessible name", async () => {
		vi.mocked(api.getConversation).mockResolvedValue(conversation);
		vi.mocked(api.getMessages).mockResolvedValue({
			messages: [],
			comments: [],
			activities: [],
		} as never);
		renderWithQueryClient(
			<ConversationThread conversationId={conversation.id} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Activity" }));
		expect(
			screen.getByRole("dialog", { name: "Activity" }),
		).toBeInTheDocument();
	});

	it("submits an entered search query only on Enter", () => {
		const onChange = vi.fn();
		renderWithQueryClient(<SearchBar filters={{}} onChange={onChange} />);

		const input = screen.getByPlaceholderText("Search conversations… (Enter)");
		fireEvent.change(input, { target: { value: " invoice  " } });
		fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
		expect(onChange).toHaveBeenCalledWith({ q: "invoice" });
	});

	it("clears all search filters", () => {
		const onChange = vi.fn();
		renderWithQueryClient(
			<SearchBar
				filters={{ channel: "email", q: "invoice" }}
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
			queueLabel: undefined,
			status: "archived",
			inboxId: undefined,
			assigneeId: undefined,
			unassigned: undefined,
			snoozed: undefined,
		});
	});

	it("clears a selected mailbox and its label when switching status tabs", () => {
		expect(
			resetFiltersForStatus(
				{
					q: "invoice",
					mailboxId: "mailbox_support",
					queueLabel: "Support mailbox",
				},
				"archived",
			),
		).toEqual({
			q: "invoice",
			mailboxId: undefined,
			queueLabel: undefined,
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
					queueLabel: "Support mailbox",
					channel: "email",
				},
				"all",
			),
		).toMatchObject({
			status: "all",
			mailboxId: undefined,
			queueLabel: undefined,
			channel: "email",
		});
	});

	it("shows a queue identity for selected Sidebar filters", () => {
		expect(queueIdentity({ queueLabel: "Support" }, "open")).toBe("Support");
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
