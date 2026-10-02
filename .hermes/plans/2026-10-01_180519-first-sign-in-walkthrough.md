# First Sign-in Walkthrough Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Show each Agent a concise, accessible in-app orientation tour once when they first reach a Workspace inbox after signing in.

**Architecture:** Implement the tour as a small web-only modal component using the existing shadcn/Radix `Dialog` primitives; do not add a product-tour dependency or any Worker/D1 state. Persist completion in browser `localStorage`, scoped to the authenticated Agent ID and active Workspace ID, so it neither leaks completion between people on a shared browser nor causes a tour for every Workspace switch. Mount it only in the authenticated inbox route after both the session and explicit Workspace selection are available.

**Tech stack:** React 19, TypeScript, TanStack Router/Query, Vitest, Testing Library, existing `@/components/ui/dialog` and `@/components/ui/button`.

---

## Current context / assumptions

- `apps/web/src/routes/login.tsx:124-134` sends a successful sign-in to `/`; `apps/web/src/routes/index.tsx:179-186` resolves and canonicalizes the explicit Workspace ID, then renders the authenticated inbox at `apps/web/src/routes/index.tsx:388-420`.
- `apps/web/src/routes/__root.tsx:50-61` already blocks unauthenticated users from inbox routes. The inbox route has `session.user.id` at `apps/web/src/routes/index.tsx:170` and the active Workspace ID at `apps/web/src/routes/index.tsx:183-186`.
- The existing component system uses the accessible Radix wrapper in `apps/web/src/components/ui/dialog.tsx`; reuse it rather than introducing spotlight overlays, DOM selectors, or a third-party tour package.
- The tour is orientation only. It must not create a channel, send email, change inbox filters, or navigate the user. Its final step can explain where those actions live, but must not promise permissions to a normal Member.
- “First time” means first completed/skipped tour for a particular Agent/Workspace/browser profile. Clearing browser storage intentionally allows the tour to appear again. Cross-device completion tracking is out of scope because it would require a schema/API change with no stated product need.
- The expected copy and sequence are fixed for this implementation:
  1. **Welcome to MsgFlow** — “Work customer conversations together from one shared inbox.”
  2. **Choose what needs attention** — “Use the sidebar to switch inboxes and saved views. Filters and search narrow the conversation list.”
  3. **Read, reply, and collaborate** — “Select a conversation to see its timeline. Reply to the customer or add a private comment for your team.”
  4. **Set up your workspace when you are ready** — “Use Settings to manage team access, inboxes, channels, and automation. Available actions depend on your Workspace role.”

## Files likely to change

- Create: `apps/web/src/components/onboarding/FirstSignInWalkthrough.tsx`
- Create: `apps/web/src/components/onboarding/FirstSignInWalkthrough.test.tsx`
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/routes/-auth-flow.test.tsx` only if the existing inbox/login test harness is the closest place to assert the post-sign-in integration; otherwise keep route coverage in a new `apps/web/src/routes/first-sign-in-walkthrough.test.tsx`.

No Worker, contracts, D1 schema, migration, API client, package manifest, or lockfile changes are required.

---

## Step-by-step tasks

### Task 1: Add failing unit tests for tour state, sequence, and accessible completion

**Objective:** Define the per-Agent/per-Workspace “show once” contract before writing the component.

**Files:**
- Create: `apps/web/src/components/onboarding/FirstSignInWalkthrough.test.tsx`
- Reference: `apps/web/src/components/ui/dialog.tsx`
- Reference: `apps/web/src/test/setup.ts`

**Step 1: Write the failing test file**

Create `apps/web/src/components/onboarding/FirstSignInWalkthrough.test.tsx` with these exact tests. The import is intentionally unresolved until Task 2.

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  FIRST_SIGN_IN_TOUR_STORAGE_PREFIX,
  FirstSignInWalkthrough,
  firstSignInTourStorageKey,
} from "./FirstSignInWalkthrough";

afterEach(() => {
  localStorage.clear();
});

describe("FirstSignInWalkthrough", () => {
  const props = { userId: "agent-1", workspaceId: "workspace-1" };

  it("opens for an Agent in a Workspace that has not completed it", () => {
    render(<FirstSignInWalkthrough {...props} />);

    expect(
      screen.getByRole("dialog", { name: "Welcome to MsgFlow" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(
      screen.getByText("Work customer conversations together from one shared inbox."),
    ).toBeInTheDocument();
  });

  it("moves through the orientation copy without changing browser location", () => {
    window.history.replaceState(null, "", "/?workspace=workspace-1");
    render(<FirstSignInWalkthrough {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "Choose what needs attention" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?workspace=workspace-1");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "Read, reply, and collaborate" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", {
        name: "Set up your workspace when you are ready",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("marks completion when skipped and does not reopen after remount", () => {
    const { unmount } = render(<FirstSignInWalkthrough {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(firstSignInTourStorageKey(props))).toBe("complete");

    unmount();
    render(<FirstSignInWalkthrough {...props} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("scopes completion to both the Agent and Workspace", () => {
    localStorage.setItem(
      `${FIRST_SIGN_IN_TOUR_STORAGE_PREFIX}:agent-1:workspace-1`,
      "complete",
    );

    const { rerender } = render(<FirstSignInWalkthrough {...props} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<FirstSignInWalkthrough userId="agent-2" workspaceId="workspace-1" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
```

