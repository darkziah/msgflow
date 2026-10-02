# Front-Style Keyboard Shortcuts Implementation Plan

> **For Hermes:** Use the `subagent-driven-development` skill to implement this plan task-by-task.

**Goal:** Add a Front-style, keyboard-first inbox workflow for every conversation action MsgFlow currently supports, without inventing unsupported Front features.

**Architecture:** Build one browser-safe shortcut registry and a React provider that owns a single document-level `keydown` listener. The inbox route registers list/search/navigation handlers, while the selected conversation registers its currently available action, composer, and dialog handlers; the registry ignores editable controls, active IME composition, and open modal/menus so shortcuts never steal normal typing or Radix keyboard interaction. Implement Front-equivalent commands only where MsgFlow has a real UI/API path today; unsupported Front actions remain explicitly out of scope rather than becoming inert shortcuts.

**Tech stack:** React 19, TypeScript, TanStack Router/Query, Radix primitives, Vitest + Testing Library, Bun, Biome.

---

## Current context / assumptions

- The primary inbox route is `apps/web/src/routes/index.tsx`. It owns the active workspace, conversation list query, selected conversation URL parameter (`c`), status tab, filters, and `navigate` function.
- `apps/web/src/components/inbox/ConversationThread.tsx` renders the selected conversation. It already composes `TagPicker`, `ConversationActions`, and `Composer`.
- The real currently-supported conversation operations are archive/reopen, tag, assign, move, snooze, reply, comment, send, saved replies, search, and next/previous conversation selection. Archive/move/assign/snooze all use the existing `api.updateConversation` path. There is no API or UI for reply-all, forward, trash, spam, subscribe, star, selection/bulk actions, a plugin panel, or a compose-new-conversation flow.
- `Composer` intentionally sends with unmodified `Enter`; retain that existing behavior. The Front-style shortcut will additionally support `Cmd/Ctrl+Enter` to submit the active reply/comment, but it must not perform “send and archive” because a combined two-step operation could archive a conversation after an uncertain provider outcome.
- Front’s published reference is https://help.front.com/en/articles/2189. Do not copy shortcuts whose underlying operation does not exist in MsgFlow.
- There is no persisted personal-preference model for shortcut scheme selection. Ship the Front-style set as the single default. Do not add database schema, server API, Gmail mappings, custom keybindings, desktop-only behavior, or local-storage preference controls in this feature.
- Treat `Meta` as Command on macOS and `Ctrl` as the equivalent modifier on Windows/Linux. Never intercept browser-reserved navigation (`Cmd/Ctrl+[` and `Cmd/Ctrl+]`), browser find, or native copy/paste/formatting shortcuts.

## Supported shortcut contract

| Scope | Keys | Result |
| --- | --- | --- |
| Inbox/global | `Cmd/Ctrl+Shift+F` | Focus the existing “Search conversations” input. |
| Inbox/list | `ArrowUp` | Select the previous visible conversation; no-op at the first row or when none exist. |
| Inbox/list | `ArrowDown` | Select the next visible conversation; no-op at the last row or when none exist. |
| Selected conversation | `R` | Switch composer to Reply and focus its text area. |
| Selected conversation | `Cmd/Ctrl+.` | Switch composer to Comment and focus its text area. |
| Selected conversation | `Cmd/Ctrl+Enter` | Submit the currently active, valid composer mode using the same guarded submit path as its Send/Comment button. |
| Selected conversation | `E` or `Cmd/Ctrl+E` | Archive an open conversation or reopen an archived one using the existing mutation. |
| Selected conversation | `T` or `Cmd/Ctrl+T` | Open the existing tag picker. |
| Selected conversation | `Shift+A` or `Cmd/Ctrl+Shift+A` | Open the existing assignee menu. It must not silently assign the current agent because the current UI has no “assign to me” semantic. |
| Selected conversation | `Shift+M` or `Cmd/Ctrl+Shift+M` | Open the existing move-to-inbox menu. |
| Selected conversation | `S` or `Cmd/Ctrl+S` | Open the existing snooze menu. |
| Selected conversation | `Cmd/Ctrl+Shift+O` | Open the existing Saved replies dialog, if at least one saved reply is available and Reply mode is active. |
| Global | `?` | Open an accessible shortcut reference dialog listing the commands above and the availability rules. |
| Global/dialog | `Escape` | Close the shortcut reference dialog only; leave Radix dialogs, menus, popovers, and Sheets to their existing Escape behavior. |

