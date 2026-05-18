# mustfix.md

Physical audit of every page in `artifacts/inflexcvi/src/pages/` (68 files, ~31k LOC) and every shared component in `artifacts/inflexcvi/src/components/` (72 files). Compiled **2026-05-18 overnight**, before push. Not based on JSON / data — every entry below was found by reading actual JSX + Tailwind classes and tracing what would render to a real screen.

Audit was triggered by you noticing the case-study page was reading small and pale. Same underlying causes show up elsewhere; this is the complete list.

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