**Step 2: Run the focused test to verify failure**

Run:

```bash
bun --cwd apps/web vitest run src/components/onboarding/FirstSignInWalkthrough.test.tsx
```

Expected: FAIL with a module-resolution error for `./FirstSignInWalkthrough`; no unrelated test failures should be introduced.

**Step 3: Commit the test-only red state only if the team accepts red commits**

Do not normally commit a deliberately failing test. Keep it staged/working while completing Task 2. If this repository requires every micro-step committed, use:

```bash
git add apps/web/src/components/onboarding/FirstSignInWalkthrough.test.tsx
git commit -m "test: define first sign-in walkthrough behavior"
```

Otherwise, proceed directly to Task 2 and make one green commit there.

### Task 2: Implement the reusable, local-only walkthrough component

**Objective:** Add an accessible four-step dialog with deterministic state and no server-side effects.

**Files:**
- Create: `apps/web/src/components/onboarding/FirstSignInWalkthrough.tsx`
- Test: `apps/web/src/components/onboarding/FirstSignInWalkthrough.test.tsx`

**Step 1: Implement the minimal component**

Create `apps/web/src/components/onboarding/FirstSignInWalkthrough.tsx` with the following complete implementation. Keep the constant versioned (`v1`) so a materially redesigned future tour can intentionally opt users into a new version without changing old completion records.

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const FIRST_SIGN_IN_TOUR_STORAGE_PREFIX =
  "msgflow.first-sign-in-tour.v1";

const steps = [
  {
    title: "Welcome to MsgFlow",
    description: "Work customer conversations together from one shared inbox.",
  },
  {
    title: "Choose what needs attention",
    description:
      "Use the sidebar to switch inboxes and saved views. Filters and search narrow the conversation list.",
  },
  {
    title: "Read, reply, and collaborate",
    description:
      "Select a conversation to see its timeline. Reply to the customer or add a private comment for your team.",
  },
  {
    title: "Set up your workspace when you are ready",
    description:
      "Use Settings to manage team access, inboxes, channels, and automation. Available actions depend on your Workspace role.",
  },
] as const;

type WalkthroughScope = {
  userId: string;
  workspaceId: string;
};

export function firstSignInTourStorageKey({
  userId,
  workspaceId,
}: WalkthroughScope): string {
  return `${FIRST_SIGN_IN_TOUR_STORAGE_PREFIX}:${userId}:${workspaceId}`;
}

function hasCompletedTour(scope: WalkthroughScope): boolean {
  return localStorage.getItem(firstSignInTourStorageKey(scope)) === "complete";
}