Single-letter variants apply only when no editable element is focused, no Radix modal/menu/popover is open, no browser modifier other than the documented `Shift` is held, and `event.isComposing` is false. Chord variants apply only outside editable elements and must call `preventDefault()` only after a registered handler accepts the command. Do not hijack `Cmd/Ctrl+T` in the browser until this user-selected web-app product behavior is explicitly approved during implementation review; if browser tab creation cannot be prevented reliably, ship only `T` and display the chord as unavailable in the help dialog.

## Files likely to change

- Create: `apps/web/src/components/inbox/KeyboardShortcutsProvider.tsx`
- Create: `apps/web/src/components/inbox/KeyboardShortcutsDialog.tsx`
- Create: `apps/web/src/components/inbox/keyboard-shortcuts.ts`
- Create: `apps/web/src/components/inbox/keyboard-shortcuts.test.tsx`
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/components/inbox/SearchBar.tsx`
- Modify: `apps/web/src/components/inbox/ConversationList.tsx`
- Modify: `apps/web/src/components/inbox/ConversationThread.tsx`
- Modify: `apps/web/src/components/inbox/ConversationActions.tsx`
- Modify: `apps/web/src/components/inbox/TagPicker.tsx`
- Modify: `apps/web/src/components/inbox/Composer.tsx`
- Modify: `apps/web/src/components/inbox/ui-contract.test.tsx`

## Step-by-step tasks

### Task 1: Define and test the pure shortcut matching policy

**Objective:** Centralize the Front-style key mapping and its safety gates before adding any document listener or component behavior.

**Files:**
- Create: `apps/web/src/components/inbox/keyboard-shortcuts.ts`
- Create: `apps/web/src/components/inbox/keyboard-shortcuts.test.tsx`

**Step 1: Write the failing unit tests**

Create `apps/web/src/components/inbox/keyboard-shortcuts.test.tsx` with focused tests that construct `new KeyboardEvent("keydown", options)` and assert these exported functions and values:

```ts
import { describe, expect, it } from "vitest";
import {
  describeShortcut,
  getShortcutCommand,
  shouldIgnoreShortcutEvent,
} from "./keyboard-shortcuts";

describe("keyboard shortcuts", () => {
  it("maps the Front-style archive variants", () => {
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "e" }))).toBe("archive");
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "e", ctrlKey: true }))).toBe("archive");
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "e", metaKey: true }))).toBe("archive");
  });

  it("maps search, list navigation, composer, and picker commands", () => {
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "F", metaKey: true, shiftKey: true }))).toBe("focus-search");
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "ArrowDown" }))).toBe("next-conversation");
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "r" }))).toBe("focus-reply");
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: ".", ctrlKey: true }))).toBe("focus-comment");
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "O", ctrlKey: true, shiftKey: true }))).toBe("saved-replies");
  });

  it("does not claim browser shortcuts or undocumented modifier combinations", () => {
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }))).toBeUndefined();
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "[", metaKey: true }))).toBeUndefined();
    expect(getShortcutCommand(new KeyboardEvent("keydown", { key: "e", altKey: true }))).toBeUndefined();
  });

  it("ignores typing, composition, and open Radix layers", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(shouldIgnoreShortcutEvent(new KeyboardEvent("keydown", { key: "e" }), input)).toBe(true);
    expect(shouldIgnoreShortcutEvent(new KeyboardEvent("keydown", { key: "e", isComposing: true }), document.body)).toBe(true);
    const menu = document.createElement("div");
    menu.dataset.state = "open";
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    expect(shouldIgnoreShortcutEvent(new KeyboardEvent("keydown", { key: "e" }), document.body)).toBe(true);
  });

  it("describes only supported MsgFlow commands", () => {
    expect(describeShortcut("archive")).toMatchObject({ label: "Archive or reopen conversation" });
    expect(describeShortcut("reply-all")).toBeUndefined();
  });
});
```

**Step 2: Run the focused test and verify it fails**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/keyboard-shortcuts.test.tsx
```

