import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	describeShortcut,
	getShortcutCommand,
	isEditableTarget,
	shouldIgnoreShortcutEvent,
} from "./keyboard-shortcuts";
import {
	KeyboardShortcutsProvider,
	useKeyboardShortcut,
} from "./KeyboardShortcutsProvider";

afterEach(() => {
	cleanup();
	document.body.replaceChildren();
});

function ShortcutHarness({
	onArchive,
	enabled = true,
}: {
	onArchive: () => boolean | undefined;
	enabled?: boolean;
}) {
	useKeyboardShortcut("archive", onArchive, enabled);
	return <input aria-label="Message" />;
}

describe("keyboard shortcuts", () => {
	it("maps the Front-style archive variants", () => {
		expect(
			getShortcutCommand(new KeyboardEvent("keydown", { key: "e" })),
		).toBe("archive");
		expect(
			getShortcutCommand(
				new KeyboardEvent("keydown", { key: "e", ctrlKey: true }),
			),
		).toBe("archive");
		expect(
			getShortcutCommand(
				new KeyboardEvent("keydown", { key: "e", metaKey: true }),
			),
		).toBe("archive");
	});

	it("maps search, list navigation, composer, and picker commands", () => {
		const cases = [
			[{ key: "F", metaKey: true, shiftKey: true }, "focus-search"],
			[{ key: "ArrowUp" }, "previous-conversation"],
			[{ key: "ArrowDown" }, "next-conversation"],
			[{ key: "r" }, "focus-reply"],
			[{ key: ".", ctrlKey: true }, "focus-comment"],
			[{ key: "Enter", metaKey: true }, "submit-composer"],
			[{ key: "t" }, "tag"],
			[{ key: "A", shiftKey: true }, "assign"],
			[{ key: "M", shiftKey: true }, "move"],
			[{ key: "s" }, "snooze"],
			[{ key: "O", ctrlKey: true, shiftKey: true }, "saved-replies"],
			[{ key: "?", shiftKey: true }, "show-help"],
		] as const;

		for (const [options, command] of cases) {
			expect(getShortcutCommand(new KeyboardEvent("keydown", options))).toBe(
				command,
			);
		}
	});

	it("maps every primary shortcut with both Ctrl and Meta", () => {
		const cases = [
			["focus-search", { key: "f", shiftKey: true }],
			["focus-comment", { key: "." }],
			["submit-composer", { key: "Enter" }],
			["archive", { key: "e" }],
			["tag", { key: "t" }],
			["assign", { key: "a", shiftKey: true }],
			["move", { key: "m", shiftKey: true }],
			["snooze", { key: "s" }],
			["saved-replies", { key: "o", shiftKey: true }],
		] as const;

		for (const [command, modifiers] of cases) {
			for (const primary of [{ ctrlKey: true }, { metaKey: true }]) {
				expect(
					getShortcutCommand(
						new KeyboardEvent("keydown", { ...modifiers, ...primary }),
					),
				).toBe(command);
			}
		}
	});

	it("does not claim browser shortcuts or undocumented modifier combinations", () => {
		expect(
			getShortcutCommand(
				new KeyboardEvent("keydown", { key: "f", ctrlKey: true }),
			),
		).toBeUndefined();
		expect(
			getShortcutCommand(
				new KeyboardEvent("keydown", { key: "[", metaKey: true }),
			),
		).toBeUndefined();
		expect(
			getShortcutCommand(
				new KeyboardEvent("keydown", { key: "e", altKey: true }),
			),
		).toBeUndefined();
		expect(
			getShortcutCommand(
				new KeyboardEvent("keydown", {
					key: "e",
					ctrlKey: true,
					metaKey: true,
				}),
			),
		).toBeUndefined();
	});

	it("identifies editable controls and contenteditable descendants", () => {
		for (const tagName of ["input", "textarea", "select"]) {
			const element = document.createElement(tagName);
			expect(isEditableTarget(element)).toBe(true);
		}

		const editable = document.createElement("div");
		editable.setAttribute("contenteditable", "plaintext-only");
		const child = document.createElement("span");
		editable.append(child);
		document.body.append(editable);
		expect(isEditableTarget(editable)).toBe(true);
		expect(isEditableTarget(child)).toBe(true);
		expect(
			shouldIgnoreShortcutEvent(new KeyboardEvent("keydown", { key: "e" }), editable),
		).toBe(true);
		expect(
			shouldIgnoreShortcutEvent(new KeyboardEvent("keydown", { key: "e" }), child),
		).toBe(true);

		const nonEditable = document.createElement("div");
		nonEditable.setAttribute("contenteditable", "false");
		const nonEditableChild = document.createElement("span");
		nonEditable.append(nonEditableChild);
		editable.append(nonEditable);
		expect(isEditableTarget(nonEditable)).toBe(false);
		expect(isEditableTarget(nonEditableChild)).toBe(false);
		expect(
			shouldIgnoreShortcutEvent(
				new KeyboardEvent("keydown", { key: "e" }),
				nonEditableChild,
			),
		).toBe(false);
		expect(isEditableTarget(document.body)).toBe(false);
	});

	it("ignores typing, composition, prevented events, and open Radix layers", () => {
		const input = document.createElement("input");
		document.body.append(input);
		expect(
			shouldIgnoreShortcutEvent(
				new KeyboardEvent("keydown", { key: "e" }),
				input,
			),
		).toBe(true);

		expect(
			shouldIgnoreShortcutEvent(
				new KeyboardEvent("keydown", { key: "e", isComposing: true }),
				document.body,
			),
		).toBe(true);

		const prevented = new KeyboardEvent("keydown", { key: "e", cancelable: true });
		prevented.preventDefault();
		expect(shouldIgnoreShortcutEvent(prevented, document.body)).toBe(true);

		for (const layer of [
			{ role: "dialog" },
			{ role: "menu" },
			{ role: "listbox" },
			{ popper: true },
		]) {
			document.body.replaceChildren();
			const element = document.createElement("div");
			const role = "role" in layer ? layer.role : undefined;
			if (role) element.setAttribute("role", role);
			if ("popper" in layer) {
				element.setAttribute("data-radix-popper-content-wrapper", "");
			}
			document.body.append(element);
			expect(
				shouldIgnoreShortcutEvent(
					new KeyboardEvent("keydown", { key: "e" }),
					document.body,
				),
			).toBe(true);
		}
	});

	it("ignores help when a non-modal dialog is open", () => {
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		document.body.append(dialog);
		expect(
			shouldIgnoreShortcutEvent(
				new KeyboardEvent("keydown", { key: "?", shiftKey: true }),
				document.body,
			),
		).toBe(true);
	});

	it("describes only supported MsgFlow commands", () => {
		expect(describeShortcut("archive")).toMatchObject({
			label: "Archive or reopen conversation",
		});
		// @ts-expect-error Unsupported Front commands are not part of ShortcutCommand.
		expect(describeShortcut("reply-all")).toBeUndefined();
	});

	describe("KeyboardShortcutsProvider", () => {
		it("invokes archive from a document keydown", () => {
			const onArchive = vi.fn();
			render(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={onArchive} />
				</KeyboardShortcutsProvider>,
			);

			fireEvent.keyDown(document, { key: "e", cancelable: true });
			expect(onArchive).toHaveBeenCalledOnce();
		});

		it("uses the latest handler after a rerender", () => {
			const firstHandler = vi.fn(() => true);
			const latestHandler = vi.fn(() => true);
			const { rerender } = render(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={firstHandler} />
				</KeyboardShortcutsProvider>,
			);

			rerender(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={latestHandler} />
				</KeyboardShortcutsProvider>,
			);
			const event = new KeyboardEvent("keydown", { key: "e", cancelable: true });
			fireEvent(document, event);

			expect(firstHandler).not.toHaveBeenCalled();
			expect(latestHandler).toHaveBeenCalledOnce();
			expect(event.defaultPrevented).toBe(true);
		});

		it("does not register a disabled shortcut and cleans it up when disabled", () => {
			const onArchive = vi.fn(() => true);
			const { rerender } = render(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={onArchive} enabled={false} />
				</KeyboardShortcutsProvider>,
			);

			const disabledEvent = new KeyboardEvent("keydown", { key: "e", cancelable: true });
			fireEvent(document, disabledEvent);
			expect(onArchive).not.toHaveBeenCalled();
			expect(disabledEvent.defaultPrevented).toBe(false);

			rerender(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={onArchive} enabled />
				</KeyboardShortcutsProvider>,
			);
			rerender(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={onArchive} enabled={false} />
				</KeyboardShortcutsProvider>,
			);
			const cleanedUpEvent = new KeyboardEvent("keydown", { key: "e", cancelable: true });
			fireEvent(document, cleanedUpEvent);

			expect(onArchive).not.toHaveBeenCalled();
			expect(cleanedUpEvent.defaultPrevented).toBe(false);
		});

		it("cleans up a shortcut when its component unmounts", () => {
			const onArchive = vi.fn(() => true);
			const { unmount } = render(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={onArchive} />
				</KeyboardShortcutsProvider>,
			);
			unmount();

			const event = new KeyboardEvent("keydown", { key: "e", cancelable: true });
			fireEvent(document, event);
			expect(onArchive).not.toHaveBeenCalled();
			expect(event.defaultPrevented).toBe(false);
		});

		it("does not prevent default when no handler or a handler returns false", () => {
			const noHandlerEvent = new KeyboardEvent("keydown", { key: "e", cancelable: true });
			render(<KeyboardShortcutsProvider>Nothing registered</KeyboardShortcutsProvider>);
			fireEvent(document, noHandlerEvent);
			expect(noHandlerEvent.defaultPrevented).toBe(false);

			cleanup();
			const onArchive = vi.fn(() => false);
			render(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={onArchive} />
				</KeyboardShortcutsProvider>,
			);
			const falseHandlerEvent = new KeyboardEvent("keydown", { key: "e", cancelable: true });
			fireEvent(document, falseHandlerEvent);

			expect(onArchive).toHaveBeenCalledOnce();
			expect(falseHandlerEvent.defaultPrevented).toBe(false);
		});

		it("prevents default when a handler reports it handled the shortcut", () => {
			const onArchive = vi.fn(() => true);
			render(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={onArchive} />
				</KeyboardShortcutsProvider>,
			);

			const event = new KeyboardEvent("keydown", { key: "e", cancelable: true });
			const preventDefault = vi.spyOn(event, "preventDefault");
			fireEvent(document, event);
			expect(onArchive).toHaveBeenCalledOnce();
			expect(preventDefault).toHaveBeenCalledOnce();
			expect(event.defaultPrevented).toBe(true);
		});

		it("does not invoke archive while typing in an input", () => {
			const onArchive = vi.fn();
			render(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={onArchive} />
				</KeyboardShortcutsProvider>,
			);

			fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), {
				key: "e",
				cancelable: true,
			});
			expect(onArchive).not.toHaveBeenCalled();
		});

		it("opens the keyboard shortcuts dialog with question mark", () => {
			render(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={vi.fn()} />
				</KeyboardShortcutsProvider>,
			);

			fireEvent.keyDown(document, { key: "?", shiftKey: true, cancelable: true });
			expect(
				screen.getByRole("dialog", { name: "Keyboard shortcuts" }),
			).toBeInTheDocument();
			expect(
				screen.getByText("Only commands supported by this MsgFlow inbox are listed."),
			).toBeInTheDocument();
		});

		it("closes the dialog with Escape without archiving", () => {
			const onArchive = vi.fn();
			render(
				<KeyboardShortcutsProvider>
					<ShortcutHarness onArchive={onArchive} />
				</KeyboardShortcutsProvider>,
			);

			fireEvent.keyDown(document, { key: "?", shiftKey: true, cancelable: true });
			fireEvent.keyDown(document, { key: "Escape", cancelable: true });
			expect(
				screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
			).not.toBeInTheDocument();
			expect(onArchive).not.toHaveBeenCalled();
		});
	});
});