export function FirstSignInWalkthrough({
  userId,
  workspaceId,
}: WalkthroughScope) {
  const scope = { userId, workspaceId };
  const [open, setOpen] = useState(() => !hasCompletedTour(scope));
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  function complete() {
    localStorage.setItem(firstSignInTourStorageKey(scope), "complete");
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) complete();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Step {stepIndex + 1} of {steps.length}
          </p>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription>{step.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={complete}>
            Skip tour
          </Button>
          {stepIndex > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStepIndex((current) => current - 1)}
            >
              Back
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              if (isLastStep) {
                complete();
                return;
              }
              setStepIndex((current) => current + 1);
            }}
          >
            {isLastStep ? "Finish" : "Next"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Implementation constraints:

- Do not add a `useEffect` that reopens the dialog after it has been dismissed. The key changes only when the authenticated Agent or selected Workspace changes, and the inbox route will remount/re-render the component with the new props.
- Do not call `window.location`, `navigate`, any API client method, or mutation from this component.
- Keep the default `DialogContent` close button and default Radix escape/overlay behavior. The controlled `onOpenChange` marks those explicit dismissals as complete, which prevents the dialog from reappearing after a normal refresh.
- Do not read/write `localStorage` at module scope; the existing project renders browser-only, but the lazy `useState` initializer keeps the persistence lookup tied to component initialization.

**Step 2: Run the focused test to verify pass**

Run:

```bash
bun --cwd apps/web vitest run src/components/onboarding/FirstSignInWalkthrough.test.tsx
```

Expected: PASS with 4 tests, including the scope-isolation and skip/remount assertions.

**Step 3: Commit the green component and tests**

```bash
git add apps/web/src/components/onboarding/FirstSignInWalkthrough.tsx apps/web/src/components/onboarding/FirstSignInWalkthrough.test.tsx
git commit -m "feat: add first sign-in walkthrough"
```

Expected: one commit containing only the walkthrough component and its tests.

### Task 3: Mount the tour after authenticated Workspace resolution

**Objective:** Make the component appear only after a successful sign-in has reached a real Workspace inbox.

**Files:**
- Modify: `apps/web/src/routes/index.tsx:8-27` and `apps/web/src/routes/index.tsx:388-420`
- Create: `apps/web/src/routes/first-sign-in-walkthrough.test.tsx`
- Reference: `apps/web/src/routes/-sidebar-live-update.test.tsx` for QueryClient test setup

**Step 1: Write the failing route integration test**

Create `apps/web/src/routes/first-sign-in-walkthrough.test.tsx`. Mock `@/components/onboarding/FirstSignInWalkthrough` as a test double that renders its received `userId` and `workspaceId`; mock the heavy inbox layout components (`AppShell`, `AppTopBar`, `Sidebar`, `ConversationList`, `ConversationThread`, `NewEmailDialog`, `SearchBar`, and `KeyboardShortcutsProvider`) to simple elements; and mock `useSession` plus the two initial APIs.

The test must prove these exact contracts:

```tsx
it("mounts the tour only after resolving the authenticated Agent and explicit Workspace", async () => {
  vi.mocked(useSession).mockReturnValue({
    data: { user: { id: "agent-1" } },
  } as never);
  vi.mocked(api.listWorkspaces).mockResolvedValue({
    workspaces: [{ id: "workspace-1", name: "Support", role: "member" }],
  } as never);
  vi.mocked(api.listConversations).mockResolvedValue({ conversations: [] } as never);

  vi.spyOn(Route, "useSearch").mockReturnValue({ workspace: "workspace-1" });
  renderInboxWithQueryClient();

  expect(await screen.findByTestId("first-sign-in-tour")).toHaveTextContent(
    "agent-1:workspace-1",
  );
});
```

Add a companion test where `useSession` has no `data` or `listWorkspaces` returns `[]`; assert `queryByTestId("first-sign-in-tour")` is null. Do not test the dialog’s internal behavior here—that belongs to Task 1.

**Step 2: Run the integration test to verify failure**

Run:

```bash
bun --cwd apps/web vitest run src/routes/first-sign-in-walkthrough.test.tsx
```

Expected: FAIL because `InboxContent` has not imported or rendered the walkthrough test double.

**Step 3: Add the route import and conditional render**

In `apps/web/src/routes/index.tsx`, add this import beside the other component imports:

```tsx
import { FirstSignInWalkthrough } from "@/components/onboarding/FirstSignInWalkthrough";
```

Then add this sibling immediately after the existing `<NewEmailDialog ... />` in the fragment returned by `InboxContent` (before the fragment closes):

```tsx
{activeWorkspaceId && session ? (
  <FirstSignInWalkthrough
    userId={session.user.id}
    workspaceId={activeWorkspaceId}
  />
) : null}
```

This exact location makes the tour independent of inbox loading, preserves the existing `AppShell` tree, and prevents a blank/stale Workspace ID from creating a meaningless storage key.

**Step 4: Run route and component tests to verify pass**

Run:

```bash
bun --cwd apps/web vitest run src/components/onboarding/FirstSignInWalkthrough.test.tsx src/routes/first-sign-in-walkthrough.test.tsx
```

Expected: PASS; the component test reports 4 tests and the new route integration test reports 2 tests. The exact total output can vary if Vitest discovers shared setup tests, but there must be no failures.

**Step 5: Commit the integration**

```bash
git add apps/web/src/routes/index.tsx apps/web/src/routes/first-sign-in-walkthrough.test.tsx
git commit -m "feat: show walkthrough after first workspace sign-in"
```

Expected: one commit containing only the inbox integration and focused route test.

### Task 4: Run focused regression, type, lint, build, and manual accessibility validation

**Objective:** Verify the feature works in the actual web app without altering current sign-in, workspace routing, or inbox behavior.

**Files:**
- Verify only; do not edit files unless a failing command identifies a defect in the new files.

**Step 1: Run the full web test suite**

Run:

```bash
bun --cwd apps/web test
```

Expected: exit code 0 and all `apps/web` Vitest suites pass, including existing `src/routes/-auth-flow.test.tsx`, `src/routes/-settings.contract.test.tsx`, and the new walkthrough tests.

**Step 2: Run repository quality gates**

Run each command separately so a failure is attributable:

```bash
bun run lint
bun run build
bun run format
```

Expected:

- `bun run lint`: exit code 0 with no Biome lint errors.
- `bun run build`: exit code 0; Turbo builds the affected web workspace successfully.
- `bun run format`: exit code 0. This command is mutating in normal implementation mode; run it before the final diff review, then inspect and commit any formatting-only changes with the relevant feature commit rather than leaving them untracked.

**Step 3: Perform a local browser smoke test**

Run:

```bash
bun run dev:web
```

Expected: Vite reports a local web URL (normally `http://localhost:5173`). In a browser using a disposable test Agent and Workspace:

1. Sign in and confirm the four-step dialog appears after the inbox route has loaded.
2. Use `Tab`, `Shift+Tab`, `Enter`, and `Escape`; focus must remain in the dialog while open, buttons must be reachable, and Escape must dismiss it.
3. Refresh after **Skip tour**, **Finish**, and **Escape**; the dialog must not return for that Agent/Workspace.
4. Switch to a different Workspace for the same Agent; the dialog must appear once there.
5. Sign in as a different Agent in the same browser; the dialog must appear once for that Agent.
6. Confirm the URL, selected Workspace, filters, conversation selection, and API/network activity remain unchanged while pressing Next/Back.

Stop the dev server after validation. Do not use a production account or real provider credentials for this check.

**Step 4: Review the final change set and commit any formatter changes**

Run:

```bash
git diff --check
git status --short
git diff -- apps/web/src/components/onboarding/FirstSignInWalkthrough.tsx apps/web/src/components/onboarding/FirstSignInWalkthrough.test.tsx apps/web/src/routes/index.tsx apps/web/src/routes/first-sign-in-walkthrough.test.tsx
```

Expected: `git diff --check` has no output; the diff is limited to the four intended feature files (plus any explicitly reviewed formatter changes). If `bun run format` changed tracked files, add them to the relevant commit only after confirming they are formatting-only.

---

## Tests / validation summary

- Unit TDD: `apps/web/src/components/onboarding/FirstSignInWalkthrough.test.tsx` covers first render, all navigation steps, skip completion/remount behavior, and Agent/Workspace storage scoping.
- Route TDD: `apps/web/src/routes/first-sign-in-walkthrough.test.tsx` proves only an authenticated Agent with a resolved Workspace mounts the tour and that its scope props are correct.
- Regression: `bun --cwd apps/web test`, then root `bun run lint`, `bun run build`, and `bun run format`.
- Manual accessibility smoke: keyboard-only dialog operation, no reappearance after any completion path, and scope behavior across Workspace/Agent changes.

## Risks, tradeoffs, and open questions

- **Local-only completion:** The chosen storage model is intentionally lightweight and has no backend migration risk, but clearing browser data or using another device shows the tour again. Persisting it cross-device should be a separate, explicitly requested preference/API feature.
- **No anchored spotlights:** A modal sequence is more resilient to responsive layouts, sidebar compact mode, loading states, and future DOM changes than target-selector overlays. It explains stable concepts rather than forcing clicks on potentially unavailable controls.
- **Role-sensitive controls:** Normal Members may lack Settings actions. The final copy deliberately says availability depends on Workspace role; do not add owner/admin-only branches unless product specifies different onboarding for those roles.
- **Storage availability:** The app already uses `localStorage` for theme and sidebar density (`apps/web/src/routes/index.tsx:173-175`, `apps/web/src/components/layout/AppTopBar.tsx:47-49`), so this follows the established browser assumption. If the product must support blocked storage, define a separate non-persistent fallback policy rather than silently changing first-sign-in semantics.
- **Open product question:** There is no replay entry point in this YAGNI scope. If support or training needs one, add an explicit “Replay walkthrough” action in Settings later; it should remove only the current Agent/Workspace key and never expose another Agent’s state.