Expected: FAIL because `./keyboard-shortcuts` does not exist.

**Step 3: Implement the minimal pure module**

Create `apps/web/src/components/inbox/keyboard-shortcuts.ts` with:

- A closed `ShortcutCommand` union containing exactly `focus-search`, `previous-conversation`, `next-conversation`, `focus-reply`, `focus-comment`, `submit-composer`, `archive`, `tag`, `assign`, `move`, `snooze`, `saved-replies`, and `show-help`.
- A `SHORTCUTS` record whose items contain `command`, `keys`, `label`, `scope`, and `description`; this is the sole source for both matching and dialog rendering.
- `getShortcutCommand(event)` that normalizes `event.key.toLowerCase()`, accepts either Meta or Control as the primary modifier, rejects Alt combinations, and only recognizes the command table above.
- `isEditableTarget(target)` that returns true for `input`, `textarea`, `select`, `[contenteditable="true"]`, or descendants of `[contenteditable="true"]`.
- `shouldIgnoreShortcutEvent(event, target)` that returns true for composition, default-prevented events, editable targets, and open `[role="dialog"]`, `[role="menu"]`, `[role="listbox"]`, or `[data-radix-popper-content-wrapper]` elements. Exempt `show-help` from the dialog gate only when the target is the app body and no modal dialog is already open.
- `describeShortcut(command)` that only accepts the `ShortcutCommand` union and returns the matching table item; do not add strings for unsupported Front actions.

**Step 4: Run the focused test and verify it passes**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/keyboard-shortcuts.test.tsx
```

Expected: PASS with all shortcut policy tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/inbox/keyboard-shortcuts.ts apps/web/src/components/inbox/keyboard-shortcuts.test.tsx
git commit -m "feat: define inbox keyboard shortcut policy"
```

Expected: Git creates one commit and reports the two staged files.

### Task 2: Add one accessible global listener and shortcut reference dialog

**Objective:** Establish a single registration API so components do not add competing `document` listeners, and provide a discoverable list of enabled commands.

**Files:**
- Create: `apps/web/src/components/inbox/KeyboardShortcutsProvider.tsx`
- Create: `apps/web/src/components/inbox/KeyboardShortcutsDialog.tsx`
- Modify: `apps/web/src/components/inbox/keyboard-shortcuts.test.tsx`

**Step 1: Write failing provider/dialog tests**

Extend `keyboard-shortcuts.test.tsx` to render a test child inside `KeyboardShortcutsProvider` that registers `archive: archiveSpy`, dispatches `keydown` on `document`, and proves:

```ts
fireEvent.keyDown(document, { key: "e" });
expect(archiveSpy).toHaveBeenCalledOnce();

const input = screen.getByRole("textbox");
input.focus();
fireEvent.keyDown(input, { key: "e" });
expect(archiveSpy).toHaveBeenCalledOnce();
```

Also assert that `?` opens a `role="dialog"` named `Keyboard shortcuts`, it renders `Archive or reopen conversation`, and Escape closes that dialog without calling a registered shortcut.

