# Front-Style shadcn UI Refresh Implementation Plan

> **For Hermes:** Use the `subagent-driven-development` skill to implement this plan task-by-task.

**Goal:** Replace MsgFlow’s web UI with a cohesive, professional Front-inspired workspace built from shadcn/ui primitives and the supplied warm-neutral light/dark theme, without changing product behavior or authorization boundaries.

**Architecture:** Keep the current TanStack Router routes, React Query keys, contracts, API calls, and Durable Object WebSocket behavior intact; refactor only presentation and local UI composition. Establish the token layer in `apps/web/src/index.css`, add shadcn source components in `apps/web/src/components/ui/`, then compose them into a persistent three-pane inbox shell (navigation, conversation list, conversation detail) with responsive drawers/sheets rather than route replacement. Settings remains a right-side workspace panel; Front inspiration means information hierarchy and dense, calm workflow—not copying Front branding, assets, or proprietary UI.

**Tech stack:** Bun 1.3.14, React 19, Vite 6, Tailwind CSS 4, TanStack Router/Query, Lucide, Radix-based shadcn (`apps/web/components.json`, `style: new-york`).

---

## Current context / assumptions

- The app is MsgFlow, a Front/Missive-style unified inbox for Facebook Messenger and email. Domain terms are defined in `CONTEXT.md`: a Conversation belongs to one Inbox, an Assignee is accountable, and lifecycle status is only `open | archived`; snooze is separate.
- The inbox route is currently assembled in `apps/web/src/routes/index.tsx` from `Sidebar`, `SearchBar`, `ConversationList`, and `ConversationThread`. Its API behavior, search URL (`?c=<conversationId>`), 5-second list refresh, and workspace cache keys must remain unchanged.
- `apps/web/components.json` confirms Tailwind 4, `src/index.css`, aliases under `@/`, Lucide, and shadcn New York/Radix. Only `Button` is currently installed as a shadcn source component.
- `apps/web/src/index.css`, `apps/web/src/routes/settings.tsx`, and `apps/web/src/routes/setup.tsx` already contain unrelated uncommitted work. Do not reset, reformat wholesale, stage, or overwrite it. Every commit below must use explicit file paths and occur only after inspecting `git diff -- <paths>`.
- Before Task 1, save a read-only baseline with `git diff -- apps/web/src/index.css apps/web/src/routes/settings.tsx apps/web/src/routes/setup.tsx > /tmp/msgflow-ui-refresh-baseline.diff`. Before every commit that touches one of those shared files, compare it with the current file diff and use `git add -p <file>` to stage only refresh hunks; then verify with `git diff --cached -- <file>`. Never use `git add <file>` for those three files.
- The repository currently has no web `*.test.*` or `*.spec.*` files. Add a minimal web test harness before claiming visual regression coverage; do not pretend `bun run test` tests the UI unless the new web test script is wired into Turbo.
- Front’s public site confirms its product framing around coordinated conversations, teams, and customer context. At implementation start, re-check current official Front help documentation for interaction details that affect the mapping; previous help-center deep links returned 404, so use the current Help Center search rather than stale article URLs.
- Design direction: refined operational workspace, not a marketing dashboard. Use the supplied warm-neutral semantic tokens; avoid raw gray/slate/amber/green/red utility colors except where shadcn semantic `destructive` is appropriate. Use semantic Tailwind colors (`bg-background`, `text-muted-foreground`, `bg-accent`, etc.) and token-derived opacity only.

## UX specification (the implementer must not improvise)

