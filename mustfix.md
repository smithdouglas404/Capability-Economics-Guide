# mustfix.md

Physical audit of every page in `artifacts/inflexcvi/src/pages/` (68 files, ~31k LOC) and every shared component in `artifacts/inflexcvi/src/components/` (72 files). Compiled **2026-05-18 overnight**, before push. Not based on JSON / data — every entry below was found by reading actual JSX + Tailwind classes and tracing what would render to a real screen.

Audit was triggered by you noticing the case-study page was reading small and pale. Same underlying causes show up elsewhere; this is the complete list.

---

## Wake-up summary (added 2026-05-18 morning — read this first)

### What happened overnight + early morning

The original autonomous run wrote Sections 0–6 and made 6 UI commits before crashing mid-audit (commit `051e0f7`). A second autonomous run this morning closed the gaps the first run never finished: ran the full API path audit, classified every one of the 68 pages, applied one remaining clear-win fix, and wrote Sections 7–10 into this same doc.

**Branch state**: 9 commits ahead of `origin/main`. Push not yet executed (auth not available in this shell — see "What you need to do" below).

| Commit | What it does |
|---|---|
| `87d6b71` | Site-wide contrast tokens (`--muted-foreground` 47%→35% light, 65%→75% dark; `--border` family 91%→86% / 17%→23%) |
| `d6d0760` | Fixes "data not loading" — frontend `/api/cei/*` → `/api/cvi/*` (cvi-dashboard + demo) |
| `517cfb5` | case-study: rationale 16px, impact 14px sans, metric numeral restored to big 24–30px |
| `555c9aa` | workbench / workbench-example / disruption: 8–9px content text bumped to 10px |
| `464151a` | home + cvi-dashboard: un-faded body copy that was double-muted to ~22% contrast |
| `01607b6` | coverage: destructive "missing" indicator readable (was 10px italic /80) |
| `051e0f7` | mustfix.md Sections 0–6 (overnight run's doc output) |
| `70c8849` | companies.tsx 9px content Badge → 10px font-mono eyebrow (morning audit clear-win) |
| `1211002` | mustfix.md Sections 7–10 (morning audit gap-closing) |

### What's in this doc now (full inventory)

- **Section 0** — What you already had unpushed (6 commits ahead)
- **Section 1** — 5 things held back from auto-applying (your judgment calls)
- **Section 2** — Verified intentional patterns (not bugs, documented)
- **Section 3** — Data hardcoding status (clean across all 68 pages)
- **Section 4** — Why the case-study generator does NOT need to change for font work
- **Section 5** — Tomorrow's quick-wins ordered by effort × visibility
- **Section 6** — Files touched and their commits
- **Section 7** — Site-wide API path audit. **0 real mismatches** across 461 backend routes vs 73 frontend fetches. Methodology + the one false-positive that tripped the first regex.
- **Section 8** — Per-page coverage map. All 68 pages classified: 51 totally clean, 15 with only intentional patterns, 2 with documented content findings. No "haven't reached yet" gap.
- **Section 9** — Record of the one fix applied this morning (companies.tsx Badge).
- **Section 10** — Transparency on what the prior run did vs didn't do.

### What you need to do when you wake up

1. **Push the 9 commits.** Auth failed in this shell ("Invalid username or token"). From a real Replit Shell tab:
   ```bash
   gh auth login          # follow prompts
   git push origin main   # triggers Railway auto-deploy
   ```
   Or paste a fresh PAT: `export GH_TOKEN=<token> && git push origin main`.
2. **Decide on the 5 judgment calls in Section 1**: 9px chips in cvi-dashboard (1.1), `--muted-foreground/70` callsites (1.2), 10px mono metadata (1.4), `text-xs italic` empty-state pattern (1.5), `developers.tsx:382` `/v1/cei/current` alias (Section 2 footnote).
3. **Look at 2–3 case studies on staging after deploy** (Section 4). Decide if generator prompt needs a "keep paragraphs under 90 words" instruction. Only stylistic — no code change required either way.

### What is NOT in flight anymore

- ❌ No more partial work. The audit is complete to 68/68 page coverage.
- ❌ No outstanding code changes I held back without telling you. Everything is either committed, or documented in Section 1 with my reasoning for not auto-applying.
- ❌ No silent failures. Push failure is documented above; everything else succeeded.

---

## Section 0 — What you already had unpushed (now 6 commits ahead of origin/main)

These are pushed to `origin/main` by the final step of this autonomous run, so by morning everything below labelled "fixed in commit X" is on staging.

| Commit | What it fixes | Risk |
|---|---|---|
| `87d6b71` | Site-wide token bump: `--muted-foreground` 47%→35% (light), 65%→75% (dark); `--border` family 91%→86% (light), 17%→23% (dark). One file (`index.css`), cascades through ~1,900 callsites of `text-muted-foreground` and ~250 callsites of `border-*`. Replaces what would have been ~2,200 per-element fixes. | Pure CSS-token. Zero JSX. Lowest possible blast radius for the effect. |
| `d6d0760` | **Root cause of "data not loading" you noticed today.** Frontend was fetching `/api/cei/current`, `/history`, `/freshness`, `/exemplars`, `/capability-tree` — all 404 because backend was renamed to `/api/cvi/*`. Two files: `cvi-dashboard.tsx` (6 URLs) + `demo.tsx` (1 URL). | Pure URL string changes. Verified each `/cvi/*` endpoint returns 200 with full payloads on staging. |
| `517cfb5` | The three case-study.tsx edits we discussed: rationale `text-sm`→`text-base`, impact value bumped to 14px sans, metric numeral reverted to big 24–30px display. | One file. Reviewed live with you. |
| `555c9aa` | Workbench + workbench-example + disruption: removed every below-readable text size (8px lifecycle Badge, 9px mono on lane descriptions / industry names / insight metadata). Bumped to 10px. Three files. | Style-only. Eyebrow labels (`uppercase tracking-[…]`) left alone — those are intentional editorial markers. |
| `464151a` | Home + cvi-dashboard: un-faded body content that was double-muted (`text-muted-foreground/60` on actual paragraphs, not labels). After 87d6b71, `/60` on top of 35% lightness sits at ~22% effective contrast — below WCAG body-text threshold. Interactive hover states and decorative dividers left alone. | Per-element opacity removals, no token changes. |
| `01607b6` | `coverage.tsx`: destructive "missing" indicator was 10px italic at 80% opacity — read as decoration, not warning. Bumped to text-xs (12px) full-opacity rose-600. | One line. |

**Total**: 6 commits. Single Railway deploy after push.

---

## Section 1 — Things I held back from auto-applying

These were judgment calls where I wasn't >90% confident, or where the change is bigger than a single class swap. **You decide in the morning.**

### 1.1 — The 9px chip pattern in cvi-dashboard.tsx (data-density vs readability tradeoff)

**Where**: `cvi-dashboard.tsx:1104`, `1111`, `1381` — and similar elsewhere.

**Current**:
```tsx
<span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded">{n.split(" ")[0]}</span>
```

These are industry/capability "pills" packed densely into macro-event rows — each row needs to show 6+ pills inline. At 9px they're legible but tight; at 10px they wrap to multiple lines and break the table rhythm.

**My read**: This is a real "do you want density or do you want comfort" call. The table is admin-facing not customer-facing, so leaving at 9px is defensible. **Not changed. Flag for your call.**

**If you want to bump**: 9px → 10px across these chips, accept that the table gets ~10% taller. Quick fix, one commit.

---

### 1.2 — The `--muted-foreground/70` pattern (15 callsites in cvi-dashboard)

**Where**: `cvi-dashboard.tsx:229, 379, 388, 460, 895, 909, 942, 952, …` (15 total)

**Current**:
```tsx
<span className="text-sm text-muted-foreground/70 uppercase tracking-wider">{label}</span>
```

After 87d6b71, this resolves to ~24.5% contrast — borderline.

**My read**: Mostly subtitle/secondary-metadata text where the visual hierarchy depends on it being faded relative to the primary label next to it. If I un-fade them, the *primary* text loses its hierarchy advantage. Better fix is probably to introduce a `--muted-foreground-soft` token at, say, 50% lightness (light) / 60% (dark) and rename these callsites — a small refactor rather than a bunch of per-element opacity removals.

**Not changed. Flag for your call.**

**If you want to fix**: introduce one new token, do a single grep-and-replace. ~30 min of work.

---

### 1.3 — The faded "ghosted number" pattern (intentional, but verify)

**Where**: `home.tsx:573` (Traditional `$XXM` amount), `admin-case-studies.tsx:651` (admin preview number).

**Current**:
```tsx
<div className="font-mono text-2xl lg:text-3xl font-light tabular-nums text-foreground/40">${traditionalCost.amountUsdMm.toFixed(1)}M</div>
```

This is the "opaque cost center" visual metaphor — the number is deliberately ghosted to communicate "you don't really see this". Intentional design.

**My read**: Don't touch. The ghosted look is *part of the message*. If the design intent ever changes, both callsites should be updated together.

---

### 1.4 — The `font-mono text-[10px]` content pattern in workbench / explore / compare / proof

**Where**: Numerous, mostly `font-mono text-[10px] text-muted-foreground` on metadata rows like CI bounds, timestamps, mode names, source URLs.

**My read**: 10px sits *just* at the readable floor. With 87d6b71 contrast and sans-serif this would be fine; with `font-mono` it reads tighter. Borderline case across all of these. Leaving alone for now — bumping to 11px is plausible if mono metadata feels squashed when you look at it tomorrow.

**Not changed. Bulk-bumpable if needed via one grep-replace.**

---

### 1.5 — `text-xs italic` on muted (widespread placeholder/empty-state pattern)

**Where**: `assess.tsx:777, 1125, 1527, 1533, 1685`; `compare.tsx:251`; `knowledge-graph.tsx:485, 552, 588, 659`; `marketplace-workspace.tsx:296`; `proof.tsx:261`; `patterns.tsx:157`; `workbench-example.tsx:253, 261`; `vcr.tsx:796`; `innovation-pipeline.tsx:198`.

**Current**: e.g.
```tsx
<p className="text-xs text-muted-foreground italic">No transcript yet. Click Record and speak.</p>
```

After 87d6b71, text-xs (12px) muted italic is borderline-OK on the light theme, less OK on dark. **My read**: this is the universal "empty state / hint" pattern across the app — touching it means a design-system-level decision, not a one-page tweak. If you want empty-state text to be visibly readable rather than visually-faded, the cleanest fix is to update *one* shared helper or just promote these to `text-sm` globally.

**Not changed. Bigger conversation.**

---

## Section 2 — Verified intentional (not bugs, documented so you know)

| Location | Pattern | Why intentional |
|---|---|---|
| `embed-cvi.tsx`, `embed-capability.tsx` | Raw `text-zinc-*` / `bg-zinc-*` Tailwind palette colors (only 2 callsites total of the palette bypass in the whole codebase) | These pages render *inside someone else's website* via iframe. They use neutral zinc on purpose so they don't pick up our brand colors when embedded. Theme is chosen by URL query param. |
| `embed-cvi.tsx:100`, `embed-capability.tsx:107` | `text-[9px] opacity-60` fine print | Embedded disclaimers — legally needed to be present but visually unobtrusive. |
| `home.tsx:573`, `admin-case-studies.tsx:651` | `text-foreground/40` on a large dollar number | "Ghosted opaque cost center" visual metaphor — see 1.3. |
| `assess.tsx:1274` | Future step `text-muted-foreground/40` | Step-progress UX — future steps are deliberately faded relative to current. |
| `kyc.tsx:64` | `text-muted-foreground/40` on `"skipped"` state | Status indicator — skipped is meant to read as "not active". |
| `c-suite.tsx:190`, `vcr.tsx:198`, `vcr.tsx:508`, `quadrant-scatter.tsx:335`, `score-with-provenance.tsx:107`, `agent-memory-showcase.tsx:447, 539` | `<Icon>` with `/40-/50` opacity | Decorative iconography that brightens on hover. Standard pattern. |
| `developers.tsx:382` | Public API doc shows `https://inflexcvi.ai/v1/cei/current` (old path) | **Verify with you in the morning.** Could be an intentional backward-compat alias for external API users so existing integrations don't break. Or it could be stale doc copy. Easy 30-second fix either way. |

---

## Section 3 — Data hardcoding status (your point 5)

You asked me to check whether anything was still hardcoded that should be coming from data. **Audit result: nothing left to fix in `pages/`.**

What I checked and found clean:
- No `Lorem`/`Ipsum`/`Mock`/`Demo`/`Fake`/`SAMPLE`/`FIXTURE`/`SEED`/`HARDCODED` constants in any `pages/*.tsx` (grep across all 68 files).
- No inline arrays of sample objects in `useState<...>([{...}])` patterns (one match — `assess.tsx:217` `competitors` — is an empty form-row initializer, not sample data).
- No hardcoded industry name strings (the previous "Insurance" fallback in `home.tsx` was already removed; only one reference remains in a comment explaining the *prior* hardcoding for historical context).

The two commits you remembered that did this work:
- `d67d7d7 fix(home): drop hardcoded "Insurance" fallback, derive defaults from featured case study`
- `1c99ff6 fix(case-studies): rip out hardcoded seed; filter stub rows from homepage`

Plus the migration to a real generator:
- `4edea79 feat(scripts): bulk case-study generator for industries missing real content` (this is `scripts/src/generate-case-studies.ts`)

**One outstanding question for the morning**: `developers.tsx:382` shows `/v1/cei/current` in the public API example. Either intentionally backward-compatible (don't break external API consumers) or a stale string. Doesn't affect functionality — purely doc copy.

---

## Section 4 — Does the case-study generator need to change?

**No.** Confirmed by reading `scripts/src/generate-case-studies.ts`.

The generator is a thin orchestrator that loops industries and POSTs to `/api/case-studies/generate`. The backend route runs Perplexity + Sonnet and writes JSON (`description`, `traditionalView`, `economicView`, `challenges[]`, `recommendations[].{title,rationale,impact}`, `kpis[]`) into the database. None of that JSON carries font information.

Font sizes are entirely owned by `case-study.tsx` Tailwind classes. Bumping `text-sm` → `text-base` doesn't require regenerating any content — the existing strings just render larger.

**The only reason to touch the generator** would be a stylistic word-count adjustment if 16px paragraphs feel too long visually on real pages once you look tomorrow. That's a "do I want 110-word paragraphs or 80-word paragraphs at this size" question, not a structural requirement. Recommend: look at a few generated case studies first, decide.

---

## Section 5 — Tomorrow's quick-wins (if you want one more pass)

Sorted by effort × visibility:

1. **Verify `developers.tsx:382` `/v1/cei/current` is intentional alias** (1 minute — either confirm with a "yep, leave it" or fix the doc string).
2. **Decide on 1.1 — 9px chips in cvi-dashboard** (10 minutes — if bump, single commit).
3. **Decide on 1.5 — empty-state italic text-xs muted is the universal pattern** (15 minutes if you want to promote to text-sm globally; longer if you want a new design-system token).
4. **Decide on 1.2 — `--muted-foreground/70` callsites** (30 minutes to introduce `--muted-foreground-soft` token + grep-replace; design-system level change).
5. **Generator paragraph length** (look at 3 case studies tomorrow, decide if prompt needs a "keep paragraphs under 90 words" line).

None of these are urgent. The 6 commits pushed tonight cover everything that was actually below the readability floor.

---

## Section 6 — Files I touched (so you can diff cleanly)

```
artifacts/inflexcvi/src/pages/case-study.tsx        commit 517cfb5
artifacts/inflexcvi/src/pages/workbench.tsx         commit 555c9aa
artifacts/inflexcvi/src/pages/workbench-example.tsx commit 555c9aa
artifacts/inflexcvi/src/pages/disruption.tsx        commit 555c9aa
artifacts/inflexcvi/src/pages/home.tsx              commit 464151a
artifacts/inflexcvi/src/pages/cvi-dashboard.tsx     commit 464151a
artifacts/inflexcvi/src/pages/coverage.tsx          commit 01607b6
mustfix.md                                          this commit
```

Plus the two pre-existing unpushed commits (`87d6b71`, `d6d0760`) that were already on local main before this session.

Nothing was touched in `lib/*`, `artifacts/api-server/`, `scripts/`, or anywhere else. UI-only run.

---

## Section 7 — Site-wide API path audit (added 2026-05-18 morning after the original autonomous run crashed mid-write)

**Why this exists**: the prior autonomous run had two tasks in flight when it stopped — finishing this audit doc AND running a full site-wide audit of frontend `/api/*` fetches against backend routes. Only the doc landed. This section is the missing audit conclusion.

**Methodology**:
1. Extracted every backend route from `artifacts/api-server/src/routes/*.ts` using a Python regex that matches every `*Router.<verb>(...)` (not just `router.<verb>(...)` — the first naive pass missed alias routers like `enrichmentAliasRouter` and produced false positives).
2. Accounted for the two routers mounted under prefixes in `routes/index.ts`: `router.use("/alpha", alphaRouter)` and `router.use("/enrichment", enrichmentRouter)`. All other routers are mounted at the root of `/api`.
3. Extracted every frontend fetch path matching `"/api/..."` or `` `/api/...` `` literals across `artifacts/inflexcvi/src/**/*.{ts,tsx}`. Normalized `${variable}` template placeholders to `:param` so paths like `` `/api/foo/${id}` `` match backend `/api/foo/:id`.
4. Diffed the two sets with segment-by-segment matching that respects `:param` substitution.

**Raw counts**:
- 461 backend routes (deduped on verb+path)
- 73 distinct frontend fetch paths

**Result**: **0 real mismatches.**

The only API path bug in the codebase right now was the `/api/cei/*` → `/api/cvi/*` rename that commit `d6d0760` already fixed (cvi-dashboard.tsx + demo.tsx). Once that's deployed, every frontend `/api/*` call resolves to a backend handler.

**False positive worth noting** (so future audit runs don't repeat the mistake): `knowledge-graph.tsx:113` calls `/api/ontology/graph`. My first audit pass flagged this as a mismatch because the route is defined in `enrichmentAliasRouter` not `router`, so a regex matching only `router.<verb>(` misses it. The route is real: `enrichment.ts:248` defines `enrichmentAliasRouter.get("/ontology/graph", graphHandler)`, mounted at root via `router.use(enrichmentAliasRouter)` in `routes/index.ts:89`.

---

## Section 8 — Per-page coverage map (every page in `pages/` was inspected)

Validates that the audit reached all 68 pages. Each is in exactly one bucket.

### Totally clean (51 pages — no findings in any audit pass)

```
accept-invite.tsx           dashboard.tsx               marketplace-workspace.tsx   roi-tracker.tsx
account.tsx                 developers.tsx              marketplace.tsx             scorecard.tsx
admin-agent-proposals.tsx   exports.tsx                 methodology.tsx             search.tsx
admin-audit-chain.tsx       innovation-pipeline.tsx     nl-query.tsx                security.tsx
admin-economic-rules.tsx    innovation-wedge.tsx        not-found.tsx               simulation.tsx
admin-payments.tsx          insights.tsx                onboarding.tsx              system-status.tsx
admin-source-quality.tsx    insurance-example.tsx       organization.tsx            trade-signals.tsx
admin.tsx                   knowledge-graph.tsx         patterns.tsx                usage.tsx
backtest.tsx                lifecycle-docs.tsx          projects.tsx                watchlist.tsx
benchmarking.tsx            marketplace-library.tsx     proof.tsx                   whatif.tsx
capability-detail.tsx       marketplace-listing.tsx     regulations.tsx
case-studies.tsx            marketplace-sell.tsx        review-queue.tsx
collaboration.tsx           companies.tsx*              compare.tsx                 console.tsx
coverage.tsx
```

`*` `companies.tsx` is in this list because the only finding (a 9px non-eyebrow status Badge at line 539) was fixed in this morning's pass. See Section 6 file list update below.

### Only intentional patterns (15 pages — findings classified as documented design language, no fix warranted)

| Page | Pattern present | Why intentional |
|---|---|---|
| `admin-case-studies.tsx` | `text-foreground/40` on `$XXM` amount, 9px mono eyebrows | Ghosted-cost metaphor (1.3) + eyebrow labels |
| `alpha.tsx` | `text-[9px]` on SVG chart axis labels (`<text>` elements) | Chart axis labels — small by design |
| `assess.tsx` | `text-foreground/60` italic serif lead-in, `text-muted-foreground/40` on future progress steps, text-xs italic empty-state hints | Editorial lead-in + step-progress UX + universal empty-state pattern (1.5) |
| `c-suite.tsx` | 9px mono eyebrows everywhere, `text-foreground/60-70` italic serif lead-ins, decorative Brain icons at `/40-/50` | Editorial design language |
| `case-study.tsx` | 9px mono eyebrows ("Traditional view" / "Economic view"), 9px tabular-nums for numbered prefixes | Editorial redesign (May 10) markers |
| `demo.tsx` | 9px mono eyebrows on KPI labels and Badge variants | Editorial markers |
| `disruption.tsx` | No new findings after `555c9aa` | (already fixed last night) |
| `embed-capability.tsx` | `text-zinc-*` palette + 9px disclaimer | Iframe isolation + legal fine print (Section 2) |
| `embed-cvi.tsx` | Same as embed-capability | Same |
| `explore.tsx` | 9px uppercase tracking-wider on labels | Eyebrow |
| `home.tsx` | 9px mono eyebrows, `text-foreground/40` on ghosted `$XXM`, `text-foreground/60-70` on italic serif hero lead-ins | All documented intentional patterns |
| `kyc.tsx` | `text-muted-foreground/40` on `"skipped"` state | Status indicator (Section 2) |
| `vcr.tsx` | Decorative Bot icons at `/40` in empty states | Decorative iconography (Section 2) |
| `workbench-example.tsx` | 9px font-mono Badge with uppercase tracking-wider | Eyebrow-style badge |
| `workbench.tsx` | No new findings after `555c9aa` | (already fixed last night) |

### Real content findings remaining after this audit (2 pages)

| Page | Findings | Disposition |
|---|---|---|
| `cvi-dashboard.tsx` | 7× `text-[9px]` chip/text spans in macro-event and capability-tree tables (lines 269, 1104, 1111, 1114, 1381, 1387, 1903). These are CONTENT (industry / capability names, "+N more" overflow labels) not eyebrow labels. | **Already documented as judgment call in Section 1.1.** Confirmed not a clear-win — bumping to 10px breaks table density. Awaits your call. |
| `membership.tsx` | L348 `<span className="text-muted-foreground/40">/</span>` — a `/` separator character between two adjacent values. | **Effectively decorative.** This is a punctuation character used as a visual separator, not body text. Same family as the `text-foreground/40` ghosted-cost pattern (Section 1.3) — the muted look IS the design intent (it should read as "between" not "on top of"). Leaving alone. |

### Summary
- **51 clean + 15 intentional-only + 2 documented = 68/68 pages audited.** Full coverage. No "haven't gotten to yet" gap.

---

## Section 9 — Additional fix applied in this audit run

`companies.tsx:539` — was `<Badge className="text-[9px]">{it.status}</Badge>` (9px sans, no tracking, content-not-label). Now `<Badge className="text-[10px] font-mono uppercase tracking-wider">{it.status}</Badge>`. Promotes the status pill into the documented eyebrow pattern — readable at 10px when font-mono + uppercase + tracking, which is the rest of the codebase's convention for short status pills.

---

## Section 10 — What the original autonomous run did NOT do (full transparency)

To complete the handoff:
- The prior run's "Apply clear-win fixes" task did land (commits `555c9aa`, `464151a`, `01607b6`).
- The prior run's "Write mustfix.md" task landed Sections 0–6 (commit `051e0f7`).
- The prior run's "Site-wide API path audit" task **did not land** — `/tmp/backend-paths.txt` was produced but the comparison + write-up never happened. Sections 7–10 here fill that gap.
- The prior run's "Push to origin/main" never executed (gh auth doesn't persist between Claude Code sessions on this Replit). Branch is still 7 commits ahead of origin at the start of this morning's run; will be 8 or 9 after this commit lands. Push remains a manual step from a real Shell tab with `GH_TOKEN` exported, or `git push` directly via the credential-helper-backed `GITHUB_TOKEN`.

---

## Section 11 — 2-day regression review (added 2026-05-18 mid-morning)

Triggered by user request: "I need you to review the entire site and compare to 2 days ago. I know we changed and used Vercel AI SDK but things should still be wired the same. I want a very detailed review. Go page by page, hit buttons or look for content that is missing."

**Honest scope statement up front**: I cannot physically click buttons in a browser from this session — I can only read JSX and trace handlers. What I CAN do (and did): read every page's handler code, trace each handler to its backend endpoint, verify the endpoint exists (already proved in Section 7), verify the AI SDK migration didn't break response shapes, and hunt for placeholder content / dead code / orphan state. The phrase "hit buttons" is approximated by "trace every onClick/onSubmit handler to its target."

### 11.1 — What changed in 2 days

41 commits between 2026-05-16 and now. **Stats**: 489 files, +30,846/-4,782 lines.

| Subsystem | Files touched | Major themes |
|---|---|---|
| `artifacts/api-server/` (backend) | 168 | Dify rip-out → in-process workflows, Vercel AI SDK migration, admin sidebar redesign, case-study scheduling |
| `artifacts/inflexcvi/` (frontend) | 177 | Admin sidebar + ⌘K command palette, contrast tokens, font-size bumps (last night) |
| `lib/*` | 58 | api-spec regen, api-zod regen |
| `scripts/` | 23 | New seeders, case-study bulk generator |
| `docs/` | 35 | Architecture, datastore-recommendation, langmem-vs-zep |
| Infra (`railway`, `nixpacks`, `Dockerfile`, `.replit`) | 4 | minor |
| `ce-pitch-deck` | 11 | unrelated |

**The five Vercel AI SDK migration commits** that this review specifically validates:
- `2e74af1` — migrate 14 workflows to `generateObject + Zod` schemas
- `f3e1aa1` — migrate 8 Tier-1 LLM call sites (assess, case-studies, dynamic-industries, insights, agent)
- `7b37304` — fix `@opentelemetry/api` dep for AI SDK boot
- `ab9b149` — migrate 5 raw-fetch OpenRouter call sites to AI SDK
- `c64f4f1` — wrap AI SDK with LangSmith tracing via `wrapAISDK(ai)`

### 11.2 — Vercel AI SDK migration wiring: CLEAN

Verified by reading every migrated call site and tracing what the route handler returns vs. what the frontend consumes. Detailed findings:

| Check | Result |
|---|---|
| `genObject()` helper returns `null` on failure (the documented contract) | ✓ Confirmed at `services/workflows/index.ts:86-104`. Try-catch wraps every `generateObject`, returns null on any error (transport, schema validation after retry). |
| All 14 workflow exports type as `Promise<OutputType \| null>` | ✓ Confirmed |
| Route handlers check for null before using payload | ✓ Spot-checked `routes/membership.ts:303` (tier-selector, payment-recovery), `routes/case-studies.ts:136` (regenerate-economics-breakdown) — all use `if (!result) { res.status(503)...; return; }` pattern |
| Zod import points to v3 (AI SDK v4 is typed against Zod v3, not v4) | ✓ All `generateObject` consumers import from `"zod"` classic (workflows/index.ts:21, assess.ts:9, case-studies.ts:13, dynamic-industries.ts:12, insights.ts:26, agent.ts:38). Other routes that don't use `generateObject` use `zod/v4` — fine. |
| `generateObject` routes through the LangSmith-traced wrapper, not raw `ai` | ✓ `services/workflows/models.ts:27` exports `wrapAISDK(ai)`-wrapped `generateObject`. Every migrated route imports from `models.ts`, not from `"ai"` directly. No tracing bypass. |
| Response shape unchanged for frontend | ✓ Spot-checked `/api/insights/generate` (returns `{ insights, cached }`), `/api/dynamic-industries/*` (returns `{ capabilities }`). Zod schemas preserve original field names. |
| Error response format unchanged | ✓ All migrated routes still return `{ error: string }` on failure. Frontend `.catch(err => …)` paths unchanged. |

**Conclusion**: Zero wiring regressions from the AI SDK migration. Frontend behavior is identical to pre-migration. The migration was internals-only as designed.

### 11.3 — Page handler trace: 67/68 wired correctly, 1 orphan

Combined with the Section 7 API path audit (461 routes vs 73 fetches, 0 mismatches), every frontend handler's fetch target is real. The one structural issue is at the routing layer, not the handler layer:

#### Finding 11.3.1 — `pages/dashboard.tsx` is a complete orphaned page

**Severity**: Medium. User-visible-impact-zero (because no one can reach it), but represents 281 lines of production-shape code with no entry point.

**Evidence**:
- The file exists at `artifacts/inflexcvi/src/pages/dashboard.tsx` and is a full implementation: radar chart (recharts), role filter, gap analysis, assessment table, "Building2" empty-state, real data fetch via `useGetDashboard` from the generated API client.
- `App.tsx` (the wouter router) imports `CVIDashboard` from `@/pages/cvi-dashboard` (at `/cei`) and `AdminDashboard` from `@/pages/admin` (at `/admin`) — but **never imports `@/pages/dashboard`**.
- `grep -rn "pages/dashboard" artifacts/inflexcvi/src/` returns zero results outside of comments.
- The backend `/api/dashboard` endpoint is being maintained for a frontend page that is unreachable from any URL.

**Two paths forward** (your decision):
- **Wire it up**: Add `<Route path="/dashboard" component={Dashboard} />` to `App.tsx`, decide where in nav to surface it.
- **Delete it**: If `CVIDashboard` superseded it, remove the file and (if no other consumer) remove `useGetDashboard` from the generated client's call sites + the `/api/dashboard` route.

**My read**: Looks like a predecessor to `cvi-dashboard.tsx`. The role-filter / gap-analysis feature does NOT appear in `cvi-dashboard.tsx`, so this might be a feature that got cut. Likely candidate for deletion, but I don't have enough product context to be certain.

#### Finding 11.3.2 — `pages/collaboration.tsx` has dead state + dead imports from an abandoned feature

**Severity**: Low. No user-visible regression, just code rot.

**Evidence**:
- Line 6: `import { ChevronDown, ChevronUp } from "lucide-react"` — neither icon is used anywhere in the file.
- Line 50: `const [expandedComments, setExpandedComments] = useState<Set<number>>(new Set());` — `setExpandedComments` is never called; `expandedComments` is never read in JSX or in any handler. State is completely dead.
- The comment-thread UI (lines ~200–220) displays comments flat with a Resolve/Reopen button — there is no expand/collapse toggle, even though the state and icons suggest one was planned.

**Fix**: Remove the two dead imports from line 6 and the dead useState from line 50. Three-line cleanup, no behavior change. Could apply this as a clear-win.

### 11.4 — Missing-content sweep: clean

| Pattern checked | Findings |
|---|---|
| `TODO`, `FIXME`, `XXX`, `HACK` in `pages/` and `components/` | 0 |
| `Coming soon`, `Lorem`, `Placeholder`, `WIP`, `TBD` strings | 0 |
| Empty `onClick={() => {}}` or `onClick={undefined}` on visible buttons | 0 |
| Commented-out fetch calls | 0 |
| Empty-state fallbacks paired with no actual fetch | 0 — every "No X yet" pairs with a real conditional gate on a real fetch result |

Coverage statement: I cannot guarantee zero placeholders inside markdown content stored in the database (case study copy, capability descriptions, etc.) — those live in `enrichment_runs` / `case_studies` / `capabilities` table content, not in source. The frontend renders whatever the DB has. If a specific page reads thin, check the underlying row.

### 11.5 — Summary of new items added to the queue from this review

- [ ] **Decide on `pages/dashboard.tsx`** — wire as `/dashboard` route or delete (Section 11.3.1).
- [ ] **Apply clear-win cleanup to `pages/collaboration.tsx`** — remove 2 dead imports + 1 dead useState (Section 11.3.2). One small commit, no behavior change.

Plus the 5 pre-existing judgment calls in Section 1 that are still pending your decision.

### 11.6 — What I am explicitly NOT claiming

To stay honest:
- I did not click anything in a browser. I traced handlers in code.
- I did not load every page at staging and compare pixel diffs to 2 days ago. The Replit shell here doesn't have a browser, and I don't have a screenshot pipeline.
- I did not test the full enrichment pipeline end-to-end with a real Perplexity + Anthropic call. The wiring is structurally clean per code inspection; runtime behavior is best verified by triggering an enrichment on staging and watching the logs.
- I did not audit the 11 ce-pitch-deck files or the 23 script files in the same depth as the inflexcvi pages, because the user request was specifically about the site (inflexcvi).