**Step 2: Run the focused test and verify it fails**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/keyboard-shortcuts.test.tsx
```

Expected: FAIL because `KeyboardShortcutsProvider` and `KeyboardShortcutsDialog` do not exist.

**Step 3: Implement the provider and dialog**

Implement these exact responsibilities:

- `KeyboardShortcutsProvider` owns `const handlers = useRef<Partial<Record<ShortcutCommand, () => boolean | void>>>({})` and exactly one `useEffect` adding/removing a `document` `keydown` listener.
- Export `useKeyboardShortcut(command, handler, enabled = true)`. It registers the latest handler in an effect, removes it on cleanup, and throws a clear error when used outside the provider. A handler returns `true` only when it actually handled the command; the listener calls `event.preventDefault()` only in that case.
- The listener first gets the command, then calls `shouldIgnoreShortcutEvent`, then handles `show-help` itself, otherwise invokes the registered command handler. It must never throw when a handler is absent.
- `KeyboardShortcutsDialog` receives `open` and `onOpenChange`, uses the existing `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, and `DialogDescription` components, and renders `SHORTCUTS` as a semantic table/list with key labels, action label, and scope. Include visible copy: “Only commands supported by this MsgFlow inbox are listed.”
- Keep dialog state inside the provider; render the dialog once beside `{children}`. Do not place a second document listener in the dialog or any consumer.

**Step 4: Run focused tests and type-check**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/keyboard-shortcuts.test.tsx
bun --cwd apps/web build
```

Expected: PASS; Vite reports `✓ built` after TypeScript completes with no errors.

**Step 5: Commit**

```bash
git add apps/web/src/components/inbox/KeyboardShortcutsProvider.tsx apps/web/src/components/inbox/KeyboardShortcutsDialog.tsx apps/web/src/components/inbox/keyboard-shortcuts.test.tsx
git commit -m "feat: add inbox shortcut registry and help"
```

Expected: Git creates one commit for the registry and help surface.

### Task 3: Register inbox-level search and visible-list navigation

**Objective:** Make the inbox route own list selection and search focus, preserving its existing workspace-aware URL behavior.

**Files:**
- Modify: `apps/web/src/routes/index.tsx:151-352`
- Modify: `apps/web/src/components/inbox/SearchBar.tsx:37-210`
- Modify: `apps/web/src/components/inbox/ConversationList.tsx:17-112`
- Modify: `apps/web/src/components/inbox/ui-contract.test.tsx`

**Step 1: Write failing route/component tests**

Add tests that render `Inbox` with at least three mocked conversations and verify:

```ts
fireEvent.keyDown(document, { key: "ArrowDown" });
expect(navigate).toHaveBeenCalledWith({
  to: "/",
  search: { workspace: "workspace_123", c: "conv_2" },
});

fireEvent.keyDown(document, { key: "F", ctrlKey: true, shiftKey: true });
expect(screen.getByRole("textbox", { name: "Search conversations" })).toHaveFocus();
```

Add boundary assertions that ArrowUp on the first visible item and ArrowDown on the final visible item do not navigate, and that Arrow keys while the search input is focused do not navigate the list.

**Step 2: Run the focused test and verify it fails**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/ui-contract.test.tsx
```

Expected: FAIL because no document shortcut handler focuses search or selects list rows.

**Step 3: Implement the minimal integration**

- Wrap the authenticated inbox return tree in `KeyboardShortcutsProvider`; do not wrap login, setup, Facebook legal, or settings routes.
- Add an optional `inputRef?: RefObject<HTMLInputElement | null>` prop to `SearchBar`, assign it to the existing search `Input`, and create `const searchInputRef = useRef<HTMLInputElement>(null)` in `Inbox`.
- In `Inbox`, use `useKeyboardShortcut("focus-search", () => { searchInputRef.current?.focus(); return Boolean(searchInputRef.current); })`.
- In `Inbox`, derive the selected index from `data?.conversations ?? []`. Register `previous-conversation` and `next-conversation`; each calculates one adjacent row and calls the same `navigate({ to: "/", search: { workspace: activeWorkspaceId, c: target.id } })` used by `ConversationList.onSelect`. If no selected conversation exists, ArrowDown selects index 0 and ArrowUp selects the final row; this matches list traversal without inventing a selection state.
- Add `aria-current="true"` to the selected `ConversationList` button while preserving its current `aria-pressed` behavior. Do not add row-level key handlers: list movement remains a route-owned global operation.

