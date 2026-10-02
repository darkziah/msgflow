export type ShortcutCommand =
	| "focus-search"
	| "previous-conversation"
	| "next-conversation"
	| "focus-reply"
	| "focus-comment"
	| "submit-composer"
	| "archive"
	| "tag"
	| "assign"
	| "move"
	| "snooze"
	| "saved-replies"
	| "show-help";

type ShortcutModifier = "primary" | "shift";

type ShortcutKey = {
	key: string;
	label: string;
	modifiers?: readonly ShortcutModifier[];
};

export type ShortcutScope = "global" | "inbox" | "conversation";

export type Shortcut = {
	command: ShortcutCommand;
	keys: readonly ShortcutKey[];
	label: string;
	scope: ShortcutScope;
	description: string;
};

export const SHORTCUTS = {
	"focus-search": {
		command: "focus-search",
		keys: [
			{ key: "f", label: "Cmd/Ctrl+Shift+F", modifiers: ["primary", "shift"] },
		],
		label: "Focus search",
		scope: "inbox",
		description: "Focus the Search conversations input.",
	},
	"previous-conversation": {
		command: "previous-conversation",
		keys: [{ key: "arrowup", label: "Arrow Up" }],
		label: "Previous conversation",
		scope: "inbox",
		description: "Select the previous visible conversation.",
	},
	"next-conversation": {
		command: "next-conversation",
		keys: [{ key: "arrowdown", label: "Arrow Down" }],
		label: "Next conversation",
		scope: "inbox",
		description: "Select the next visible conversation.",
	},
	"focus-reply": {
		command: "focus-reply",
		keys: [{ key: "r", label: "R" }],
		label: "Reply",
		scope: "conversation",
		description: "Switch to Reply and focus the composer.",
	},
	"focus-comment": {
		command: "focus-comment",
		keys: [{ key: ".", label: "Cmd/Ctrl+.", modifiers: ["primary"] }],
		label: "Comment",
		scope: "conversation",
		description: "Switch to Comment and focus the composer.",
	},
	"submit-composer": {
		command: "submit-composer",
		keys: [
			{ key: "enter", label: "Cmd/Ctrl+Enter", modifiers: ["primary"] },
		],
		label: "Submit composer",
		scope: "conversation",
		description: "Submit the active reply or comment when it is valid.",
	},
	archive: {
		command: "archive",
		keys: [
			{ key: "e", label: "E" },
			{ key: "e", label: "Cmd/Ctrl+E", modifiers: ["primary"] },
		],
		label: "Archive or reopen conversation",
		scope: "conversation",
		description: "Archive an open conversation or reopen an archived one.",
	},
	tag: {
		command: "tag",
		keys: [
			{ key: "t", label: "T" },
			{ key: "t", label: "Cmd/Ctrl+T", modifiers: ["primary"] },
		],
		label: "Tag conversation",
		scope: "conversation",
		description: "Open the tag picker.",
	},
	assign: {
		command: "assign",
		keys: [
			{ key: "a", label: "Shift+A", modifiers: ["shift"] },
			{
				key: "a",
				label: "Cmd/Ctrl+Shift+A",
				modifiers: ["primary", "shift"],
			},
		],
		label: "Assign conversation",
		scope: "conversation",
		description: "Open the assignee menu.",
	},
	move: {
		command: "move",
		keys: [
			{ key: "m", label: "Shift+M", modifiers: ["shift"] },
			{
				key: "m",
				label: "Cmd/Ctrl+Shift+M",
				modifiers: ["primary", "shift"],
			},
		],
		label: "Move conversation",
		scope: "conversation",
		description: "Open the move-to-inbox menu.",
	},
	snooze: {
		command: "snooze",
		keys: [
			{ key: "s", label: "S" },
			{ key: "s", label: "Cmd/Ctrl+S", modifiers: ["primary"] },
		],
		label: "Snooze conversation",
		scope: "conversation",
		description: "Open the snooze menu.",
	},
	"saved-replies": {
		command: "saved-replies",
		keys: [
			{
				key: "o",
				label: "Cmd/Ctrl+Shift+O",
				modifiers: ["primary", "shift"],
			},
		],
		label: "Saved replies",
		scope: "conversation",
		description: "Open Saved replies when Reply mode is active.",
	},
	"show-help": {
		command: "show-help",
		keys: [{ key: "?", label: "?", modifiers: ["shift"] }],
		label: "Keyboard shortcuts",
		scope: "global",
		description: "Open the keyboard shortcut reference.",
	},
} as const satisfies Record<ShortcutCommand, Shortcut>;

function matchesShortcutKey(event: KeyboardEvent, shortcutKey: ShortcutKey) {
	if (event.altKey) return false;

	const modifiers = shortcutKey.modifiers ?? [];
	const requiresPrimary = modifiers.includes("primary");
	const requiresShift = modifiers.includes("shift");
	const hasPrimary = event.metaKey || event.ctrlKey;

	if (event.metaKey && event.ctrlKey) return false;
	if (hasPrimary !== requiresPrimary || event.shiftKey !== requiresShift) {
		return false;
	}

	return event.key.toLowerCase() === shortcutKey.key;
}

export function getShortcutCommand(event: KeyboardEvent): ShortcutCommand | undefined {
	for (const shortcut of Object.values(SHORTCUTS)) {
		if (shortcut.keys.some((shortcutKey) => matchesShortcutKey(event, shortcutKey))) {
			return shortcut.command;
		}
	}
}

export function isEditableTarget(target: EventTarget | null): boolean {
	if (typeof Element === "undefined" || !(target instanceof Element)) {
		return false;
	}

	const editableContainer = target.closest("[contenteditable]");
	return Boolean(
		target.closest("input, textarea, select") ||
		(editableContainer &&
			editableContainer.getAttribute("contenteditable")?.toLowerCase() !== "false"),
	);
}

function hasOpenLayer(selector: string) {
	if (typeof document === "undefined") return false;

	return Array.from(document.querySelectorAll<HTMLElement>(selector)).some(
		(layer) =>
			!layer.hidden &&
			layer.getAttribute("aria-hidden") !== "true" &&
			layer.dataset.state !== "closed",
	);
}

export function shouldIgnoreShortcutEvent(
	event: KeyboardEvent,
	target: EventTarget | null,
): boolean {
	if (event.defaultPrevented || event.isComposing || isEditableTarget(target)) {
		return true;
	}

	const hasDialog = hasOpenLayer('[role="dialog"]');
	const hasMenu = hasOpenLayer('[role="menu"]');
	const hasListbox = hasOpenLayer('[role="listbox"]');
	const hasPopper = hasOpenLayer("[data-radix-popper-content-wrapper]");

	return hasDialog || hasMenu || hasListbox || hasPopper;
}

export function describeShortcut(command: ShortcutCommand): Shortcut {
	return SHORTCUTS[command];
}