1. **Desktop inbox (>= 1024px):** fixed-height application workspace with a 232px navigation rail (56px compact), a 360px conversation list, and a flexible detail pane. A thin header belongs to the list/detail workspace, not a separate global status-tab bar. No decorative cards around every pane.
2. **Navigation rail:** brand/workspace switcher at top; compact icon button; inbox and mailbox navigation grouped and collapsible; numerical unread counts aligned on the right; one clear selected state; bottom utility actions for notifications, Rules, Settings, and profile/sign-out. Preserve existing drag reordering, pin/hide controls, mailbox selection, and notification behavior.
3. **Conversation list:** header shows the active queue name and count, then a full-width search trigger/field with a filter button and active-filter count. Rows are compact (avatar, sender, subject/preview, channel glyph, time, unread dot/count, tags) with a subtle selected rail/background. Replace the current top-level Open/Archived/All tabs with an accessible `Tabs` control within this header; status transitions still reset the same filters as today.
4. **Conversation detail:** header shows identity/channel metadata and compact icon actions (assign, move, snooze, archive/reopen, activity) with labels available through tooltips/menus. Keep tags visible. Timeline is quiet: inbound neutral surface, outbound primary surface, Comments clearly distinct but token-based, Activities in the existing modal. Composer is visually anchored at bottom; Reply/Comment uses `ToggleGroup`, attachment is an icon button, send is a primary button. Preserve all email draft, identity confirmation, attachment, and uncertain-send safety copy exactly.
5. **Responsive (< 1024px):** no clipped three-pane layout. Use shadcn `Sheet` for navigation and conversation list, one pane at a time; retain `?c=` selection and a visible back-to-list control. At mobile widths, settings remains a full-width Sheet; do not create a bottom tab bar.
   - With no `c` search parameter, render the conversation list as the primary mobile page and keep navigation closed.
   - Selecting a row sets `c` and renders the detail as the primary mobile page; do not leave the list Sheet open over it.
   - The detail header’s Back button clears only `c` via `navigate({ to: "/", search: {} })`; browser Back/Forward continues to use router history and restores the matching list/detail state.
   - A narrow direct load of `/?c=<id>` opens that Conversation detail if it resolves; if it returns not found/unauthorized, render the existing not-found state with the Back button instead of a blank Sheet.
6. **Other routes:** login and setup become restrained branded entry surfaces using the same tokens and shadcn fields/cards. All administrative/configuration surfaces live in the Settings side panel; there is no separate Rules management page in the finished UI. Settings remains a right-side overlay and preserves every existing form, warning, confirmation, and server-authorized action. Direct `/settings` navigation or refresh must render the same Settings Sheet over the inbox shell (or the authenticated root fallback while workspace data loads); Close always navigates to `/`, and the unauthenticated root guard still redirects to `/login`.
7. **Accessibility:** all icon-only controls need an accessible name and Tooltip; focus rings use `ring`; overlays are shadcn `Dialog`/`Sheet` with titles; keyboard navigation, escape close, focus trapping, color contrast, and reduced-motion behavior work without custom z-index stacks.
8. **Settings information architecture:** use this exact ordered section list: **Workspace** (workspace identity and members when available), **Inboxes**, **Channels**, **Mailboxes & domains**, **Rules & canned replies**, and **Preferences** (only user-level settings such as theme when approved). Keep Rules and canned replies in one `Rules & canned replies` section: Rules is the primary panel; canned replies is a lower subsection because rules reference them. A sidebar Settings action opens the panel; the existing sidebar “Rules” action must instead navigate to `/settings?section=rules` (or the typed TanStack Router equivalent), never to a separate admin page. Persisting the selected section in the URL is required so direct links, refresh, and browser history reopen the intended Settings section.

## Step-by-step tasks

### Task 1: Lock the presentation contract before changing UI

**Objective:** Record the existing interaction surface and prevent a visual refactor from silently changing domain behavior.

**Files:**
- Create: `apps/web/src/components/inbox/ui-contract.test.tsx`
- Modify: `apps/web/package.json`
- Modify: `turbo.json` only if its task graph does not already run the new `test` script

**Step 1: Add the web test dependencies using the workspace package manager.**

Run from repository root:
```bash
bun add -d --cwd apps/web vitest @testing-library/react @testing-library/jest-dom jsdom
```

Expected: Bun updates `apps/web/package.json` and `bun.lock`; no production dependency is added.

**Step 2: Add these scripts to `apps/web/package.json`.**

```json
"test": "vitest run",
"test:watch": "vitest"
```

If Vitest needs explicit configuration under Vite 6, create `apps/web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

Create `apps/web/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

**Step 3: Write the failing behavior tests, not snapshot tests.**

`apps/web/src/components/inbox/ui-contract.test.tsx` must mock only `@/lib/api`, render the **current** `ConversationList`, `ConversationActions`, and `SearchBar` with fixture data, and assert:
- a selected conversation exposes its contact, preview, channel, unread count, and tags;
- `ConversationActions` still calls `api.updateConversation` with `{ status: "archived" }`;
- `SearchBar` submits the entered query only on Enter and Clear emits an empty filter object.

