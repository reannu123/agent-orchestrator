# Fork enhancement roadmap: Agent Orchestrator

Status: Proposed — planning only, no feature code implemented. P00 verification complete (see "P00 verification findings"); decisions in "Approved decisions" are final.
Repository: reannu123/agent-orchestrator
Base: fork's main branch after the P00a fast-forward to upstream, `a47b9916660d3c8f9da2e9d6b5583d8f1c6630f0` (2026-11-20). Original inspection was at `7337d3fb3`.
Target: local/self-hosted desktop first; do not assume modifications to the private AO Cloud control plane are possible.

## 1. Outcome and scope

Deliver seven independently testable enhancements:

1. Optional confirmation before closing/quitting the desktop app, respecting running-agent semantics.
2. Automatic Claude Code <-> Codex failover for orchestrator, worker, and (where feasible) reviewer execution after **confirmed usage-limit exhaustion**; optionally switch to another eligible account of the same harness first.
3. Centralized Worker / Orchestrator / Reviewer agent defaults, with a global override of saved per-project settings.
4. Customizable project icons.
5. Explicit worker display names in the sidebar.
6. Collapsible and reorderable project groups.
7. Sidebar token usage and optional estimated cost, broken down by project, agent/session, role, harness, and model.

Success means behavior remains correct across restarts, project reloads, provider changes, and failed/partial attempts; existing project settings and sessions remain valid without destructive migration.

### Non-goals in this plan

- No autonomous coding in this planning PR.
- No changes to AO's private Cloud control plane, hosted billing, or upstream official releases.
- No token/account-limit bypass or changes to provider authorization or billing policy.
- No assertion that a Claude/Codex subscription's actual monetary charges equal model API-equivalent estimated cost.
- No guarantee of seamless raw native context transfer between different harnesses.
- Do not introduce a second independent token parser or provider-switch implementation.

## 2. Grounding in the fork (verified entry points)

The inspected fork contains:

- Desktop quit logic: frontend/src/main/quit-confirm.ts, frontend/src/main/desktop-quit.ts, frontend/src/main.ts, frontend/src/shared/shortcuts.ts. Present Cmd+Q confirmation is macOS/shortcut-specific and does not cover every window-close/quit path.
- Project presentation: frontend/src/renderer/components/ProjectIcon.tsx and frontend/src/renderer/components/Sidebar.tsx. Sidebar already uses dnd-kit for ordering. Project icons currently use repository avatars, letter tiles, or folders.
- Project agent roles and per-project fields: frontend/src/renderer/components/ProjectSettingsForm.tsx and ProjectSettingsEditor.tsx. Roles are worker, orchestrator, reviewer with per-role agent/model/effort/mode/permissions.
- Settings rendering: frontend/src/renderer/components/GlobalSettingsForm.tsx and frontend/src/renderer/components/settings/settingsCatalog.tsx (confirm catalog registration during implementation).
- Backend: backend/internal/service/, backend/internal/httpd/controllers/, backend/internal/domain/, and backend/internal/storage/sqlite/. Follow the existing Go daemon -> HTTP API -> generated TypeScript client -> Electron/React boundaries.
- Switch machinery: backend/internal/service/chat/provider_switch.go, backend/internal/service/chat/account_handoff.go, backend/internal/service/chat/usage_limit.go, backend/internal/service/agentaccounts/service.go, backend/internal/session_manager/interface_transition.go, backend/internal/session_manager/provider_switch_tui.go. (Earlier drafts said the fork's provider_switch.go differed from upstream; after the P00a sync the fork is identical to upstream, including the #8434 rework of provider_switch.go.)
- Usage: backend/internal/domain/usage.go, backend/internal/domain/usage_report.go, backend/internal/service/usage/report.go, backend/internal/service/usage/summary.go, backend/internal/httpd/controllers/usage.go, backend/internal/observe/usage/, backend/internal/storage/sqlite/queries/usage.sql. Existing GET /api/v1/usage/report supports days, offset, tz, projectId and includes per-session projectId/harness/tokens/cost. GET /api/v1/usage/sessions provides compact session usage.
- Documentation and constraints: AGENTS.md, DESIGN.md, docs/architecture.md, docs/cloud-project-settings.md, CONTRIBUTING.md.

Important accounting caveat: the current usage report accumulates events into a UsageReportSession keyed by session ID, but the single harness field is initialized from its first event. A switched session may therefore have multiple provider harnesses while showing only one session-level harness. Do not derive precise historical per-provider usage from that single label. (P00 narrowed this: the underlying `usage_bindings` rows are keyed per harness, so per-event attribution already exists; only the report's session-level label is lossy. See finding 8.)

The fork's docs stress avoiding changes to existing SQLite migrations, running isolated AO_DATA_DIR development instances, keeping status derived, and regenerating sqlc/OpenAPI outputs from sources rather than hand-editing generated files.

## P00 verification findings (2026-11-20)

Every claim below was checked against the synced main, `a47b99166`. Paths are repository-relative. Classification: **reuse** (works as is), **extend** (builds on existing machinery), **new** (no existing machinery).

1. **Fork drift.** Fork main was `7337d3fb3`, with 0 commits of its own. Upstream had 49 commits more at first inspection, and 52 when P00a pushed. P00a fast-forwarded fork main to `a47b99166` with no merge commit and no force-push. Relevant upstream commits now in main:
   - `ao session switch` with `--force` (#8434); this reworked `backend/internal/service/chat/provider_switch.go` and added `backend/internal/cli/session_switch.go`.
   - Mobile resume of usage-limited Chat turns (#8604).
   - Settings polling from one observer (#8620).
   - Sidebar working-title perf and session colours (#8639, #8703).
   - Reviewer override retirement and resolved reviewer model/effort (#6891, #8527).

   The sync also brought five new migrations (`20261022081903875`, `…084559932`, `20261116101450009`, `20261118180603285`, `20261119061500000`), all review/report related.

   **Policy:** sync main to upstream at every phase gate, before branching that phase's work.
2. **F1 Exit (extend).**
   - `frontend/src/main/quit-confirm.ts` only asks for the macOS ⌘Q shortcut. A mouse-chosen menu Quit, or a Quit with no visible shell, quits directly.
   - The tray is macOS-only: `isTrayEnabled` returns `platform === "darwin"` in `frontend/src/main/tray-lifecycle.ts`.
   - On Linux/Windows, closing the last window runs `window-all-closed` → `app.quit()` → `before-quit` → `shutdownDaemonForDesktopQuit()` in `frontend/src/main.ts`. That stops agents with no prompt.
   - Agent preservation already exists. `preserveAgentsOnQuit` in `frontend/src/main.ts` feeds `requestDesktopShutdown({ preserveAgents })` in `frontend/src/main/desktop-shutdown.ts`; update relaunch and the version-floor quit use it.
   - The renderer dialog `frontend/src/renderer/components/QuitConfirmDialog.tsx` exists, with a `keepsRunning` hint for the tray case. The Chat-draft guard in `before-quit` must keep working without a double prompt.
3. **F2 Failover (extend).**
   - Chat already hands off automatically to another account of the same provider at a usage limit. This is `backend/internal/service/chat/account_handoff.go`, behind the `AccountHandoff` setting in `backend/internal/service/settings/service.go`.
   - The handoff is durable through Session Manager interface transitions (`backend/internal/session_manager/interface_transition.go`; corrected path, not `service/session_manager`).
   - Chat auto-resumes at reset time (`backend/internal/service/chat/usage_limit.go`), now also from mobile (#8604).
   - Manual provider switch exists for Chat (`backend/internal/service/chat/provider_switch.go`) and TUI (`backend/internal/session_manager/provider_switch_tui.go`). The TUI switch starts a fresh native thread seeded with a handoff note.
   - Limits are classified by parsing known messages (`ParseConversationUsageLimit` in `backend/internal/domain/usage_limit.go`).
   - **Failover extends the existing handoff chain with a cross-provider step.** Each turn has a single recovery owner: account handoff, reset auto-resume and failover never all act on the same turn.
   - TUI limit detection is per adapter (`backend/internal/adapters/agent/claudecode/activity.go`, `backend/internal/adapters/agent/codex/turn_failures.go`) and needs an audit before TUI failover.
   - Reviewers get a fresh review run, not a mid-run switch.
4. **F3 Roles (extend + new).**
   - Project role overrides live in `backend/internal/domain/projectconfig.go`: `Worker` and `Orchestrator` are `RoleOverride`; `Reviewers` is `[]ReviewerConfig`.
   - Every spawn resolves through one chokepoint: `effectiveHarness` / `effectiveAgentConfig` in `backend/internal/session_manager/manager.go` (corrected path).
   - Reviewers resolve through `ProjectConfig.ResolveReviewerHarness` (`backend/internal/domain/projectconfig.go`), called from `backend/internal/review/review.go` and `backend/internal/autoreview/coordinator.go`.
   - The global `HarnessDefault` (`backend/internal/domain/harnessdefault.go`) only holds `DisabledModels`.
   - **Restore hazard (corrected detail):** `restoredAgentConfig` already pins model and effort from session metadata, and permissions when set. **Mode**, and permissions when unset, are still re-derived from the current project config on restore. Global defaults must therefore be resolved and persisted on the session at spawn, covering mode too, so a later global change never alters a restored session.
   - Needs a new daemon-side setting in `app_settings`, added by a new migration.
5. **F4 Icons (new, small).** `frontend/src/renderer/components/ProjectIcon.tsx` renders an owner avatar, a hashed-colour letter tile, or a folder. No persisted icon field exists.
6. **F5 Names (reuse + extend).**
   - Sessions have `DisplayName` + `DisplayNameExplicit` (`backend/internal/domain/session.go`), and rename UI exists (`useSessionRename` in `Sidebar.tsx`).
   - Provider switch keeps the same session row, so names persist.
   - The `SessionRow` in `frontend/src/renderer/components/Sidebar.tsx` shows the status dot, title and optional host badge. There is no harness or role badge.
   - Decision: no alias identity model; add role + harness badges and surface rename.
7. **F6 Groups (new).** Project order and pins live in renderer `localStorage` (`frontend/src/renderer/stores/sidebar-order-store.ts`), not SQLite.
8. **F7 Usage (extend + new).**
   - `usage_bindings` is `UNIQUE (session_id, harness, native_root_id)` (`backend/internal/storage/sqlite/migrations/0052_model_usage.sql`). Per-event harness attribution for switched sessions already exists; the caveat in section 2 only concerns the report's single session-level harness label.
   - Role can be derived from `sessions.kind` (`worker` | `orchestrator`; `backend/internal/domain/session.go`).
   - **Reviewer runs create no usage bindings.** Every `UpsertUsageBinding` call is in `backend/internal/service/usage/collector.go`, keyed by session. Reviewers appear only in the live-memory view (`backend/internal/service/usage/memory.go`). Reviewer token usage is currently unrecorded. Capturing it needs a migration that binds reviewer native sessions to review runs; historical reviewer usage must display as unavailable.
   - No all-time aggregate exists. Existing endpoints are `GET /api/v1/usage/report` and `GET /api/v1/usage/sessions` (`backend/internal/httpd/controllers/usage.go`, `backend/internal/httpd/apispec/specgen/build.go`).

### Approved decisions (final)

- Fast-forward main to upstream before feature work. Done in P00a.
- Project icons and groups persist in desktop renderer local storage, alongside the existing project order and pins. No migration; not shared with mobile/CLI. Revisit only if mobile parity is requested.
- Exit confirmation defaults **ON**, and the user can disable it in Settings. Options:
  - **Cancel.**
  - **Quit completely**, which stops agents.
  - **Keep agents running.** On macOS this hides to the tray. On Linux/Windows it quits the app but preserves agents for re-adoption on next launch, with explicit wording that supervision pauses until AO is reopened.

  Update restart and OS shutdown bypass the prompt.
- Config precedence for **new** launches: explicit task/session pick > global role setting (when override is on) > project role setting > app default. Resolved values are persisted on the session at spawn.
- No new worker alias model.
- Only one migration / API-regeneration change is in flight at a time.

## 3. Foundational decisions

### 3.1 Identity and scope

- ProjectId is canonical for projects. Preserve project identity if a path, icon, name, or grouping changes.
- SessionId is canonical for a worker/orchestrator session. A display name is presentation, not a new identity.
- Distinguish role (worker / orchestrator / reviewer) from harness (claude-code / codex), account, model and native subagent.
- A reviewer run might not be represented as an ordinary worker session; inspect the reviewer storage/run associations before defining reviewer-level usage.
- Persist native event provenance and coverage; never invent zeros for missing token counters.

### 3.2 Configuration precedence

For **newly launched** sessions, resolve effective role settings explicitly:

1. Explicit per-task/per-launch user selection (unless a future product decision requires a forced policy).
2. Global role setting for that field, when global override is enabled and a value is set.
3. Project role setting.
4. Existing application/agent default.

The resolved harness, model, effort, mode and permissions are persisted on the session at spawn. Restore and replacement read those persisted values and never re-resolve against current global or project settings (see finding 4).

Global override does not mutate or erase per-project values. When disabled, project values immediately become effective for **future launches**. Running sessions are not transparently reconfigured. Make the effective source ("global", "project", "task", "default") visible in settings. Model/effort/mode/permission values must be validated against the chosen harness; no carrying incompatible model IDs to a fallback harness.

Use a daemon-backed host-scoped settings object and centralized resolver rather than implementing precedence only in React. Review all launch paths: New Task, worker spawn, orchestrator spawn/replacement, review spawn, CLI, and daemon automations. Cloud-only launches remain governed by Cloud contracts until an explicit integration is feasible.

### 3.3 Preferences versus project-domain facts

- Icons and group memberships are desktop presentation preferences keyed by durable project IDs. **Decision (P00):** persist them in desktop renderer local storage next to the existing project order and pins (`sidebar-order-store.ts`), never in Git repositories or imported project YAML. They are not shared with mobile/CLI; move them to SQLite only if mobile parity is requested.
- Groups are visual folders, not multi-repository workspaces. Re-grouping must never move repositories or worktrees.
- A project belongs to zero or one group initially; nested groups and cross-host/cloud sync are deferred. Unassigned projects appear in Ungrouped.
- Icon fallback priority: custom override -> existing avatar preference -> letter tile/folder.

### 3.4 Reliability and feature flags

- Default new automatic behaviors OFF, especially failover, until the user opts in. Exception (P00 decision): exit confirmation defaults ON with a Settings toggle, because silently stopping agents on Linux/Windows window close is the riskier default. Pure visual features can appear when released.
- Failover policies must be durable, auditable, idempotent, restart-safe and bounded (no infinite loops).
- Do not automatically retry uncertain tool execution or prompt delivery; stop at a safe state and notify the user.
- Keep existing update/restart/shutdown paths working without modal deadlock.
- Preserve existing app auto-update boundaries for a privately built fork; do not publish via upstream release credentials.

## 4. Work packages and dependency order

The implementation sequence below is a proposed set of narrow PRs. Each PR should have its own branch, tests and screenshot/demo where appropriate. Do not combine unrelated work into one large agent task.

| PR | Work package | Depends on | Migration / API regen | Relative effort |
| --- | --- | --- | --- | --- |
| P00 | Verification milestone: audit, scope decisions, record fork/upstream drift (this document) | None | No | S |
| P00a | Fast-forward fork main to upstream (done: `a47b99166`) | None | No | S |
| P00b | Record P00 verification findings and revised breakdown in this roadmap | P00a | No | S |
| A1 | Exit confirmation on all platforms: Cancel / Quit completely / Keep agents running; default ON with Settings toggle; update restart and OS shutdown bypass | P00b | No | S-M |
| A2 | Sidebar session role + harness badges and a visible rename affordance (reuse DisplayName) | P00b | No | S |
| A3 | Custom project icons in renderer local storage; picker, reset and fallback rendering | A2 (both touch Sidebar.tsx) | No | S-M |
| B1 | Project groups in renderer local storage: collapsible, reorderable, keyboard accessible, persisted collapse | A3 | No | M |
| C1 | Global role defaults backend: `app_settings` migration, resolver at the spawn chokepoint, persist resolved config at spawn, reviewer path | P00b; may run in parallel with B1 | Yes | L |
| C2 | Agent Defaults settings UI, effective-source indicators, validation | C1 | API regen only if C1 did not cover it | M |
| D1 | Batched usage aggregate endpoint (per project/session/role/harness/model, date windows) | P00b | API regen, no migration | M-L |
| D2 | Reviewer usage capture: migration binding reviewer native sessions to review runs; pre-D2 history marked unavailable | C1 (migration serialization), D1 | Yes | M |
| D3 | Sidebar usage UI: project totals, per-session counts, breakdown popover, filters | D1, B1; reviewer rows after D2 | No | M |
| E1 | Chat cross-provider failover as an extra step in the existing account-handoff chain; single recovery owner per turn | C1, D1 | Likely (attempt record) | L |
| E2 | TUI usage-limit detection audit (claudecode/activity.go, codex/turn_failures.go), then TUI failover only if provably safe | E1 | Possibly | L-XL |
| E3 | Cross-feature regression, docs, local fork packaging | All | No | M |

Release phases:

- Phase A (early user value): A1-A3. Exit confirmation, sidebar badges/rename, project icons.
- Phase B (organization): B1. Project groups.
- Phase C (policy foundation): C1-C2. Global role defaults and override.
- Phase D (observability): D1-D3. Usage visibility *before* autonomous failover, to aid debugging.
- Phase E (automation/hardening): E1-E3. Failover behind an opt-in toggle.

Sync fork main to upstream at every phase gate. Only one migration or API-regeneration change is in flight at a time (C1, D1, D2, E1 serialize on this). A2, A3, B1 and D3 all touch Sidebar.tsx and must not overlap. C1 may run in parallel with B1 because B1 has no backend change.

## 5. Detailed feature specifications and acceptance tests

### F1. Exit confirmation

Implementation:
- Inventory all close paths: window X, app menu Quit, shortcuts, tray/menu bar, OS shutdown and update restart.
- Extend the existing quit confirmation controller and Electron main/renderer IPC; do not create competing dialogs.
- Offer Cancel, Quit completely (stops agents), and Keep agents running. On macOS, Keep agents running hides to the tray. On Linux/Windows it quits the app with `preserveAgentsOnQuit` set, so agents stay adoptable on next launch; the dialog must say supervision pauses until AO is reopened. Cover the Linux/Windows `window-all-closed` → `app.quit()` path, which today stops agents with no prompt (finding 2).
- Avoid double prompts with existing unsaved-draft guard; guard against duplicate close requests and repeated shortcuts.
- Update restart and OS shutdown bypass the prompt, using the existing safe termination path so updates cannot deadlock. Default ON; users can disable it in Settings.

Acceptance:
- Cancel leaves window and running sessions unaffected.
- Quit closes exactly once, with no orphaned modal state.
- Close behavior is correct on Linux/Windows/macOS, with and without tray support.
- Unsaved drafts and app update paths retain expected protection.
- Electron main-process unit tests and desktop smoke coverage.
- Linux: closing the last window prompts; Keep agents running leaves agents running and adoptable by the next launch.

### F2. Automatic Claude/Codex usage-limit failover

Classification (P00): **extend**. Add a cross-provider step to the existing chain: `chat/account_handoff.go`, `session_manager/interface_transition.go`, `chat/usage_limit.go` and `chat/provider_switch.go` / `session_manager/provider_switch_tui.go`. Do not build a parallel switch path. Reviewers get a fresh review run rather than a mid-run switch.

Implementation:
- Add an opt-in per-role policy inheriting from global role defaults: OFF, account-first then cross-harness, or cross-harness only; ordered eligible targets and optionally model mapping.
- Consume structured usage-limit failure information and known cooldown/reset data where supported. Do not react to generic HTTP 429, network errors, authentication failures, unclear capacity windows, or malformed notifications as if they proved subscription exhaustion.
- Optional same-harness account rotation uses existing account service/eligibility. Never bypass provider policy, switch into unauthenticated accounts, or change unrelated session credentials.
- Determine target capabilities before switching: installed, authenticated, model/permission/feature compatibility, active limits, CLI vs Chat driver support.
- Make a durable attempt record keyed by source session + failed turn/run + failure generation. Bound attempts, set cooldown and enforce one switch/resume at a time per session.
- For Chat, reuse native provider-switch and handoff-note machinery. Preserve AO session and worktree; carry an explicit bounded context/continuation note. Retry only a known-undelivered actionable prompt. Refuse ambiguous partially executed turns rather than re-running tools.
- For TUI, audit whether hooks can prove a terminal limit refusal and a safe boundary; use existing TUI switch controller, never blindly keystroke a resumed agent.
- For orchestrator sessions, preserve role and supervision metadata. For reviewer runs, determine whether in-flight reviews may restart safely or should require a new review invocation. Document any initially unsupported case clearly.
- Surface switch reason, source/target, account (without secrets), outcome, next retry availability and manual override in the UI.
- Integrate, do not race, existing quota-reset auto-resume logic; the same failed turn must not be scheduled for both fallback and old-harness auto-resume.

Acceptance:
- Claude quota exhaustion can safely hand off an eligible, idle/failed Chat turn to Codex; inverse direction works.
- Known account-first fallback runs once before cross-provider failover when enabled.
- Both providers exhausted produces a stable blocked/needs-action state, not a loop.
- Auth failure, transient 429, network errors and unknown failure classifications do not initiate cross-provider switching.
- Worktree, project, task identity and role survive handoff; incompatible permissions/models fail visibly.
- Concurrent tabs, daemon restart, late provider events and duplicate errors do not cause duplicate work.
- Explicit matrix for Chat, Terminal, orchestrator and reviewer capabilities with unsupported cells documented.
- Deterministic Go tests with fake adapters, quota fixtures, races and restart recovery; no live provider calls in unit tests.
- A test proves account handoff, reset auto-resume and failover never act on the same turn.

### F3. Global Worker / Orchestrator / Reviewer defaults

Classification (P00): **extend + new**. Extend the spawn chokepoint (`effectiveHarness` / `effectiveAgentConfig` in `backend/internal/session_manager/manager.go`) and `ResolveReviewerHarness`; add a new daemon-side role-defaults setting in `app_settings` via a new migration.

Implementation:
- Introduce versioned durable settings and a service-level effective-config resolver with per-field source metadata.
- Store harness, model, effort, mode, permission defaults per role and optional global override flag.
- UI: Settings -> Agent Defaults, each role independently editable. Show whether project settings are overridden; offer a temporary project-specific/task choice and a Reset to inherited value action.
- Honor session explicit picks; existing project settings stay stored and are never mass-overwritten.
- Persist the resolved harness, model, effort, mode and permissions on the session at spawn. `restoredAgentConfig` must stop re-deriving mode (and unset permissions) from current settings.
- Validate role capabilities and provider availability at actual launch, not only when UI saves.
- Keep local/remote hosts scoped and surface unsupported Cloud overrides rather than claiming global coverage.

Acceptance:
- Test all precedence permutations, including unset, override off, override on, explicit task choice, unsupported model/effort and per-role independence.
- New sessions launched from New Task, CLI, orchestrator and review workflows behave consistently.
- Existing live sessions do not silently switch on settings save.
- Restored sessions keep their spawn-time config after global defaults or project role settings change.
- No project configuration bytes are altered merely by toggling global override.
- Schema upgrade/downgrade is non-destructive.

### F4. Custom project icons

Implementation:
- Define a small validated icon descriptor (kind: default, lucide, emoji; value; optional palette color). An optional custom remote image can be a future addition after security/privacy review.
- Render in the shared ProjectIcon component, sidebar, settings, project picker/command palette and relevant project views.
- Add accessible icon picker and reset action in project settings or context menu; preserve old project avatar toggle behavior when unset.
- Persist per stable project ID in desktop renderer local storage, alongside project order and pins (approved decision). Custom icon selection must not change project repository data. Not shared with mobile/CLI.

Acceptance:
- Icons survive app and daemon restarts and renaming. Loss on a desktop data reset is accepted and documented.
- Invalid or removed icon names fall back safely.
- Emoji and icon alignment/accessibility remain correct across themes and zoom.
- Clearing overrides restores existing avatar/folder behavior.

### F5. Explicit worker names

Classification (P00): **reuse + extend**. `DisplayName` / `DisplayNameExplicit` and `useSessionRename` exist; `SessionRow` lacks role and harness badges. No new alias model (approved decision).

Implementation:
- Reuse existing session displayName/rename functionality. First iteration displays an explicit worker/session title, a role label, and current harness badge, rather than inventing new worker identity.
- Clarify terminology in UI: e.g., "Worker · Fix auth redirect" + "Codex". Display orchestrators/reviewers distinctly where their row type supports it.
- If persistent personality-style aliases independent of sessions are needed, add a separate alias schema only after this iteration is validated.
- Preserve names and role under Claude/Codex switching.

Acceptance:
- User can identify each worker even when multiple workers use the same harness.
- Rename updates sidebar/search/task view consistently; long names truncate with tooltip.
- Provider switch does not reset the display name.

### F6. Project grouping

Implementation:
- New group entity: immutable ID, display name, sort order, optional icon/color, updatedAt; project-group membership keyed by stable project ID.
- Persist groups and membership in desktop renderer local storage next to `sidebar-order-store.ts` (approved decision). No backend CRUD, migration or API change; not shared with mobile/CLI. Projects missing from storage fall back to Ungrouped.
- Sidebar: collapsible groups, Ungrouped fallback, drag project between groups, reorder group and project, keyboard alternatives, visual drop targets. Reuse existing dnd-kit infrastructure without breaking session reordering.
- Persist expanded/collapsed state in the same renderer local storage. Define behavior on group deletion: projects become Ungrouped; never delete projects.
- Make explicit that UI groups do not change Git worktree hierarchy or AO Workspace kind.

Acceptance:
- Create, rename, move, delete group; reorder within/between groups; reload persists results.
- Group deletion or project archive leaves valid memberships and no data loss.
- Keyboard navigation, drag cancellation and move undo affordances work.
- Project/session rows remain navigable and performant with many projects.
- Initial scope local projects; cross-host and Cloud placement must not silently mix unrelated IDs.

### F7. Token and estimated-cost analytics in sidebar

Implementation:
- First reuse existing normalized usage events, native source bindings, report endpoints and pricing. No parallel transcript parsing.
- Introduce an optimized batched project summary query (rather than N requests for N projects). Group by stable project ID, session ID, role/run ID where trustworthy, per-event binding harness and model, time bucket. Maintain source coverage/unknown counters.
- Distinguish session cumulative tokens from current context-window fill. Never add current context usage into lifetime token counts.
- Handle provider switches as multiple event harnesses for a single session; avoid relying on UsageReportSession.Harness as proof of all consumed providers.
- Reviewer runs create no usage bindings today (finding 8). D2 adds a migration binding reviewer native sessions to review runs. Usage from before D2 displays as unavailable; never infer it.
- No all-time aggregate exists; D1 adds the batched aggregate endpoint without a migration, next to `/api/v1/usage/report` and `/api/v1/usage/sessions`.
- Ensure Claude subagents/Codex spawned children aren't double counted by preserving pipeline dedup/source identities.
- Sidebar: compact project total and small per-agent count on expanded rows, hover/detail breakdown for input/output/cache read/cache write/provider/model/estimated cost; today/7d/30d/90d filters (all-time requires its own aggregation contract); group totals sum member project totals once.
- Default to visible-but-subtle numbers; setting allows hide/off for performance/privacy. Refresh via existing change events or conservative polling while visible. Do not scan logs on every render.
- API-equivalent costs are estimates, not subscription bill or real marginal spend; show complete/partial/unavailable coverage, not misleading zero.

Acceptance:
- Project total equals sum of eligible unique event counts; group totals equal unique project totals, including after regrouping.
- Separate worker sessions using same model do not merge their usage accidentally.
- One session switching Claude -> Codex has correct per-provider historical attribution.
- Reviewer and orchestrator usage are either correctly attributed or clearly unavailable; no silent inference.
- Reviewer usage appears for runs after D2; reviewer usage from before D2 is marked unavailable.
- Missing native usage counters produce partial/unavailable coverage.
- Tests cover cached token accounting, multi-provider switches, subagents, late log discovery, missing model pricing and partial event ingestion.
- Sidebar remains responsive with dozens of sessions/projects; backend does aggregation, frontend caches batched result.

## 6. API, storage and migration checklist

Before implementation PRs:
- Record design proposals for settings, icons, groups, role/run attribution and failover attempts. Avoid a generic catch-all JSON blob if structured queries, migrations or validation need stable fields.
- Add migrations only; never rewrite shipped migrations. Respect fork's migration-create and burned-version test instructions.
- Change sqlc source queries and regenerate, not generated Go files by hand.
- Introduce controllers/DTOs with code-first OpenAPI, run npm run api, and update typed frontend hooks.
- Use daemon-side validation and access control for settings, group mutators and failover triggers.
- Ensure CDC/watch invalidation works across windows/hosts using existing SQLite change-log semantics.
- Backward compatibility: existing rows have no icon/group/global override/failover policy; their behavior must match current app defaults until opt-in. The one deliberate default change is exit confirmation, which defaults ON (approved decision).
- Only one migration / API-regeneration change in flight at a time. Re-check the latest migration version after every upstream sync before adding one.

## 7. Testing and developer workflow

- Prefer local targeted Go tests and Vitest during each PR; don't run expensive full Electron E2E suites for every small change.
- Use isolated worktrees and AO_DATA_DIR for testing, never real ~/.ao or live worktrees.
- Test with synthetic Claude/Codex quota errors and synthetic token transcripts; do not require paid accounts for CI.
- CI groups: Electron main/IPC unit tests; React component tests + keyboard/drag tests; Go service/store/API tests; API schema generation check; SQLite migration-up tests; integration tests for provider handoff and daemon recovery.
- Run frontend typecheck, targeted backend Go tests, and build/check relevant code locally before marking a PR ready. Run full Linux suite and a narrow desktop smoke at phase gates, plus Windows/macOS smoke for quit/process behavior when those environments are available.
- Capture before/after screenshots with the repo's design guidance; avoid placing unnecessary production telemetry or secrets in logs.
- Keep branches reviewable; avoid stacked PRs modifying the same Sidebar.tsx, settings catalog, DTOs or generated schema at once.
- Keep the fork synchronized with upstream using deliberate merges/cherry-picks; evaluate upstream changes to usage and provider switching before each high-risk wave. Never force-sync over local implementation commits.

## 8. Risks and mitigations

| Risk | Mitigation / release gate |
| --- | --- |
| Provider switch runs same prompt/tools twice | Source-turn idempotency, settled outcome check, no retry when execution is uncertain |
| Context continuity lost across Claude/Codex | Existing handoff protocol + explicit bounded task/worktree summary; warn if incomplete |
| Auto-resume and auto-failover compete | One durable recovery owner per failed turn; tests for conflicting schedules |
| Account readiness/quotas stale | Fresh eligibility probe with conservative fallback; no repeated churn |
| Usage appears more precise than provider reports | Coverage and provenance metadata; never fabricate missing counters |
| Reviewer usage attributed to worker incorrectly | Explicit run/role binding or label unavailable |
| Global settings silently overwrite project state | Read-time resolver; non-destructive per-project config preservation |
| Group/icon metadata lost on reimport | Stable project IDs as local-storage keys; unknown IDs fall back to Ungrouped/default icon |
| App won't exit/restart after update | OS/update lifecycle bypass and end-to-end close tests |
| Upstream releases overwrite custom build | Separate fork build/artifact channel; audit updater configuration before installing |
| Fork diverges from upstream | Small PRs, audit upstream diffs before high-risk merges |
| GitHub Actions usage spike | Targeted local validation first, CI by changed area, no repeated broad E2E runs |
| Migration registry conflicts on upstream sync (P00a alone brought five new migrations) | Sync at every phase gate; one migration change in flight; regenerate the migration version after each sync, before merge |
| Linux/Windows "Keep agents running" misread as full supervision | Dialog wording states supervision pauses until AO reopens; agents are re-adopted on next launch; covered by the A1 acceptance tests |
| Global defaults leaking into restored sessions | Persist resolved config (including mode) at spawn; restore reads only persisted values; regression test |
| Failover races account handoff or reset auto-resume | Single recovery owner per turn; test proving the three never act on the same turn |
| Icons/groups lost when desktop local storage is reset | Accepted trade-off of local-storage persistence; documented; revisit with SQLite if mobile parity is requested |

## 9. Definition of done

Each feature PR must include: a short design note or updated entry here; app-facing UI/API implementation as necessary; focused unit/integration tests; migration and rollback/recovery considerations; visual/demo evidence when user-facing; release notes; and clearly documented unsupported Cloud/Terminal/reviewer cases.

Whole-project exit criteria:
- All seven features function on the local desktop build and survive restart.
- Default migration leaves legacy user behavior unchanged.
- User can enable/disable global role overrides and failover independently.
- Token totals never silently double count or assert unknown coverage as exact.
- Failover cannot execute the same user request twice from ambiguous recovery.
- Test/fork packaging path is documented, and no official upstream publishing credentials are used.

## 10. Immediate next task for Orchestrator workers

P00 (verification), P00a (upstream sync) and P00b (this revision) are complete. Next:

> Start Phase A with A1 (exit confirmation on all platforms) per F1 and the approved decisions. A2 can run in parallel with A1. A3 starts after A2 merges, because both touch Sidebar.tsx. Branch from the synced main, use an isolated AO_DATA_DIR, and do not merge to main without approval.

C1 may start in parallel with B1 once Phase A is merged. Sync main to upstream at every phase gate.

## Revision log

- **2026-11-20, initial draft.** Seven features, P00-P12 work packages, inspected at fork main `7337d3fb3`.
- **2026-11-20, P00 revision.**
  - P00a fast-forwarded fork main to upstream `a47b99166` (52 commits; the draft said 49, upstream moved during review). The roadmap now targets the synced main.
  - Added "P00 verification findings" (reuse/extend/new per feature, with cited paths) and "Approved decisions".
  - Replaced the P01-P12 table with phases A-E (A1-A3, B1, C1-C2, D1-D3, E1-E3). The change follows the findings: failover extends existing account handoff; icons and groups need no backend; reviewer usage needs its own migration; migrations and API regeneration are serialized.
  - Switched icon/group persistence from SQLite to renderer local storage (approved decision).
  - Changed the exit-confirmation default from OFF to ON, because on Linux/Windows closing the window stops agents with no prompt today.
  - Narrowed the usage caveat: per-event harness attribution already exists in `usage_bindings`.
  - Corrected paths from the P00 brief: `backend/internal/session_manager/` (not `service/session_manager`), and `requestDesktopShutdown` in `frontend/src/main/desktop-shutdown.ts`.
  - Refined the restore hazard: model/effort are already pinned; mode and unset permissions are not.
  - Dropped the "fork provider_switch.go differs from upstream" caveat; the sync resolved it.
  - Added acceptance criteria and risks for Linux keep-running, restore stability, reviewer usage, and handoff/failover exclusivity.
