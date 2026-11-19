# Fork enhancement roadmap: Agent Orchestrator

Status: Proposed — planning only, no feature code implemented
Repository: reannu123/agent-orchestrator
Base: fork's main branch, inspected 2026-11-20
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
- Switch machinery: backend/internal/service/chat/provider_switch.go, backend/internal/service/chat/usage_limit.go, backend/internal/service/agentaccounts/service.go. The fork's provider_switch.go interface differs from newer upstream versions: **work against this fork**, re-audit after upstream sync.
- Usage: backend/internal/domain/usage.go, backend/internal/domain/usage_report.go, backend/internal/service/usage/report.go, backend/internal/service/usage/summary.go, backend/internal/httpd/controllers/usage.go, backend/internal/observe/usage/, backend/internal/storage/sqlite/queries/usage.sql. Existing GET /api/v1/usage/report supports days, offset, tz, projectId and includes per-session projectId/harness/tokens/cost. GET /api/v1/usage/sessions provides compact session usage.
- Documentation and constraints: AGENTS.md, DESIGN.md, docs/architecture.md, docs/cloud-project-settings.md, CONTRIBUTING.md.

Important accounting caveat: the current usage report accumulates events into a UsageReportSession keyed by session ID, but the single harness field is initialized from its first event. A switched session may therefore have multiple provider harnesses while showing only one session-level harness. Do not derive precise historical per-provider usage from that single label.

The fork's docs stress avoiding changes to existing SQLite migrations, running isolated AO_DATA_DIR development instances, keeping status derived, and regenerating sqlc/OpenAPI outputs from sources rather than hand-editing generated files.

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

Global override does not mutate or erase per-project values. When disabled, project values immediately become effective for **future launches**. Running sessions are not transparently reconfigured. Make the effective source ("global", "project", "task", "default") visible in settings. Model/effort/mode/permission values must be validated against the chosen harness; no carrying incompatible model IDs to a fallback harness.

Use a daemon-backed host-scoped settings object and centralized resolver rather than implementing precedence only in React. Review all launch paths: New Task, worker spawn, orchestrator spawn/replacement, review spawn, CLI, and daemon automations. Cloud-only launches remain governed by Cloud contracts until an explicit integration is feasible.

### 3.3 Preferences versus project-domain facts

- Icons and group memberships are desktop/project presentation preferences with durable project IDs. Persist in the appropriate AO-managed local store under AO_DATA_DIR (SQLite preferred for shared daemon/mobile reads), not in Git repositories or imported project YAML.
- Groups are visual folders, not multi-repository workspaces. Re-grouping must never move repositories or worktrees.
- A project belongs to zero or one group initially; nested groups and cross-host/cloud sync are deferred. Unassigned projects appear in Ungrouped.
- Icon fallback priority: custom override -> existing avatar preference -> letter tile/folder.

### 3.4 Reliability and feature flags

- Default all new automatic behaviors OFF, especially exit confirmation and failover, until the user opts in. Pure visual features can appear when released.
- Failover policies must be durable, auditable, idempotent, restart-safe and bounded (no infinite loops).
- Do not automatically retry uncertain tool execution or prompt delivery; stop at a safe state and notify the user.
- Keep existing update/restart/shutdown paths working without modal deadlock.
- Preserve existing app auto-update boundaries for a privately built fork; do not publish via upstream release credentials.

## 4. Work packages and dependency order

The implementation sequence below is a proposed set of narrow PRs. Each PR should have its own branch, tests and screenshot/demo where appropriate. Do not combine unrelated work into one large agent task.

| PR | Work package | Depends on | Relative effort |
| --- | --- | --- | --- |
| P00 | Baseline audit, fixtures, scope decisions, isolated dev setup; record fork/upstream drift | None | S |
| P01 | Exit confirmation semantics and cross-platform close/quit routing | P00 | S-M |
| P02 | Project icon persistence, picker and fallback rendering | P00 | S-M |
| P03 | Explicit worker/session names and harness badges throughout sidebar | P00 | S |
| P04 | Project group schema, CRUD and ordering API | P00 | M |
| P05 | Grouped sidebar rendering, keyboard accessible drag/drop and persisted collapse | P04, P02 | M |
| P06 | Global role-default schema, resolver and launch-path integration | P00 | L |
| P07 | Agent Defaults settings UI, override indicators and validation | P06 | M |
| P08 | Usage attribution audit + per-project/session/role/harness aggregation API | P03 (identity), P00 | L |
| P09 | Sidebar usage summaries, date filters and detailed breakdown | P08, P05 | M |
| P10 | Failover policy, confirmed limit classification, eligibility/cooldown engine | P06, P00 | L |
| P11 | Safe switch/resume for Chat, then separately TUI and review-run integration where supported | P10, P08 | XL |
| P12 | Cross-feature regression, migrations, documentation, local fork packaging | All | M |

Suggested release waves:

- Wave A (early user value): P00-P03. Ship exit confirmation, icons and names.
- Wave B (organization): P04-P05. Ship project grouping.
- Wave C (policy foundation): P06-P07. Ship global defaults and override.
- Wave D (observability): P08-P09. Ship usage visibility *before* autonomous failover to aid debugging.
- Wave E (automation/hardening): P10-P12. Stage failover behind an opt-in toggle.

The sequencing permits P04 and P06 to run in parallel only when backend schema/DTO ownership is coordinated. Avoid simultaneous edits to the same migrations, generated API files, settings catalog or Sidebar.tsx.

## 5. Detailed feature specifications and acceptance tests

### F1. Exit confirmation