Run:
```bash
bun --cwd apps/web test
```

Expected before the harness exists: the command is unavailable. After the script and test file exist, the first red phase must be a real contract assertion against current behavior (for example, deliberately assert an incorrect archive payload), then correct the assertion without changing production UI. Do not describe missing imports/scripts as a behavior-test failure.

**Step 4: Add only the test harness and fixtures needed for the tests to execute; do not change UI behavior in this task.**

Run:
```bash
bun --cwd apps/web test
bun run lint
```

Expected: web Vitest reports passing UI-contract tests; Biome reports no errors.

**Step 5: Commit only test infrastructure.**

```bash
git add apps/web/package.json bun.lock apps/web/vitest.config.ts apps/web/src/test/setup.ts apps/web/src/components/inbox/ui-contract.test.tsx turbo.json
git commit -m "test(web): add UI interaction contract coverage"
```

Do not stage a path that does not exist. For dirty shared files, follow the baseline/hunk-staging rule above; do not stage pre-existing unrelated changes.

### Task 2: Install the required shadcn source primitives safely

**Objective:** Make the UI use local shadcn components rather than hand-built controls.

**Files:**
- Create: the exact files reported by the shadcn CLI under `apps/web/src/components/ui/`
- Modify: `apps/web/components.json` only if initialization requires a non-destructive config correction

**Step 1: Inspect current component state and upstream APIs.**

Run from `apps/web`:
```bash
bunx --bun shadcn@latest info --json
bunx --bun shadcn@latest docs alert avatar badge card checkbox dialog dropdown-menu empty field input label popover select separator sheet skeleton tabs textarea toggle-group tooltip
```

Expected: `info` reports the aliases and `src/index.css`; `docs` returns documentation URLs. Fetch and read those URLs before coding so the implementation uses the current Radix APIs.

**Step 2: Preview additions, then add only these components.**

```bash
bunx --bun shadcn@latest add alert avatar badge card checkbox dialog dropdown-menu empty field input label popover select separator sheet skeleton tabs textarea toggle-group tooltip --dry-run
bunx --bun shadcn@latest add alert avatar badge card checkbox dialog dropdown-menu empty field input label popover select separator sheet skeleton tabs textarea toggle-group tooltip
```

Expected: source files land in `apps/web/src/components/ui/`; `button.tsx` is not overwritten. Do not use `--overwrite`.

**Step 3: Inspect every generated file.**

Verify imports resolve through `@/`, icon use matches Lucide, and every generated component compiles. No custom modifications yet.

Run:
```bash
bun --cwd apps/web run build
bun run lint
```

Expected: both commands exit 0.

**Step 4: Commit the shadcn source only.**

```bash
git add apps/web/src/components/ui apps/web/components.json apps/web/package.json bun.lock
git commit -m "feat(web): add shadcn UI primitives"
```

### Task 3: Apply the supplied semantic theme and global interaction baseline

**Objective:** Make every shadcn component render from the user-supplied warm-neutral light and dark tokens.

**Files:**
- Modify: `apps/web/src/index.css:44-111`
- Modify: `apps/web/src/index.css:113-126`

**Step 1: Replace only the existing `:root` and `.dark` variable values with the following exact values. Keep the existing `@theme inline` mapping.**

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.147 0.004 49.3);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.147 0.004 49.3);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.147 0.004 49.3);
  --primary: oklch(0.214 0.009 43.1);
  --primary-foreground: oklch(0.986 0.002 67.8);
  --secondary: oklch(0.96 0.002 17.2);
  --secondary-foreground: oklch(0.214 0.009 43.1);
  --muted: oklch(0.96 0.002 17.2);
  --muted-foreground: oklch(0.547 0.021 43.1);
  --accent: oklch(0.96 0.002 17.2);
  --accent-foreground: oklch(0.214 0.009 43.1);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0.005 34.3);
  --input: oklch(0.922 0.005 34.3);
  --ring: oklch(0.714 0.014 41.2);
  --chart-1: oklch(0.879 0.169 91.605);
  --chart-2: oklch(0.769 0.188 70.08);
  --chart-3: oklch(0.666 0.179 58.318);
  --chart-4: oklch(0.555 0.163 48.998);
  --chart-5: oklch(0.473 0.137 46.201);
  --radius: 0.625rem;
  --sidebar: oklch(0.986 0.002 67.8);
  --sidebar-foreground: oklch(0.147 0.004 49.3);
  --sidebar-primary: oklch(0.214 0.009 43.1);
  --sidebar-primary-foreground: oklch(0.986 0.002 67.8);
  --sidebar-accent: oklch(0.96 0.002 17.2);
  --sidebar-accent-foreground: oklch(0.214 0.009 43.1);
  --sidebar-border: oklch(0.922 0.005 34.3);
  --sidebar-ring: oklch(0.714 0.014 41.2);
}