**Step 4: Run focused tests and lint**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/ui-contract.test.tsx
bun run lint
```

Expected: PASS; Biome reports no lint errors.

**Step 5: Commit**

```bash
git add apps/web/src/routes/index.tsx apps/web/src/components/inbox/SearchBar.tsx apps/web/src/components/inbox/ConversationList.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "feat: add inbox search and list shortcuts"
```

Expected: Git creates one commit for route-level shortcuts.

### Task 4: Make existing conversation action controls shortcut-addressable

**Objective:** Reuse the real archive, tag, assign, move, and snooze controls rather than duplicating API mutations or menu state for keyboard use.

**Files:**
- Modify: `apps/web/src/components/inbox/ConversationActions.tsx:55-233`
- Modify: `apps/web/src/components/inbox/TagPicker.tsx`
- Modify: `apps/web/src/components/inbox/ConversationThread.tsx:40-368`
- Modify: `apps/web/src/components/inbox/ui-contract.test.tsx`

**Step 1: Write failing behavior tests**

Add tests that render `ConversationThread` with a selected open conversation and verify:

```ts
fireEvent.keyDown(document, { key: "e" });
await waitFor(() => expect(api.updateConversation).toHaveBeenCalledWith(
  "conv_123",
  expect.objectContaining({ workspaceId: "workspace-1", status: "archived" }),
));

fireEvent.keyDown(document, { key: "t" });
expect(await screen.findByRole("dialog", { name: "Add a tag" })).toBeInTheDocument();

fireEvent.keyDown(document, { key: "A", shiftKey: true });
expect(screen.getByRole("menu", { name: "Assign conversation" })).toBeInTheDocument();
```

Add equivalent tests for `Shift+M` opening the move menu and `S` opening the snooze menu. Add a negative test that sending `e` while the tag dialog is open does not call `api.updateConversation`.

**Step 2: Run the focused test and verify it fails**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/ui-contract.test.tsx
```

Expected: FAIL because the action components do not expose controlled open state or register handlers.

**Step 3: Implement controlled, reusable action entry points**

- Refactor `ConversationActions` so its archive mutation is held in a named `toggleArchive` callback and its three Radix dropdowns accept controlled `open` / `onOpenChange` state. Export optional callbacks named `onArchiveReady`, `onAssignOpenChange`, `onMoveOpenChange`, and `onSnoozeOpenChange` only if that is the smallest API that lets `ConversationThread` invoke the existing behavior. Do not copy the `api.updateConversation` call into the shortcut provider.
- Refactor `TagPicker` to accept optional controlled `open` / `onOpenChange` props while retaining its existing no-prop behavior for all current callers. Its keyboard handler must open the same “Add a tag” dialog, never mutate tags automatically.
- In `ConversationThread`, register `archive`, `tag`, `assign`, `move`, and `snooze` through `useKeyboardShortcut`. Return `false` while the detail is loading, a related action is pending, or the requested UI cannot open.
- Preserve existing disabled states and data invalidation. A shortcut must not bypass authorization, mutation pending state, or the standard component interaction path.

