# Capability Economics — Foundry Ontology Spec

**Stack:** `https://ssg.usw-17.palantirfoundry.com`
**Ontology:** `dsmith@smithfamilyusa.com Ontology` (`ri.ontology.main.ontology.84e2e319-c566-4304-a12a-8dbb05224f4f`)
**Project:** `Capability Economics` (`ri.compass.main.folder.0b7baf38-d7f4-4413-aa27-962236f947d2`)

This is the field-by-field reference for creating Object Types in the Foundry UI. Each Object Type is backed by one Dataset that's snapshot-synced from Postgres every hour (and on every successful enrichment-agent run).

For each Object Type below, in Foundry Compass:
1. Right-click the Dataset → **Create Object Type from Dataset**
2. Foundry auto-detects property types — verify against this doc
3. Set the **Primary Key** to the column noted
4. Set the **API Name** to the namespaced value (`ce.<Name>`) so it doesn't collide with the other project
5. After all Object Types exist, define Link Types per the **Links** section at the end

## ce.Industry

**Backing Dataset:** `ce_industries` (`ri.foundry.main.dataset.79a03fdf-4957-43eb-afa5-3ab9c2a25a1b`)
**Primary Key:** `id`

| Property | Type | Required | Notes |
|---|---|---|---|
| id | Integer | yes | PK |
| name | String | yes | "Insurance", "Healthcare", … |
| slug | String | yes | URL-safe identifier |
| description | String | no |  |
| createdAt | Timestamp | yes |  |

**Title property:** `name`

## ce.Capability

**Backing Dataset:** `ce_capabilities` (`ri.foundry.main.dataset.b264ca80-6710-478d-bbdf-af1fa880a5d7`)
**Primary Key:** `id`

| Property | Type | Required | Notes |
|---|---|---|---|
| id | Integer | yes | PK |
| industryId | Integer | yes | FK → ce.Industry |
| parentCapabilityId | Integer | no | FK → ce.Capability (sub-cap hierarchy) |
| name | String | yes |  |
| slug | String | yes |  |
| description | String | no |  |
| traditionalView | String | no | "How conventional thinking treats this" |
| economicView | String | no | "Capability Economics reframe" |
| benchmarkScore | Integer | no | 0–100 |
| reviewStatus | String | yes | `pending_review` / `approved` / `rejected` |
| submittedBy | String | no | Reviewer display name |
| enrichmentStatus | String | no | `running` / `completed` / `failed` |
| enrichmentStage | String | no |  |
| enrichmentError | String | no |  |
| enrichmentUpdatedAt | Timestamp | no |  |
| createdAt | Timestamp | yes |  |

**Title property:** `name`

## ce.Quadrant

**Backing Dataset:** `ce_quadrants` (`ri.foundry.main.dataset.df7edf67-f158-4125-8683-43d4dc83d73c`)
**Primary Key:** `id`

| Property | Type | Required | Notes |
|---|---|---|---|
| id | Integer | yes | PK |
| capabilityId | Integer | yes | FK → ce.Capability |
| industryId | Integer | yes | FK → ce.Industry |
| runId | Integer | no | FK → enrichment_runs (nullable for ad-hoc rerun) |
| quadrant | String | yes | `hot` / `emerging` / `cooling` / `table_stakes` |
| economicImpactScore | Float | yes | 0–100 |
| adoptionMomentumScore | Float | yes | 0–100 |
| disruptionIntensity | Float | yes | 0–1 |
| rationale | String | yes |  |
| perplexitySources | Array<String> | no | Citations |
| generatedAt | Timestamp | yes |  |

**Title property:** synthesize from `capabilityId + quadrant`
**Latest-row note:** the API picks the row with greatest `generatedAt` per `capabilityId` — multiple rows may exist if reruns happen.

## ce.Economics

**Backing Dataset:** `ce_economics` (`ri.foundry.main.dataset.f2d9b413-b03b-4504-89e9-a54c7ad4e959`)
**Primary Key:** `id`

This is the marquee Object Type — every field on the capability detail page reads from here.