.dark {
  --background: oklch(0.147 0.004 49.3);
  --foreground: oklch(0.986 0.002 67.8);
  --card: oklch(0.214 0.009 43.1);
  --card-foreground: oklch(0.986 0.002 67.8);
  --popover: oklch(0.214 0.009 43.1);
  --popover-foreground: oklch(0.986 0.002 67.8);
  --primary: oklch(0.922 0.005 34.3);
  --primary-foreground: oklch(0.214 0.009 43.1);
  --secondary: oklch(0.268 0.011 36.5);
  --secondary-foreground: oklch(0.986 0.002 67.8);
  --muted: oklch(0.268 0.011 36.5);
  --muted-foreground: oklch(0.714 0.014 41.2);
  --accent: oklch(0.268 0.011 36.5);
  --accent-foreground: oklch(0.986 0.002 67.8);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.547 0.021 43.1);
  --chart-1: oklch(0.879 0.169 91.605);
  --chart-2: oklch(0.769 0.188 70.08);
  --chart-3: oklch(0.666 0.179 58.318);
  --chart-4: oklch(0.555 0.163 48.998);
  --chart-5: oklch(0.473 0.137 46.201);
  --sidebar: oklch(0.214 0.009 43.1);
  --sidebar-foreground: oklch(0.986 0.002 67.8);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.986 0.002 67.8);
  --sidebar-accent: oklch(0.268 0.011 36.5);
  --sidebar-accent-foreground: oklch(0.986 0.002 67.8);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.547 0.021 43.1);
}
```

Keep the existing `.setup-input` utility untouched in this task because `setup.tsx` has not yet migrated. Task 8 removes it only after `rg -n 'setup-input' apps/web/src` returns no application usages.

**Step 2: Run the existing interaction contract suite and build.**

```bash
bun --cwd apps/web test -- ui-contract.test.tsx
bun --cwd apps/web run build
bun run lint
```

Expected: PASS / exit 0 / exit 0.

**Step 3: Commit.**

```bash
git add apps/web/src/components/inbox/ui-contract.test.tsx
git add -p apps/web/src/index.css
git diff --cached -- apps/web/src/index.css apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "feat(web): apply warm neutral design tokens"
```

### Task 4: Create the responsive application shell and navigation rail

**Objective:** Replace the fragmented page framing with one Front-like shell while preserving sidebar functionality.

**Files:**
- Create: `apps/web/src/components/layout/AppShell.tsx`
- Create: `apps/web/src/components/layout/AppMobileHeader.tsx`
- Modify: `apps/web/src/routes/index.tsx:20-210`
- Modify: `apps/web/src/components/sidebar/Sidebar.tsx`

**Implementation requirements:**
- `AppShell` owns desktop CSS grid dimensions and mobile `Sheet` state; it accepts `sidebar`, `list`, and `detail` React nodes, not API data, so query behavior stays in `routes/index.tsx`.
- Recompose `Sidebar` with `Avatar`, `Button`, `DropdownMenu`, `Tooltip`, `Badge`, `Separator`, `Skeleton`, and `Sheet` triggers. Preserve every existing callback, preferences update, drag/drop event, mailbox row, notification query, rules navigation, settings navigation, and compact localStorage key.
- Replace all custom popup `div`s and document mousedown logic for notifications/menu with `Popover` or `DropdownMenu`; retain the existing mark-read-before-navigation behavior.
- Never nest buttons (the current sidebar header has this risk); section expander and add-inbox action must be sibling controls.
- Add an accessible named mobile menu button and an accessible back-to-list control when `conversationId` is set.
- At exactly 1024px, keep the 232px rail and 360px list only when the remaining detail width is at least 432px. Below that usable-detail threshold, switch to the mobile one-pane model even if the viewport is technically desktop-sized. The list, timeline, and composer must each have independent scroll containers; the composer stays visible above the viewport keyboard and a tall draft must scroll within the composer rather than expanding the page.

**TDD cycle:** add tests for the compact toggle’s aria label and for the mobile menu opening a named navigation dialog; run to fail, implement, then rerun.

```bash
bun --cwd apps/web test -- ui-contract.test.tsx
bun --cwd apps/web run build
bun run lint
```

Expected: all pass. Then manually use `bun run dev`, sign in, and verify desktop and 390px/768px/1440px viewports with no horizontal body overflow.

```bash
git add apps/web/src/components/layout/AppShell.tsx apps/web/src/components/layout/AppMobileHeader.tsx apps/web/src/routes/index.tsx apps/web/src/components/sidebar/Sidebar.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "feat(web): add responsive inbox workspace shell"
```

### Task 5: Rebuild search and conversation-list hierarchy with shadcn

**Objective:** Deliver the Front-style queue header, filter surface, status tabs, loading/empty states, and compact conversation rows.

**Files:**
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/components/inbox/SearchBar.tsx`
- Modify: `apps/web/src/components/inbox/ConversationList.tsx`
- Modify: `apps/web/src/components/inbox/TagChip.tsx`
- Modify: `apps/web/src/components/inbox/ContactAvatar.tsx`