**Step 4: Run focused tests, full web tests, and build**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/ui-contract.test.tsx
bun --cwd apps/web test
bun --cwd apps/web build
```

Expected: all tests pass and the production web build succeeds.

**Step 5: Commit**

```bash
git add apps/web/src/components/inbox/ConversationActions.tsx apps/web/src/components/inbox/TagPicker.tsx apps/web/src/components/inbox/ConversationThread.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "feat: add conversation action shortcuts"
```

Expected: Git creates one commit for keyboard-accessible action controls.

### Task 5: Add composer focus, saved-reply, and explicit submit shortcuts

**Objective:** Route composer commands through the existing state, validation, idempotency, and submission path without changing ordinary Enter behavior.

**Files:**
- Modify: `apps/web/src/components/inbox/Composer.tsx:57-791`
- Modify: `apps/web/src/components/inbox/ConversationThread.tsx:210-368`
- Modify: `apps/web/src/components/inbox/ui-contract.test.tsx`

**Step 1: Write failing composer shortcut tests**

Add tests for a loaded conversation thread that verify:

```ts
fireEvent.keyDown(document, { key: "r" });
expect(screen.getByRole("textbox", { name: "Reply text" })).toHaveFocus();

fireEvent.keyDown(document, { key: ".", ctrlKey: true });
expect(screen.getByRole("radio", { name: "Comment" })).toBeChecked();
expect(screen.getByRole("textbox", { name: "Comment text" })).toHaveFocus();
```

Stub one canned reply, dispatch `Ctrl+Shift+O`, and assert the Saved replies dialog opens. Fill a valid reply, dispatch `Ctrl+Enter`, and assert `api.sendMessage` receives the same payload expectation used by the existing Send-button test. Add an assertion that ordinary `Enter` in the textarea retains the current submit behavior and that shortcut submission does not call `api.updateConversation`.

**Step 2: Run the focused test and verify it fails**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/ui-contract.test.tsx
```

Expected: FAIL because Composer has no externally registered focus/mode/submit/saved-reply controls.

**Step 3: Implement minimal imperative-free composer integration**

- Add optional `shortcutRequest` and `onShortcutHandled` props to `Composer`, where `shortcutRequest` is a monotonically increasing request object from `ConversationThread` with one of `focus-reply`, `focus-comment`, `submit-composer`, or `saved-replies`. Do not use `document.querySelector`, synthetic button clicks, or duplicate submission functions.
- In a `useEffect`, consume a new request once: set `mode` before focusing `replyInputRef`; open saved replies only when `!isNote`, `cannedReplies.length > 0`, and the existing disabled conditions allow it; call the existing `submit` function for `submit-composer` only when `canSend` is true and `busyRef.current` is false. A handled callback clears/acknowledges the request so it cannot replay after a rerender.
- Register the four commands in `ConversationThread`; it owns the request counter/state and returns `true` only if the active Composer reports handling it. This preserves `Composer` as the sole owner of drafts, email hydration, idempotency IDs, and provider error handling.
- Do not implement reply-all, forward, Bcc, Cc, subject hotkey, resend, or send-and-archive. The email composer explicitly states these features are unavailable in `Composer.tsx:588-590`.

