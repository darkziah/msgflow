"use client";

import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	type MutableRefObject,
	type ReactNode,
} from "react";

import {
	getShortcutCommand,
	shouldIgnoreShortcutEvent,
	type ShortcutCommand,
} from "./keyboard-shortcuts";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";

type ShortcutHandler = () => boolean | undefined;
type ShortcutRegistry = Map<ShortcutCommand, Set<MutableRefObject<ShortcutHandler>>>;

const KeyboardShortcutsContext = createContext<ShortcutRegistry | null>(null);

export function KeyboardShortcutsProvider({ children }: { children: ReactNode }) {
	const registryRef = useRef<ShortcutRegistry>(new Map());
	const [isHelpOpen, setIsHelpOpen] = useState(false);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const command = getShortcutCommand(event);
			if (!command || shouldIgnoreShortcutEvent(event, event.target)) return;

			if (command === "show-help") {
				event.preventDefault();
				setIsHelpOpen(true);
				return;
			}

			const handlers = registryRef.current.get(command);
			if (!handlers?.size) return;

			let handled = false;
			for (const handler of handlers) {
				if (handler.current() === true) handled = true;
			}
			if (handled) event.preventDefault();
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, []);

	return (
		<KeyboardShortcutsContext.Provider value={registryRef.current}>
			{children}
			<KeyboardShortcutsDialog open={isHelpOpen} onOpenChange={setIsHelpOpen} />
		</KeyboardShortcutsContext.Provider>
	);
}

export function useKeyboardShortcut(
	command: ShortcutCommand,
	handler: ShortcutHandler,
	enabled = true,
) {
	const registry = useContext(KeyboardShortcutsContext);
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	if (!registry) {
		throw new Error("useKeyboardShortcut must be used within KeyboardShortcutsProvider");
	}

	useEffect(() => {
		if (!enabled) return;

		const handlers = registry.get(command) ?? new Set();
		handlers.add(handlerRef);
		registry.set(command, handlers);

		return () => {
			handlers.delete(handlerRef);
			if (handlers.size === 0) registry.delete(command);
		};
	}, [command, enabled, registry]);
}