**Implementation requirements:**
- Use `Tabs`/`TabsList`/`TabsTrigger` for Open, Archived, All; preserve the existing reset logic verbatim.
- Make advanced facets a `Popover` containing `FieldGroup`/`Field` and shadcn `Select`; Search remains immediately visible. Use `Button` for Clear and `Badge` for filter count. Do not change `SearchFilters` or `activeFilterCount` semantics.
- Use `Skeleton` during pending state and shadcn `Empty` for the no-conversation state. Conversation rows remain real `<button>` elements, not links, to preserve `onSelect` routing.
- Render channel, unread, tag, and time data from the same `ConversationSummary` fields. No new query or API call.
- In this task—not Task 3—add a source-level semantic-class audit for the migrated `SearchBar`, `ConversationList`, `TagChip`, and `ContactAvatar`: assert their application source contains no `text-gray-*`, `bg-gray-*`, `text-slate-*`, `bg-slate-*`, or hex color literals. Permit shadcn generated source and documented channel/icon data values.

**TDD cycle:** add tests for status-tab reset, active filter count, selected row, unread count, and empty state; fail first, implement, then pass.

```bash
bun --cwd apps/web test -- ui-contract.test.tsx
bun --cwd apps/web run build
bun run lint
```

Expected: all pass.

```bash
git add apps/web/src/routes/index.tsx apps/web/src/components/inbox/SearchBar.tsx apps/web/src/components/inbox/ConversationList.tsx apps/web/src/components/inbox/TagChip.tsx apps/web/src/components/inbox/ContactAvatar.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "feat(web): redesign conversation queue"
```

### Task 6: Rebuild the conversation detail, action controls, and composer surfaces

**Objective:** Give the active Conversation a dense, polished Front-like detail pane without weakening message, comment, or email safety behavior.

**Files:**
- Modify: `apps/web/src/components/inbox/ConversationThread.tsx`
- Modify: `apps/web/src/components/inbox/ConversationActions.tsx`
- Modify: `apps/web/src/components/inbox/Composer.tsx`
- Modify: `apps/web/src/components/inbox/TagPicker.tsx`

**Implementation requirements:**
- Keep the existing WebSocket lifecycle, timeline merge/dedupe, read cursor effect, email context calls, and 50-item activity limit unchanged.
- Replace custom `ActivityModal` with shadcn `Dialog`; include `DialogTitle`, `DialogDescription`, Close control, and preserve the timeline content/limit.
- Put assign/move/snooze/archive into an accessible `DropdownMenu` or explicit compact controls; preserve payloads sent to `api.updateConversation`, including local 9am snooze calculation. Use `Select` only where a selection remains immediately visible; never hide state-changing controls behind unexplained icon-only buttons.
- Use `ToggleGroup` for Reply/Comment. Use `Textarea`, `Input`, `Select`, `Checkbox`, `Button`, `Badge`, and `Alert`/semantic destructive styling instead of raw form markup. Preserve the email `clientMessageId`, serialized draft autosaves, identity confirmation, attachment limits, retry warning, and exact “delivery not confirmed” language.
- Use semantic comment styling (`bg-secondary`, `text-secondary-foreground`, `border-border`), not amber. Inbound/outbound bubbles may use `bg-muted` and `bg-primary`; retain readable metadata contrast.