Implementation:
- Inventory all close paths: window X, app menu Quit, shortcuts, tray/menu bar, OS shutdown and update restart.
- Extend the existing quit confirmation controller and Electron main/renderer IPC; do not create competing dialogs.
- Offer Cancel, Quit Completely, and Keep Running/Hide when supported by the platform and actual process lifecycle. Explain clearly whether agent processes and daemon continue.
- Avoid double prompts with existing unsaved-draft guard; guard against duplicate close requests and repeated shortcuts.
- Exempt unattended OS shutdown/update restart or use the existing safe termination path so updates cannot deadlock. Support user-configurable enable/disable.

Acceptance:
- Cancel leaves window and running sessions unaffected.
- Quit closes exactly once, with no orphaned modal state.
- Close behavior is correct on Linux/Windows/macOS, with and without tray support.
- Unsaved drafts and app update paths retain expected protection.
- Electron main-process unit tests and desktop smoke coverage.

### F2. Automatic Claude/Codex usage-limit failover

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

### F3. Global Worker / Orchestrator / Reviewer defaults

Implementation:
- Introduce versioned durable settings and a service-level effective-config resolver with per-field source metadata.
- Store harness, model, effort, mode, permission defaults per role and optional global override flag.
- UI: Settings -> Agent Defaults, each role independently editable. Show whether project settings are overridden; offer a temporary project-specific/task choice and a Reset to inherited value action.
- Honor session explicit picks; existing project settings stay stored and are never mass-overwritten.
- Validate role capabilities and provider availability at actual launch, not only when UI saves.
- Keep local/remote hosts scoped and surface unsupported Cloud overrides rather than claiming global coverage.

Acceptance:
- Test all precedence permutations, including unset, override off, override on, explicit task choice, unsupported model/effort and per-role independence.
- New sessions launched from New Task, CLI, orchestrator and review workflows behave consistently.
- Existing live sessions do not silently switch on settings save.
- No project configuration bytes are altered merely by toggling global override.
- Schema upgrade/downgrade is non-destructive.

### F4. Custom project icons

Implementation:
- Define a small validated icon descriptor (kind: default, lucide, emoji; value; optional palette color). An optional custom remote image can be a future addition after security/privacy review.
- Render in the shared ProjectIcon component, sidebar, settings, project picker/command palette and relevant project views.
- Add accessible icon picker and reset action in project settings or context menu; preserve old project avatar toggle behavior when unset.
- Persist per stable project ID; custom icon selection must not change project repository data.

Acceptance:
- Icons survive app and daemon restarts and renaming.
- Invalid or removed icon names fall back safely.
- Emoji and icon alignment/accessibility remain correct across themes and zoom.
- Clearing overrides restores existing avatar/folder behavior.

### F5. Explicit worker names

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
- Backend CRUD and reorder methods; use SQLite migration, sqlc, API schemas and project-list read projection.
- Sidebar: collapsible groups, Ungrouped fallback, drag project between groups, reorder group and project, keyboard alternatives, visual drop targets. Reuse existing dnd-kit infrastructure without breaking session reordering.
- Persist expanded/collapsed state in host-scoped AO preferences. Define behavior on group deletion: projects become Ungrouped; never delete projects.
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
- Audit review-run ingestion; if reviewer usage is not linked to a project/run in current schema, implement that binding explicitly, mark history incomplete, and do not invent attribution.
- Ensure Claude subagents/Codex spawned children aren't double counted by preserving pipeline dedup/source identities.
- Sidebar: compact project total and small per-agent count on expanded rows, hover/detail breakdown for input/output/cache read/cache write/provider/model/estimated cost; today/7d/30d/90d filters (all-time requires its own aggregation contract); group totals sum member project totals once.
- Default to visible-but-subtle numbers; setting allows hide/off for performance/privacy. Refresh via existing change events or conservative polling while visible. Do not scan logs on every render.
- API-equivalent costs are estimates, not subscription bill or real marginal spend; show complete/partial/unavailable coverage, not misleading zero.

Acceptance:
- Project total equals sum of eligible unique event counts; group totals equal unique project totals, including after regrouping.
- Separate worker sessions using same model do not merge their usage accidentally.
- One session switching Claude -> Codex has correct per-provider historical attribution.
- Reviewer and orchestrator usage are either correctly attributed or clearly unavailable; no silent inference.
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
- Backward compatibility: existing rows have no icon/group/global override/failover policy; their behavior must match current app defaults until opt-in.

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
| Group/icon metadata lost on reimport | Stable IDs and reconciled membership, migration tests |
| App won't exit/restart after update | OS/update lifecycle bypass and end-to-end close tests |
| Upstream releases overwrite custom build | Separate fork build/artifact channel; audit updater configuration before installing |
| Fork diverges from upstream | Small PRs, audit upstream diffs before high-risk merges |
| GitHub Actions usage spike | Targeted local validation first, CI by changed area, no repeated broad E2E runs |

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

Start with P00 only:

> Read AGENTS.md, DESIGN.md, docs/architecture.md and this roadmap. Inspect the fork's exact main branch for any existing changes and mark each proposed work package as reuse/extend/new. Identify local-versus-Cloud boundaries, existing per-role execution paths, usage event identity, and provider-switch constraints. Produce a short ADR/design for configuration precedence, local metadata persistence and failover idempotency. Set up an isolated AO_DATA_DIR test fixture and draft a narrow P01 exit-confirmation implementation PR. Do not modify production data, merge to main, or implement P02-P12 as part of P00.

After P00, work through PRs in order, using independent orchestration tasks and explicit acceptance tests.