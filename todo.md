# todo.md — work-in-flight tracker

Persistent task file so work survives session loss. Mirrors the live TaskList in the Claude Code session. Update by editing this file directly.

**Last updated**: 2026-05-18 morning (after first push)
**Branch**: `main`, 1 commit ahead of `origin/main` (the wake-up summary `4ebeee6`)

---

## In flight — Detailed 2-day regression review + page-by-page wiring trace

Triggered by user request: "review the entire site and compare to 2 days ago. I know we changed and used Vercel AI SDK but things should still be wired the same. I want a very detailed review. Go page by page, hit buttons or look for content that is missing."

### Phase A — Inventory what changed since 2026-05-16
- [ ] List every commit on `main` between 2026-05-16 and HEAD with stat counts
- [ ] Group commits by subsystem (backend services, frontend pages, infra, docs)
- [ ] Flag the AI-SDK migration commits explicitly (`2e74af1`, `f3e1aa1`, `7b37304`, `ab9b149`, `c64f4f1`)
- [ ] Build a "what could have broken" list from the diff shape

### Phase B — Vercel AI SDK migration wiring check
- [ ] For each Tier-1 service that migrated to `generateObject + Zod`, confirm:
  - [ ] The Zod schema in the service matches what the route handler expects
  - [ ] The route handler's response shape matches what the frontend expects
  - [ ] Error paths still return the right HTTP code + body
- [ ] For the 14 in-process workflows (`services/workflows/`), confirm each is invoked from a route + returns `null` cleanly on failure (backward-compat path)
- [ ] Trace the 5 raw-fetch → AI-SDK migrations from `ab9b149` to make sure callers handle the new return type

### Phase C — Page-by-page UI handler trace (68 pages)
For each page in `artifacts/inflexcvi/src/pages/`:
- [ ] List every `onClick` / `onSubmit` / mutation handler
- [ ] Trace each handler to its backend endpoint
- [ ] Verify the endpoint exists (we already did the path audit — 0 mismatches)
- [ ] Verify loading / error / empty states exist for the data the page renders
- [ ] Note any handler that posts to a route whose response shape may have shifted in the AI-SDK migration

### Phase D — Missing-content sweep
- [ ] Grep for `TODO`, `FIXME`, `XXX`, `HACK`, `Coming soon`, `Lorem`, `Placeholder` across `pages/` and `components/`
- [ ] Find `useState<X>([])` / `useState<X>(null)` that never get a `setX` call (orphan state)
- [ ] Find imported components that are never rendered in the file (dead imports)
- [ ] Find prop drilling where the prop is destructured but never used
- [ ] Find conditional renders gated on flags that never become true

### Phase E — Update artifacts
- [ ] Append findings to `mustfix.md` as Section 11 (regression review)
- [ ] Update this `todo.md` as items complete
- [ ] Commit at meaningful checkpoints so nothing is lost
- [ ] Final summary at end with commit list + pending decisions

---

## Pending decisions (from prior runs — not in this regression review's scope)

From mustfix.md Section 1:
- [ ] 1.1 — 9px chips in `cvi-dashboard.tsx` lines 1104/1111/1381: bump to 10px (table gets 10% taller) or hold for density?
- [ ] 1.2 — 15 `text-muted-foreground/70` callsites: introduce `--muted-foreground-soft` token at 50%/60% lightness, or leave at ~24.5% contrast?
- [ ] 1.4 — 10px mono metadata everywhere: bump to 11px or leave as editorial floor?
- [ ] 1.5 — `text-xs italic` empty-state pattern across 14 pages: promote to `text-sm` globally?
- [ ] developers.tsx:382 `/v1/cei/current` in API doc — intentional backward-compat alias or stale string?

From mustfix.md Section 11 (this regression review):
- [ ] 11.3.1 — `pages/dashboard.tsx` orphan: wire as `/dashboard` route, or delete the file?
- [ ] 11.3.2 — `pages/collaboration.tsx` dead code: apply 3-line cleanup (ChevronDown/Up imports + expandedComments state) as clear-win?

---

## Done

- [x] Site-wide API path audit (461 routes vs 73 fetches, **0 real mismatches**)
- [x] Per-page coverage map of all 68 pages (51 clean, 15 intentional-only, 2 documented)
- [x] Apply clear-win UI fixes (companies.tsx 9px Badge)
- [x] Update mustfix.md with Sections 7–10 + wake-up summary
- [x] User pushed 9 of 10 commits to `origin/main` (wake-up summary commit still local)
- [x] 2-day regression review — inventoried 41 commits / 489 files / +30,846/-4,782 lines
- [x] Vercel AI SDK migration wiring check — **CLEAN, zero issues**
- [x] Page-by-page handler trace — 67/68 wired correctly (1 orphan: dashboard.tsx)
- [x] Missing-content sweep — no placeholders, no TODOs, 2 dead-code findings only
- [x] Section 11 of mustfix.md written with all regression findings

---

## Resume instructions if this session crashes

1. `cd /home/runner/workspace`
2. Read this `todo.md` for state
3. Read `mustfix.md` (it has the wake-up summary at top + full audit)
4. Run `git log --oneline origin/main..HEAD` to see what's local-only
5. Run `git log --since="2026-05-16" --oneline` for the regression-review baseline
6. Resume at the first unchecked item in Phase A/B/C/D