**TDD cycle:** extend tests to assert archive/reopen payloads, Reply/Comment toggle state, email send disabled when required identity/context is missing, and Dialog naming. Add the email-safety regression matrix: a draft survives conversation remount/hydration, changing reply identity clears private-identity confirmation, attachment upload failure leaves the prior draft intact, a busy/submitted send cannot initiate a second request, an uncertain outcome preserves the same client message ID and warning, and retry never invents a new ID. Run red → minimal implementation → green.

```bash
bun --cwd apps/web test -- ui-contract.test.tsx
bun --cwd apps/web run build
bun run lint
```

Expected: all pass.

```bash
git add apps/web/src/components/inbox/ConversationThread.tsx apps/web/src/components/inbox/ConversationActions.tsx apps/web/src/components/inbox/Composer.tsx apps/web/src/components/inbox/TagPicker.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "feat(web): redesign conversation detail and composer"
```

### Task 7: Recompose the complete Settings control center

**Objective:** Move every administrative surface—including Rules and canned replies—into a coherent Settings control center without hiding warnings or changing privileged behavior.

**Files:**
- Modify: `apps/web/src/routes/settings.tsx`
- Modify: `apps/web/src/components/email-admin.tsx`
- Modify: `apps/web/src/components/inbox/EmailSettings.tsx` if it is still imported anywhere; otherwise remove it only after confirming zero imports and explicit user approval for deletion
- Modify: `apps/web/src/components/sidebar/InboxSettingsDrawer.tsx`
- Modify: `apps/web/src/routes/rules.tsx`
- Modify: `apps/web/src/components/rules/RuleForm.tsx`

**Implementation requirements:**
- Settings stays a right-side `Sheet`/`Dialog` route overlay. Its sections use an accessible vertical `Tabs` pattern on desktop and a compact control on mobile. The `/settings` route must be refresh-safe and direct-load-safe as specified above; close always returns to `/` rather than relying on browser history. Preserve existing tab IDs, API mutation calls, confirmations, OAuth redirects, and webhook-secret display behavior.
- Implement the exact Settings section order from the UX specification. Add the `rules` section to the typed `/settings` search validation and make `Settings` derive its active section from the URL, defaulting to the first authorized section. Selecting a section updates only `section` in the URL; direct `/settings?section=rules` and refresh show Rules & canned replies. If a role is not permitted to manage rules, omit that navigation item and redirect an attempted `section=rules` to the first authorized section without making a privileged API call.
- Move the rendered contents of `apps/web/src/routes/rules.tsx` into a new `RulesSettingsSection` component under `apps/web/src/components/settings/RulesSettingsSection.tsx`; keep `RuleForm` as the reusable form. Change `/rules` into a compatibility redirect to `/settings?section=rules` so old sidebar actions/bookmarks do not lead to a second layout. Do not delete the route file in this UI change.
- Replace the inbox sidebar’s Rules button with a Settings deep link to `section=rules`; retain Rules as a distinct Settings section rather than burying it under generic “Preferences.”
- Convert forms to shadcn `FieldGroup` + `Field`, `Input`, `Select`, `Checkbox`, `Textarea`, `Alert`, and `Card`. Keep every role/permission warning, DNS/operator checklist, preview-before-commit control, confirmation call, and error text.
- Use Cards for bounded configuration records (domain, mailbox, rule, canned reply), not for the main page chrome. Use `Badge` for state labels and `Alert` for irreversible/operational warnings.
- Do not alter server-side endpoint selection, request shapes, query keys, authorization conditions, token/password input types, or `window.location.assign` OAuth flow.

**TDD cycle:** add form-level tests for disabled submit states and the existence of required confirmation copy. Add routing tests proving `/settings?section=rules` renders Rules & canned replies, sidebar Rules navigation becomes that deep link, and `/rules` redirects there. Add a permission-visibility matrix with at least Owner and non-Owner fixtures: Owner sees domain/mailbox lifecycle and rule-management controls; a non-Owner does not see privileged controls but still sees authorized read-only readiness; a private-mailbox delegate/owner view shows only the permitted delegation controls. These tests verify presentation only and must not weaken server authorization. Run them red first, then green after composition changes.