| Property | Type | Required | Notes |
|---|---|---|---|
| id | Integer | yes | PK |
| capabilityId | Integer | yes | FK → ce.Capability (1-to-1) |
| industryId | Integer | yes | FK → ce.Industry |
| **— Alpha (computed by agent's run_economic_alpha) —** | | | |
| tamUsdMm | Float | no | TAM in $M |
| samUsdMm | Float | no | SAM in $M |
| marginStructurePct | Float | no | 0–100 |
| halfLifeMonths | Integer | no | 6–120 |
| commoditizationVelocity | Float | no | 0–1 |
| revenueExposureMm | Float | no |  |
| consensusQuadrant | String | no | Street view |
| consensusConfidence | Float | no | 0–1 |
| consensusSummary | String | no |  |
| consensusSources | Array<String> | no |  |
| rationale | String | no |  |
| **— Detail (computed by agent's run_economic_detail) —** | | | |
| summaryNarrative | String | no | "What this capability is" |
| traditionalNarrative | String | no | "Traditional View" card |
| economicNarrative | String | no | "Economic View" card |
| aiNarrative | String | no | "How AI & innovation reshape this" |
| aiExposureScore | Integer | no | 0–100 |
| aiTimeToDisplacementMonths | Integer | no | 6–60 |
| aiSubstitutes | Array<String> | no | Real vendor names |
| metricInterpretations | Array<Object> | no | Per-metric narrative interpretations |
| dependencyRationales | Array<Object> | no |  |
| roleConsequences | Array<Object> | no |  |
| playbook | Array<String> | no | 3 actions, ≤18 words each |
| benchmarkInterpretation | String | no |  |
| generatedAt | Timestamp | yes |  |

**Title property:** synthesize from `capabilityId + (consensusQuadrant ?? "?")`

## ce.ValueChainStage

**Backing Dataset:** `ce_value_chain_stages` (`ri.foundry.main.dataset.cb23a839-afc4-43f5-81bc-34e5bac376c1`)
**Primary Key:** `id`

| Property | Type | Required | Notes |
|---|---|---|---|
| id | Integer | yes | PK |
| industryId | Integer | yes | FK → ce.Industry |
| stageName | String | yes |  |
| stageOrder | Integer | yes | 1..N |
| numSectors | Integer | no |  |
| hhiScore | Float | no | 0–1 (market concentration) |
| patentCount | Integer | no |  |
| patentTrendPct | Float | no |  |
| startupCount | Integer | no |  |
| startupTrendPct | Float | no |  |
| capitalFlowMm | Float | no |  |
| capitalTrendPct | Float | no |  |
| disruptionSummary | String | no |  |
| shifts | Array<String> | no |  |
| risks | Array<String> | no |  |
| keyCapabilities | Array<Integer> | no | FK → ce.Capability |
| keyCompanies | Array<String> | no | Free-text company names (string array, not FK) |
| perplexitySources | Array<String> | no |  |
| generatedAt | Timestamp | yes |  |

**Title property:** `stageName`

## ce.Company

**Backing Dataset:** `ce_companies` (`ri.foundry.main.dataset.21c774cd-6430-459b-b392-61d58cf9cc72`)
**Primary Key:** `id`

| Property | Type | Required | Notes |
|---|---|---|---|
| id | Integer | yes | PK |
| name | String | yes |  |
| country | String | no |  |
| naicsCode | String | no |  |
| naicsSector | String | no |  |
| industryId | Integer | yes | FK → ce.Industry |
| feviScore | Float | no | 0–1 (Forecasted Economic Value Index) |
| cdiScore | Float | no | 0–1 (Capability Disruption Index) |
| quadrant | String | no | `hot` / `emerging` / `cooling` / `table_stakes` |
| fundingStage | String | no | `seed` / `series_a` / `series_b` / `growth` / `public` / `private` |
| description | String | no |  |
| generatedAt | Timestamp | yes |  |

**Title property:** `name`

## ce.CapabilityDependency

**Backing Dataset:** `ce_capability_dependencies` (`ri.foundry.main.dataset.57ad3ace-a39b-4b44-b63f-592f1e23f3f7`)
**Primary Key:** `id`

| Property | Type | Required | Notes |
|---|---|---|---|
| id | Integer | yes | PK |
| capabilityId | Integer | yes | FK → ce.Capability (the dependent) |
| dependsOnId | Integer | yes | FK → ce.Capability (the depended-on) |
| strength | String | yes | `weak` / `moderate` / `strong` |

**Title property:** synthesize from `capabilityId → dependsOnId`
**Note:** This is a join-table Object Type. In Foundry's Link Type model you can either keep it as an Object Type with two outbound Links, OR expose it as a Many-to-Many Link Type directly between `ce.Capability` instances. The Object Type approach is simpler if you want `strength` on the link itself (you do, for the cascade graph weighting).

## Link Types

After all Object Types exist, define these Link Types in Foundry Ontology Manager → Link Types:

| Link Type | From | To | Cardinality | Notes |
|---|---|---|---|---|
| `ce.IN_INDUSTRY` | ce.Capability | ce.Industry | many-to-one | Match on `Capability.industryId == Industry.id` |
| `ce.HAS_QUADRANT` | ce.Capability | ce.Quadrant | one-to-many | Match on `Quadrant.capabilityId == Capability.id` (multiple historical quadrants per cap; latest wins for UI) |
| `ce.HAS_ECONOMICS` | ce.Capability | ce.Economics | one-to-one | Match on `Economics.capabilityId == Capability.id` |
| `ce.PARENT_CAPABILITY` | ce.Capability | ce.Capability | many-to-one | Match on `Capability.parentCapabilityId == Capability.id` (sub-cap hierarchy) |
| `ce.IN_VALUE_CHAIN_STAGE` | ce.Capability | ce.ValueChainStage | many-to-many | Driven by `ValueChainStage.keyCapabilities[]` array |
| `ce.STAGE_IN_INDUSTRY` | ce.ValueChainStage | ce.Industry | many-to-one | Match on `ValueChainStage.industryId == Industry.id` |
| `ce.COMPANY_IN_INDUSTRY` | ce.Company | ce.Industry | many-to-one | Match on `Company.industryId == Industry.id` |
| `ce.DEPENDS_ON` | ce.Capability | ce.Capability | many-to-many via ce.CapabilityDependency | Through-Object; carries `strength` property |

## Property naming convention

All Object Type API names: **camelCase** matching Postgres column names exactly (which Drizzle converts from snake_case → camelCase). The sync CSV header row uses the camelCase form, so Foundry's auto-detect should match without any rename.

If Foundry suggests "_" → "" mangling on auto-detect, override with the camelCase form so the property name matches `Capability.industryId` (used in agent code and frontend), not `industry_id`.

## After Object Types exist

1. **Sync runs hourly + on every agent run** — no manual nudge needed.
2. **AIP Logic agents** can query Object Types natively: `ce.Capability.search(...)`, `ce.Capability.dependsOn.dependsOn` for 2-hop traversal.
3. **Frontend** can swap from Express+Postgres to Foundry's REST API (`GET /api/v2/ontologies/{ont}/objects/ce.Capability/{id}`) — see Task #11.
4. **Foundry Functions** (TypeScript) wrap the Perplexity + Sonnet calls — see Task #8. Once those exist and AIP Logic flows are built (Task #10), the LangGraph enrichment agent in `services/enrichment/graph.ts` can be retired (Task #16).