**Step 4: Run focused tests and build**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/ui-contract.test.tsx
bun --cwd apps/web build
```

Expected: PASS; production build completes without TypeScript errors.

**Step 5: Commit**

```bash
git add apps/web/src/components/inbox/Composer.tsx apps/web/src/components/inbox/ConversationThread.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "feat: add composer keyboard shortcuts"
```

Expected: Git creates one commit for composer integration.

### Task 6: Verify the complete shortcut contract and prevent regressions

**Objective:** Validate the final command inventory against the actual product, protect browser/editing safety, and avoid shipping undocumented inert bindings.

**Files:**
- Modify if needed: `apps/web/src/components/inbox/keyboard-shortcuts.test.tsx`
- Modify if needed: `apps/web/src/components/inbox/ui-contract.test.tsx`

**Step 1: Write final failing regression tests**

Add a table-driven test over every entry in `SHORTCUTS` that confirms either a registered handler consumes it or the provider leaves the event unprevented when the corresponding capability is unavailable. Add tests that:

- no supported command contains a label for Front-only actions (`reply-all`, `forward`, `trash`, `spam`, `subscribe`, `star`, bulk selection, plugin panel, or new conversation);
- each help-dialog action describes an actual control/API path;
- an open menu, dialog, `input`, `textarea`, `select`, and contenteditable element prevents document shortcuts from taking action;
- primary-modifier browser commands not in the registry remain unprevented.

**Step 2: Run the focused tests and verify failure if any capability is stale**

Run:

```bash
bun --cwd apps/web test -- src/components/inbox/keyboard-shortcuts.test.tsx src/components/inbox/ui-contract.test.tsx
```

Expected: FAIL until the final registry and UI behavior agree exactly.

**Step 3: Make only the minimal corrective edits**

Update the registry/help labels or handler wiring to make every advertised command executable through an existing MsgFlow behavior. Do not add backend endpoints or placeholder menu items merely to satisfy a Front shortcut name.

**Step 4: Run the complete validation suite**

Run:

```bash
bun --cwd apps/web test
bun run test
bun run lint
bun run build
git diff --check
```

Expected: every Vitest suite passes, Turbo reports successful tests/build tasks, Biome reports no lint errors, and `git diff --check` produces no output with exit code 0.

**Step 5: Manual browser validation before release**

Run:

```bash
bun run dev:web
```

Expected: Vite prints a local URL. In an authenticated desktop-width inbox with at least three conversations, manually verify every row in the supported shortcut contract; verify both Meta (macOS) and Control emulation where available; type each single-key action into search/reply/comment inputs and confirm it types normally; open each Radix dialog/menu and confirm its navigation/Escape behavior remains unchanged. Test a mobile-width viewport and confirm no hidden desktop focus target receives a shortcut.

**Step 6: Commit**

```bash
git add apps/web/src/components/inbox/keyboard-shortcuts.test.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "test: cover inbox keyboard shortcut safety"
```

Expected: Git creates the final regression-test commit. Do not commit unrelated pre-existing untracked `.hermes/` files or `apps/worker/wrangler.msgflow-worker.toml`.

## Tests / validation

- Unit-test matching, collision protection, editable-target detection, open-layer detection, and help metadata in `apps/web/src/components/inbox/keyboard-shortcuts.test.tsx`.
- Integration-test all route, action, and composer commands in `apps/web/src/components/inbox/ui-contract.test.tsx` with the same API mocks and query-client helper already used there.
- Follow the red/green cycle within each task: add the failing test, run its exact command and observe the expected failure, add the minimum production code, rerun and observe pass, then commit only the task’s files.
- Final automated checks: `bun --cwd apps/web test`, `bun run test`, `bun run lint`, `bun run build`, and `git diff --check`.
- Final manual check must use an authenticated real inbox; unit tests cannot prove that browser-reserved combinations, focus ownership, Radix layers, and responsive layouts work together.

## Risks, tradeoffs, and open questions

- Browser-reserved chords vary. In particular, `Cmd/Ctrl+T` normally creates a browser tab and may not be reliably cancelable. The implementer must test the target browsers before advertising the chord; preserve the single-key `T` mapping if the chord cannot safely work.
- Front has multiple shortcut modes, platform differences, selections, and integrations not present here. This plan deliberately implements the single Front-style subset backed by MsgFlow behavior; “all Front shortcuts” is neither technically true nor desirable until the corresponding product features exist.
- Unmodified single letters can be surprising and conflict with typing. The strict editable/open-layer/composition gates are acceptance criteria, not optional polish.
- `Cmd/Ctrl+Enter` intentionally submits without archive. Chaining send and archive would be unsafe because email provider delivery can be uncertain, and MsgFlow’s existing composer explicitly guards against resend/duplicate outcomes.
- Shortcut preference persistence, Gmail mappings, remappable keys, a dedicated onboarding flow, and telemetry are deferred. Add them only after a user preference model and a product decision about supported shortcut schemes exist.
- The current user requested “all possible like Front”; this plan assumes that means all currently possible MsgFlow actions with Front-style mappings. If they instead require a pixel-for-pixel clone of Front’s four customizable shortcut schemes, obtain a separate product spec before implementation.