```bash
bun --cwd apps/web test
bun --cwd apps/web run build
bun run lint
```

Expected: all commands exit 0.

```bash
git add apps/web/src/components/email-admin.tsx apps/web/src/components/inbox/EmailSettings.tsx apps/web/src/components/sidebar/InboxSettingsDrawer.tsx apps/web/src/components/settings/RulesSettingsSection.tsx apps/web/src/components/rules/RuleForm.tsx apps/web/src/components/sidebar/Sidebar.tsx apps/web/src/routes/rules.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git add -p apps/web/src/routes/settings.tsx
git diff --cached -- apps/web/src/routes/settings.tsx
git commit -m "feat(web): unify settings and rules UI"
```

### Task 8: Rebuild setup and login as restrained entry flows

**Objective:** Give setup/login the same product identity without introducing a second visual system.

**Files:**
- Modify: `apps/web/src/routes/setup.tsx`
- Modify: `apps/web/src/routes/setup/channel.tsx`
- Modify: `apps/web/src/routes/login.tsx`
- Modify: `apps/web/src/index.css` only to remove now-unused setup utility styles

**Implementation requirements:**
- Preserve all field names, validators, password constraints, navigation destinations, invitation and reset-token branches, auth calls, and status/error messages.
- Compose forms from the shadcn Input/Field/Button/Card/Alert primitives. Keep the existing progress sequence and differentiated setup panel, but recolor it entirely through the supplied semantic variables—no `#...`, `text-gray-*`, raw `bg-white`, or bespoke green palette.
- Ensure password fields remain `type="password"` and no error/status message is visually or semantically lost.

**TDD cycle:** cover setup step validation and login branch labels/actions; run failing tests before modifying the route, then run them to pass.

```bash
bun --cwd apps/web test
bun --cwd apps/web run build
bun run lint
```

Expected: all pass.

```bash
git add apps/web/src/routes/setup/channel.tsx apps/web/src/routes/login.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git add -p apps/web/src/routes/setup.tsx apps/web/src/index.css
git diff --cached -- apps/web/src/routes/setup.tsx apps/web/src/index.css
git commit -m "feat(web): align onboarding and auth UI"
```

### Task 9: Remove visual debt and perform real workflow verification

**Objective:** Ensure the UI is consistently token-driven, responsive, accessible, and behaviorally unchanged.

**Files:**
- Modify only the files named by the audits below.

**Step 1: Audit raw styling and hand-rolled overlays.**

Run:
```bash
rg -n 'text-(gray|slate|red|amber|green)-|bg-(gray|slate|red|amber|green)-|#[0-9A-Fa-f]{3,8}|fixed inset-0 z-|space-[xy]-' apps/web/src --glob '*.{ts,tsx,css}'
rg -n '<(input|select|textarea)\b' apps/web/src --glob '*.tsx'
```

Expected: only intentionally retained browser inputs inside shadcn source files or documented unsupported native controls. For each remaining app-level match, replace it with a semantic token/component or document why it cannot be replaced. Do not blindly rewrite generated shadcn source.

**Step 2: Validate via automated checks.**

```bash
bun --cwd apps/web test
bun run test
bun run lint
bun run build
```

Expected: every command exits 0. If the root suite is blocked by an unrelated existing Worker failure, run `bun --cwd apps/web test`, `bun --cwd apps/web run build`, and `bun run lint`, then report the exact root-suite blocker without modifying unrelated backend code.

**Step 3: Validate live workflows with the local stack.**

Start from repository root:
```bash
bun run dev
```

Expected: web server on `http://localhost:5173`, Worker on `http://localhost:8787`, with `/setup` and `/health` returning 200 as documented in `msgflow-dev`.

