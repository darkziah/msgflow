"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

import { SHORTCUTS, type ShortcutScope } from "./keyboard-shortcuts";

const scopes: readonly ShortcutScope[] = ["global", "inbox", "conversation"];

export function KeyboardShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent aria-describedby="keyboard-shortcuts-description">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription id="keyboard-shortcuts-description">
						Use these shortcuts to navigate MsgFlow faster.
					</DialogDescription>
					<p className="text-sm text-muted-foreground">
						Only commands supported by this MsgFlow inbox are listed.
					</p>
				</DialogHeader>
				<div className="space-y-6">
					{scopes.map((scope) => {
						const shortcuts = Object.values(SHORTCUTS).filter(
							(shortcut) => shortcut.scope === scope,
						);
						if (shortcuts.length === 0) return null;

						return (
							<section key={scope} aria-label={`${scope} shortcuts`}>
								<h3 className="mb-2 text-sm font-medium capitalize">{scope}</h3>
								<ul className="space-y-2">
									{shortcuts.map((shortcut) => (
										<li
											key={shortcut.command}
											className="flex items-center justify-between gap-4"
										>
											<span className="text-sm">{shortcut.label}</span>
											<span className="flex flex-wrap justify-end gap-1">
												{shortcut.keys.map((key) => (
													<kbd
														key={key.label}
														className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs"
													>
														{key.label}
													</kbd>
												))}
											</span>
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
}