Manually verify at 390px, 768px, 1024px, and 1440px:
1. Sign in, switch workspace, collapse/expand navigation, open/close notifications, choose a mailbox/inbox, and reopen the selected conversation using `?c=`.
2. Search, open/archived/all status, assignee/channel/tag/date facets, Clear, and unread count visibility.
3. Assign, move, snooze, archive/reopen, add/remove tags, Reply/Comment, mention selection, attachment controls, and activity dialog.
4. Email reply disabled states, private identity confirmation, and “accepted is not delivery” status text.
5. Settings Sheet information architecture: section order, direct `/settings?section=rules`, browser refresh, `/rules` compatibility redirect, Rules & canned replies management, domain/mailbox controls, Meta Page/OAuth panel, login/reset/invitation, and first-use setup.
6. Keyboard-only: Tab order, visible focus, Escape closes menus/dialogs/sheets, and all icon-only controls announce names. Toggle `.dark` manually in DevTools to ensure tokens—not raw colors—drive both schemes.
7. Browser routing/transitions: load `/settings` directly and refresh it; close it and confirm the URL is `/`; open `/?c=<known-id>` directly at 390px; use browser Back/Forward after conversation selection and settings open/close; verify focus returns to the invoking trigger after closing every Sheet/Dialog; switch Conversations during a pending archive/send/draft operation and confirm the operation remains scoped to its originating ID.
8. Email-safety browser pass: autosave an email draft, switch away and back, change Reply Identity after acknowledging the private-identity checkbox, force/observe attachment-upload failure, double-click Send, and exercise an uncertain send. Confirm the persisted draft, client request ID, warning, disabled state, and delivery wording match the Task 6 tests; never create a fresh request ID to recover an uncertain outcome.
9. Role browser pass with two authenticated fixtures: Owner can reach privileged Settings and Rules controls; a non-Owner cannot see or invoke privileged lifecycle/rule controls while authorized read-only data remains usable; a private mailbox owner/delegate only sees its permitted delegation actions. Confirm each denied request is still rejected by the server if UI controls are manually bypassed.

**Step 4: Final commit.**

```bash
git add <only-audited-web-files>
git commit -m "chore(web): complete Front-style UI polish"
```

## Tests / validation summary

- Per task: write a focused failing Vitest test, prove failure with `bun --cwd apps/web test -- <file>`, make the smallest UI change, then prove pass before committing. These are interaction/contract tests, not automated visual-regression tests.
- Minimum automated gate: `bun --cwd apps/web test`, `bun run test`, `bun run lint`, `bun run build`.
- Manual acceptance gates: all nine workflow groups in Task 9 at each listed responsive width; no horizontal overflow; usable 432px-or-wider desktop detail pane; independent list/timeline/composer scrolling; keyboard-accessible overlays with focus restoration; no raw palette utilities in application UI; no change to API request payloads, routes, storage keys, or email safety copy.
- Use `bun run format` only after confirming its changed-file scope. The root script uses `--write`, so do not run it against a dirty repository; format only explicit changed files with `bunx biome format --write <paths>` and inspect the diff before staging.

## Risks, tradeoffs, and open questions

- This is a large surface-area visual replacement. A single broad “rewrite everything” commit will bury behavioral regressions. Keep the task boundaries and commit scopes above; do not mix the user’s current Meta App/onboarding changes into UI commits.
- The current app has raw controls and some custom modal/popover code. Replacing them with shadcn gives accessibility and token consistency, but must be done component-by-component so existing mutation semantics survive.
- Installing Vitest adds developer tooling and lockfile changes. It is warranted because the repo currently lacks web interaction coverage; it does not provide screenshot or automated visual-regression coverage. Do not add Playwright or visual-snapshot infrastructure unless the user requests a CI/browser suite.
- “Front feel” is intentionally interpreted as calm dense navigation, queue-first triage, and collaboration-centered detail; it does not authorize copying Front logos, copy, illustrations, or exact layout. MsgFlow deliberately differs: it uses logical Mailboxes/Email Domains and private-mailbox authorization, which must remain visible in Settings.
- The supplied dark `--sidebar-primary` is blue while the rest of the palette is warm-neutral. Apply it exactly as supplied. If a dark-mode review shows it conflicts with the desired Front-like feel, ask the user before changing the token—not after compensating with raw utility colors.
- Open product decision: should dark mode be exposed as a user setting now, or only supported by the token layer for a later preference? This plan implements correct `.dark` rendering but does not add persistence/toggle behavior without an approved preference model.
- Rules are deliberately a Settings section. The legacy `/rules` URL remains only as a redirect to `/settings?section=rules` for compatibility; it must not render a second management layout.
