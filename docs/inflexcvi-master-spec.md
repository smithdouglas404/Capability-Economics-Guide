# Inflexcvi Platform — Master Specification

**Version:** 3.0
**Date:** 2026-05-16
**Classification:** Internal — Strategy, Engineering, Sales, Investor
**Owners:** Founder/CEO (business spec), Head of Engineering (technical architecture), Product (functional spec)

> This document is the consolidated master reference for the Inflexcvi platform. It supersedes the standalone `docs/business-spec.md`, `docs/architecture-spec.md`, and `docs/pitchbook.md` as the single source of truth where they conflict. Companion docs remain authoritative for niche subjects (Foundry ontology, Mem0/Letta install, Railway setup, multi-tenant isolation).

---

## Table of Contents

- [Document Control & Executive Summary](#document-control--executive-summary)
- **PART I — BUSINESS SPECIFICATION**
  - [1. Vision, Mission, Strategic Intent](#1-vision-mission-strategic-intent)
  - [2. Theoretical Foundation](#2-theoretical-foundation)
  - [3. Problem Definition & Quantitative Evidence](#3-problem-definition--quantitative-evidence)
  - [4. The Solution (Business View)](#4-the-solution-business-view)
  - [5. Market Opportunity](#5-market-opportunity)
  - [6. Competitive Landscape](#6-competitive-landscape)
  - [7. Business Model & Pricing](#7-business-model--pricing)
  - [8. Unit Economics](#8-unit-economics)
  - [9. Go-to-Market Strategy](#9-go-to-market-strategy)
  - [10. Operating Model & Financials](#10-operating-model--financials)
  - [11. Strategic Risks](#11-strategic-risks)
  - [12. Roadmap & Why Now](#12-roadmap--why-now)
- **PART II — BUSINESS REQUIREMENTS DOCUMENT**
  - [13. Stakeholder Map](#13-stakeholder-map)
  - [14. Business Objectives & KPIs](#14-business-objectives--kpis)
  - [15. Scope](#15-scope)
  - [16. Business Requirements (BR-001 …)](#16-business-requirements-br-001-)
  - [17. Non-Functional Requirements](#17-non-functional-requirements)
  - [18. Constraints & Assumptions](#18-constraints--assumptions)
  - [19. Acceptance Criteria & Test Strategy](#19-acceptance-criteria--test-strategy)
  - [20. Compliance & Regulatory Requirements](#20-compliance--regulatory-requirements)
- **PART III — FUNCTIONAL SPECIFICATION**
  - [21. Personas](#21-personas)
  - [22. End-to-End User Journeys](#22-end-to-end-user-journeys)
  - [23. Feature Catalogue](#23-feature-catalogue)
  - [24. UI/UX Specification](#24-uiux-specification)
  - [25. Data Flow Specification](#25-data-flow-specification)
  - [26. API Contract Surface](#26-api-contract-surface)
- **PART IV — TECHNICAL ARCHITECTURE**
  - [27. System Overview](#27-system-overview)
  - [28. Monorepo & Build System](#28-monorepo--build-system)
  - [29. Backend Architecture](#29-backend-architecture)
  - [30. Autonomous Agent Subsystem](#30-autonomous-agent-subsystem)
  - [31. CVI Computation Pipeline](#31-cei-computation-pipeline)
  - [32. Enrichment Pipeline](#32-enrichment-pipeline)
  - [33. Marketplace Subsystem](#33-marketplace-subsystem)
  - [34. Hedera Audit Chain](#34-hedera-audit-chain)
  - [35. Membership, Billing, Payments](#35-membership-billing-payments)
  - [36. Database Architecture](#36-database-architecture)
  - [37. Frontend Architecture](#37-frontend-architecture)
  - [38. AI Integration Architecture](#38-ai-integration-architecture)
  - [39. Deployment Architecture (Railway)](#39-deployment-architecture-railway)
  - [40. Observability & Operations](#40-observability--operations)
  - [41. Security Architecture](#41-security-architecture)
  - [42. Scalability & Evolution Path](#42-scalability--evolution-path)
- **APPENDICES**
  - [A. Mathematical Reference](#appendix-a-mathematical-reference)
  - [B. Database Schema Reference](#appendix-b-database-schema-reference)
  - [C. Complete API Endpoint Catalogue](#appendix-c-complete-api-endpoint-catalogue)
  - [D. Environment Variables Reference](#appendix-d-environment-variables-reference)
  - [E. Glossary](#appendix-e-glossary)

---

## Document Control & Executive Summary

### Document Control

| Field | Value |
|---|---|
| Document type | Consolidated Business + Functional + Technical specification |
| Status | Authoritative |
| Review cadence | Quarterly, by section owner |
| Change control | PR to `main` against this file; reviewers per section ownership |
| Distribution | Internal only; redacted excerpts may be shared with prospects/investors under NDA |

### Executive Summary

The Inflexcvi platform converts qualitative strategic-management theory (Resource-Based View; Dynamic Capabilities; Core Competencies) into a quantitative, continuously-updated, AI-driven intelligence product. It produces the **Capability Value Index (CVI)** — a 0–1000 composite score representing industry-level capability health — alongside a portfolio of products (capability assessments, C-Suite perspectives, knowledge graph, technology project impact analysis, marketplace) targeted at Chief Strategy Officers, Chief Transformation Officers, PE Operating Partners, and management-consulting buyers.

**Core thesis.** Organizational capabilities produce observable signals in the public information environment — consulting reports, market data, academic research, regulatory filings. These signals can be triangulated using Bayesian inference to produce reliable, quantified, time-series capability estimates with explicit credible intervals. GDP weighting and ontology-derived multipliers convert capability scores into economically interpretable signals.

**Why it works now.** Five preconditions converged in 2024–2026: reliable LLM structured output (>98% first-attempt JSON parse rate); programmatic real-time web research (Perplexity Sonar Pro); managed semantic memory (Mem0 Cloud); production-grade stateful agent orchestration (LangGraph); and a documented post-pandemic capability-assessment crisis (McKinsey 2023: 70% of digital transformations fail). Two years earlier, the platform would have been a research project; two years later it will face well-funded competition.

**Business shape.** Three-tier subscription (Explorer free → Professional $30K ACV → Enterprise $180–600K ACV) plus a Data License tier ($100–500K/year) and a marketplace for capability artifacts (listings, watermarked deliverables, Stripe-mediated purchases, Hedera-anchored audit trail). Year-3 plan: $25M ARR at 85% gross margin, EBITDA-positive at 25% margin.

**Technical shape.** pnpm monorepo (Node 24, TypeScript 5.9). Express 5 API server bundled with esbuild. React 19 + Vite SPA. PostgreSQL via Drizzle ORM. OpenAPI 3.1 → Orval codegen produces both React Query hooks and Zod validators, eliminating frontend/backend drift at compile time. Autonomous agent built on LangGraph runs every 30 minutes with three trigger types (routine, urgency watchdog, on-demand), researches via Perplexity, computes Bayesian posteriors, persists insights via Mem0 + Letta, streams progress via SSE, and writes time-series snapshots to Postgres. Deployment is single-service on Railway; integrations include Stripe, Clerk, Hedera HCS, Resend, NowPayments, Didit (KYC), and the Replit/OpenRouter Anthropic shim.

**What this document is.** A single self-contained reference covering **what we are building (Business Spec)**, **what the business needs from it (BRD)**, **what each part of the product does (Functional Spec)**, and **how it is engineered (Technical Architecture)**. Where finer detail exists in companion docs — Foundry ontology, Mem0/Letta install, Railway operational runbook, multi-tenant isolation — this document points at them rather than duplicating.

---

# PART I — BUSINESS SPECIFICATION

## 1. Vision, Mission, Strategic Intent

### 1.1 Vision

> **Make organizational capabilities as tractable as financial assets.** Capability data is the missing layer beneath strategic decision-making. Bloomberg made financial assets continuously priced and benchmarked; our equivalent operationalizes the capability layer.

### 1.2 Mission

Build and operate the canonical intelligence platform for measuring, benchmarking, and forecasting organizational capability health — continuously, quantitatively, with epistemic honesty (every score carries a confidence interval; every claim cites sources).

### 1.3 Strategic Intent (5-year horizon)

1. **Be the index of record.** When an analyst, executive, or investor asks "how mature is Industry X's Capability Y?", the CVI is the cited answer.
2. **Own the institutional memory.** The agent's accumulating research corpus (Mem0 + DB triangulations + CVI snapshots) becomes a non-replicable data moat. A late entrant can build the software but cannot buy the data.
3. **Become the data primitive other systems consume.** Bloomberg-style data licensing into financial terminals, BI tools, and consulting deliverables — capability scores as a factor in equity research, due diligence, and portfolio monitoring.
4. **Operate at SaaS unit economics, not consulting unit economics.** Agent-first content production keeps marginal cost of an additional capability insight near-zero, structurally enabling 80%+ gross margin while replacing $200K–$2M consulting engagements.

### 1.4 Operating Principles

- **Agent-first content production.** All scores, perspectives, and ROI narratives are agent-generated. Frontend is a pure read surface. Eliminates editorial latency; enables 3× daily refresh.
- **Source-grounded inference, not fabrication.** Every score is grounded in live web research with citations. The platform never asserts what it cannot triangulate.
- **Bayesian uncertainty as a first-class attribute.** Every output carries a 95% credible interval. The system knows what it doesn't know, and says so.
- **Type-system-enforced contract integrity.** OpenAPI is the contract authority; codegen makes drift a compile error, not a runtime bug.
- **Zero manual triggers in production.** The scheduler is autonomous. No human action is required to keep data fresh.

---

## 2. Theoretical Foundation

The platform operationalizes three decades of strategic-management theory that has remained largely qualitative.

### 2.1 Resource-Based View (Barney, 1991)

Sustained competitive advantage derives from resources that are **valuable, rare, inimitable, and non-substitutable** (VRIN). Organizational capabilities are the canonical VRIN resource — firm-specific, tacit, path-dependent. Yet no systematic method existed to measure them quantitatively at industry scale. The platform's contribution: provide that measurement infrastructure.

### 2.2 Dynamic Capabilities (Teece, Pisano & Shuen, 1997)

Competitive advantage in rapidly changing environments requires the capacity to **sense, seize, and reconfigure** capabilities. Dynamic capabilities are meta-capabilities — the ability to build, integrate, and reconfigure existing ones. Measuring **capability velocity** (rate of change) is essential to assessing dynamic-capability health. The CVI's velocity term ($V_c$) directly operationalizes this.

### 2.3 Core Competencies (Prahalad & Hamel, 1990)

The corporation's most important resource is the collective learning embedded in its capability portfolio — especially capabilities that span business units, are difficult to imitate, and provide access to many markets. Their seminal observation: most corporations underinvest in their core competencies because they lack a measurement language. The platform supplies that language.

### 2.4 The Information-Asymmetry Problem

The fundamental market failure addressed is **information asymmetry in capability assessment**:

- **Within firms:** Executives know their capabilities intuitively but cannot quantify them for capital allocation decisions. The CFO asks "why $50M for claims automation?" — the COO cannot answer with precision.
- **Across firms:** Industry benchmarks exist for financial metrics (ROE, EBITDA margins) but not for capabilities. No executive knows whether their fraud-detection capability is in the top quartile.
- **For investors:** PE due-diligence teams assess operational capabilities qualitatively over months. They systematically miss capability gaps that surface 18 months post-acquisition.
- **Over time:** Point-in-time consulting assessments give a snapshot but no trend. Whether a capability is improving or declining is invisible.

The platform dissolves each of these asymmetries through **continuous, quantified, benchmarked, time-series capability intelligence**.

### 2.5 The Composite-Index Analogue (UNDP HDI)

The CVI's design draws on the UNDP **Human Development Index** — a multi-dimensional construct where component scores are weighted and aggregated into a single comparable scalar. The analogy is deliberate: HDI makes human development comparable across nations with different demographic profiles; CVI makes capability health comparable across industries with different economic structures. GDP weighting in CVI is the structural counterpart of HDI's logged-income normalization.

---

## 3. Problem Definition & Quantitative Evidence

### 3.1 The Capability-Measurement Gap

The absence of quantitative capability measurement creates measurable economic damage:

- **Misallocated capital at scale.** McKinsey Global Institute (2021): corporations globally misallocate 30–40% of strategic investment budgets due to insufficient capability intelligence. On a global capex base of ~$15T, this is **$4.5–6T annually** in misallocation.
- **M&A value destruction.** KPMG M&A Integration Survey (2023): **70% of acquisitions fail** to meet pre-deal value-creation targets. Most-cited root cause: overestimation of target operational capabilities. Average value destruction per failed deal: $340M (PwC M&A Report, 2024).
- **Transformation failure rates.** McKinsey digital transformation research (2023): **70% of large-scale digital transformations fail** to achieve stated objectives. Primary failure mode: organizations launch programs without accurate baselines of existing capability maturity.
- **Consulting market as symptom.** Global management consulting market: **$800B+ annually** (Statista, 2025). Capability assessment, benchmarking, and improvement advice account for ~35% of this spend (~**$280B/year**). This market exists because firms have no self-serve capability intelligence infrastructure.

### 3.2 The Temporal Problem: Capability Drift

Capability health changes continuously, but measurement is episodic. Insurance industry illustrations:

- **AI/ML in Underwriting** advanced from "emerging" to "competitive table stakes" between 2020 and 2024 — a 4-year window. Firms that failed to detect this trajectory and accelerate investment lost underwriting margin relative to early-detecting peers.
- **Claims Automation** — COVID-19 forced a 3-year acceleration of automation adoption into 18 months. Insurers without continuous capability monitoring failed to respond until analyst reports confirmed the shift, often 12–18 months too late.

The CVI's velocity term explicitly models this temporal dynamic. A capability with **score=65, velocity=+8** (strongly improving) is strategically different from **score=65, velocity=−3** (declining). The former may be approaching parity; the latter may be approaching a threshold breach.

### 3.3 The C-Suite Misalignment Problem

Organizational capabilities are assessed differently by different executive functions, creating decision-making fragmentation. The same capability — Claims Automation — looks like:

- **CFO** — cost reduction and EBITDA-margin story
- **COO** — operational risk and throughput-efficiency story
- **CTO** — technology architecture and vendor-selection story
- **CHRO** — workforce displacement and reskilling story
- **CISO** — attack-surface and data-handling story
- **CEO** — competitive positioning and capital-allocation story

In practice these views are never synthesised. Investment decisions are made in functional silos with different data, success metrics, and time horizons. The C-Suite Perspectives Hub renders a single capability through six simultaneous executive lenses, using AI to translate the same underlying data into role-appropriate language and priorities.

---

## 4. The Solution (Business View)

### 4.1 Capability Value Index (CVI)

The CVI is the platform's primary output: a composite score (0–1000) representing the overall capability health of an industry, updated continuously by the autonomous agent. The mathematical formulation lives in §31 (technical) and Appendix A; the **business interpretation** is below.

**Scoring bands and strategic implications:**

| Band | Score | Strategic implication |
|---|---|---|
| Nascent | 0–200 | Structural capability gap; competitive exposure acute; reactive investment required |
| Developing | 200–400 | Early adoption underway; significant execution variability; catching-up investment optimal |
| Advancing | 400–600 | Broad deployment; competitive parity; incremental optimisation investment |
| Leading | 600–800 | Differentiated capability; capability-as-competitive-advantage; defend-and-extend strategy |
| Transformative | 800–1000 | Industry-defining capability; potential for capability licensing / ecosystem plays |

**Economic-weighting rationale.** Capabilities are not equally valuable across industries. Claims-Processing capability in Insurance (~$6T global premiums annually) carries higher economic stakes than the same capability in Retail. GDP weighting adjusts for this structural difference, ensuring the index reflects actual economic significance rather than treating all capabilities symmetrically.

### 4.2 Product Module Architecture

| Module | Audience | Conversion role |
|---|---|---|
| **CVI Dashboard** | CSO, CTO | Continuous-monitoring surface; brand authority |
| **Capability Assessment Tool (`/assess`)** | Strategy / transformation leads at any size | Primary conversion mechanism (PLG AHA moment) |
| **Industry Case Studies** | CFO, COO, board members | Quantitative grounding; ROI narrative |
| **C-Suite Perspectives Hub** | All C-Suite roles | Role-translation layer; reduces internal alignment friction |
| **Knowledge Graph** | CTO, CDO, transformation lead | Visualises capability dependency systems |
| **Technology Project Impact Analysis** | CIO, CFO, CTO | Bridges tech investment decisions and capability outcomes |
| **Organization Self-Assessment** | Mid-market strategy leads | Low-friction value demo; PLG entry |
| **Marketplace** | Sellers (consultants, researchers) and buyers (mid-market strategy) | Two-sided expansion; long-tail capability artifacts |
| **Autonomous Agent Surface** | Power users; auditors | Transparency / trust signal; differentiates from black-box AI |

### 4.3 The Marketplace as Network-Effect Layer

The marketplace converts the platform from a pure SaaS product into a two-sided market for capability artifacts (assessments, sector deep-dives, ontology extensions, custom case studies). Sellers monetise expertise; buyers acquire artifacts at fractional consulting cost; the platform takes a take-rate (Stripe Connect mediates payouts) and earns trust capital from the watermarked + Hedera-anchored audit trail.

This is a **flywheel asset**: every transaction expands the corpus, which improves the agent, which attracts more buyers, which attracts more sellers. The marketplace is funded conservatively in Year 1 (15-listing seed; 30-day TTL auto-archive; admin moderation) and is intended to grow into a primary revenue line by Year 3.

---

## 5. Market Opportunity

### 5.1 Sizing Methodology

We use **bottom-up sizing anchored in observable market signals**, not top-down TAM from analyst reports. Two anchors:

**Anchor 1 — Capability-assessment share of consulting:**

1. Global management-consulting revenue: ~$800B (Statista, 2025)
2. Capability assessment & benchmarking share: ~35% = **$280B**
3. Addressable via software (no human consultants required): ~15% = **$42B TAM**

**Anchor 2 — Strategy Intelligence Software:**

- Gartner Strategy Management Software market: $8.2B (2025), 14% CAGR
- Adjacent: Business Intelligence ($33B), GRC software ($16B)
- CVI carves a differentiated position: not BI (no capability framework), not GRC (no compliance focus)

### 5.2 Segment Sizing

| Segment | Companies | Avg spend potential | SAM | Rationale |
|---|---|---|---|---|
| Fortune 500 strategy teams | 500 | $120K/year | $60M | CSO/CTO budget; replaces fraction of consulting spend |
| Fortune 1000 (non-F500) | 500 | $40K/year | $20M | VP-level buyer; smaller consulting budgets |
| Mid-market ($500M–$5B revenue) | ~3,000 | $25K/year | $75M | Underserved by consulting; highest value:cost |
| PE firms (AUM >$1B) | ~800 | $200K/year | $160M | Portfolio monitoring; due diligence; high ROI |
| Big 4 / strategy consulting | ~50 firms | $500K/year | $25M | White-label / data licence for client work |
| **Total SAM** | | | **$340M** | Conservative; excludes international |

**SOM Year 3 (2029):** $25M ARR. Achievable with 50 enterprise customers at $150K ACV + 500 professional customers at $30K ACV. Requires 8–10 enterprise salespeople and a functioning PLG motion.

### 5.3 The Institutional-Memory Moat (Quantified)

After 12 months of 3× daily research cycles:

- **~3,000 agent memories** in Mem0 Cloud (observations, patterns, insights, decision contexts)
- **~4,000 source triangulations** in DB (Perplexity evidence per capability)
- **~500 CVI snapshots** (time-series across 6 industries)
- **Calibrated priors** — agent's Bayesian prior shifts from non-informative ($\mu_0=50$, $\sigma_0=25$) to informative posterior derived from 12 months of observed evidence

A competitor launching today with the same technology stack cannot replicate this corpus — they can build the software but cannot buy the data. Every research cycle widens the gap.

---

## 6. Competitive Landscape

### 6.1 Porter's Five Forces

- **Threat of new entrants — Medium-High.** Core technology (LLMs + research APIs) is commoditising. Defensible head-start: CVI formula, ontology graph (100+ cited sources), institutional memory corpus, C-Suite translation framework. Real barrier is dataset accumulation — a compounding moat.
- **Bargaining power of buyers — Medium.** Strong individually, no buyer >5% of revenue at scale. Switching cost moderate (benchmark scores + history create lock-in analogous to a financial-data terminal).
- **Bargaining power of suppliers — Low-Medium.** Key suppliers (Perplexity, Anthropic, Mem0) all have viable alternatives (Tavily/Exa, OpenAI/Gemini, Pinecone/Weaviate). Abstraction layers in the codebase mitigate concentration.
- **Threat of substitutes — Medium.** Primary substitutes: management consulting ($2M, 6 months) and doing nothing. Consulting substitute is 40–400× more expensive per insight. The "do nothing" substitute evaporates when a competitor adopts the platform — first-mover incentive.
- **Competitive rivalry — Low (currently).** No direct competitor offers continuous, quantified, AI-driven capability intelligence with economic weighting. Adjacents (Gartner, IDC, McKinsey research) sell static reports, not live platforms.

### 6.2 Competitive Matrix

| Competitor | Quantified scores | Continuous update | Self-serve | Economic frame | C-Suite translation | AI agent |
|---|---|---|---|---|---|---|
| McKinsey Capability Center | Partial | No (point-in-time) | No | Partial | Partial | No |
| Gartner Peer Insights | No (qual.) | Slow (6–12mo) | Yes | No | No | No |
| BCG Henderson Institute | No (research) | No | No | No | No | No |
| Palantir Foundry | Yes (operational) | Yes | No | No | No | Partial |
| Workday Peakon | Yes (HR) | Yes | Partial | No | No | No |
| **Inflexcvi** | **Yes (Bayesian)** | **Yes (8h)** | **Yes** | **Yes (GDP-weighted)** | **Yes (6 roles)** | **Yes (autonomous)** |

---

## 7. Business Model & Pricing

### 7.1 Pricing Architecture

**Design philosophy:** three buyer personas with distinct value perceptions, budget owners, and ROI expectations.

**Explorer — Free (PLG motion).** Single industry; public CVI access; one self-assessment/month. Purpose: demonstrate value, convert within 30–90 days. No card required. **Conversion target: 15% of Explorer → Professional within 90 days.**

**Professional — $2,500/month ($30K ACV).** All 6 industries; full benchmarks; unlimited assessments; full C-Suite Perspectives × industries; dashboard gap analysis with personalised roadmap; up to 5 users. Buyer: VP Strategy / Chief Transformation Officer at mid-market. ROI: replaces one consulting engagement (~$200K) for $30K/year.

**Enterprise — $15,000–$50,000/month ($180K–$600K ACV).** Custom industry verticals; white-labelled reports; API access for BI integration; unlimited users + SSO; dedicated agent configuration; 99.9% uptime SLA. Buyer: CSO at F500 / PE Operating Partner. ROI: replaces 30% of annual consulting spend on capability diagnostics.

**Data License — $100K–$500K/year.** Bulk historical CVI via REST API; real-time snapshots via webhook/streaming; custom scoring models. Buyer: Bloomberg Terminal, FactSet, S&P Global, index providers. ROI: new data product; capability indices as factor in equity research.

**Marketplace take-rate.** 12–18% on completed transactions, mediated through Stripe Connect. Marketplace commissions are uncapped — they scale with marketplace volume independent of subscription tier.

### 7.2 Membership Mechanics

The membership system (`/api/me/membership/*`) supports three payment paths:

1. **Card (Stripe Checkout).** `POST /api/me/membership/checkout` creates a `pending` row, then a Stripe Checkout Session, returns `checkoutUrl`. Stripe webhook (`POST /api/stripe/webhook`, mounted before `express.json()` for signature verification) flips `pending → active` only when status is currently `pending` (idempotent; never overrides admin rejection).
2. **Invoice / Crypto.** Admin reviews in `/admin/payments` and approves manually. NowPayments webhook handles crypto IPN.
3. **Free tier.** Auto-active on request.

`STRIPE_WEBHOOK_SECRET` is required in production — without it, `verifyWebhookSignature` throws. In dev, the handler falls back to parsing the body unverified with a loud warning.

---

## 8. Unit Economics

### 8.1 Professional Tier (Illustrative)

| Metric | Value | Derivation |
|---|---|---|
| ACV | $30,000 | $2,500 × 12 |
| Gross margin | 85% | AI API costs ~$50/customer/month |
| CAC | $12,000 | Blended salesperson + PLG conversion |
| Payback | 5.6 months | CAC / (ACV × gross margin) |
| LTV (36-month avg tenure) | $76,500 | $30K × 85% × 3 |
| LTV:CAC | 6.4× | SaaS healthy benchmark: >3× |

### 8.2 Enterprise Tier (Illustrative)

| Metric | Value | Derivation |
|---|---|---|
| ACV | $240,000 | $20K/month blended |
| Gross margin | 78% | Higher support + dedicated agent |
| CAC | $85,000 | 6–9-month sales cycle; senior AE + SE |
| Payback | 5.4 months | Similar payback, higher absolute profit |
| LTV (48-month avg tenure) | $748,800 | $240K × 78% × 4 |
| LTV:CAC | 8.8× | Enterprise customers churn less |

### 8.3 Margin Sensitivity at 100 Enterprise Customers ($24M ARR)

- Perplexity API: ~$3K/month ($36K/year) — scales with research volume, not customer count
- Anthropic / OpenRouter: ~$5K/month ($60K/year) — scales with assessment volume
- Infrastructure (Railway): ~$2K/month ($24K/year)
- Mem0 Cloud: ~$500/month ($6K/year)
- **Total AI + infra: ~$126K/year against $24M ARR = 0.5% of revenue**

The structural advantage of agent-generated content at scale: marginal cost of an additional capability insight approaches zero as the agent accumulates context. The 85% gross margin is structurally sustainable and improves as AI API costs deflate.

### 8.4 Year-3 Revenue Mix Projection

| Stream | Customers | ACV | Revenue | % of total |
|---|---|---|---|---|
| Professional | 500 | $30K | $15.0M | 60% |
| Enterprise | 30 | $300K | $9.0M | 36% |
| Data Licensing | 2 | $250K | $0.5M | 2% |
| Consulting Packages + Marketplace | 10 + var. | $50K avg | $0.5M | 2% |
| **Total** | | | **$25.0M** | |

---

## 9. Go-to-Market Strategy

### 9.1 Strategic Positioning — "Bloomberg for Capabilities"

The most effective positioning analogy for enterprise buyers: **Inflexcvi is to organizational capabilities what Bloomberg Terminal is to financial assets.** Bloomberg made financial data continuous, quantified, benchmarked, and real-time, transforming qualitative market assessment into a data product. Inflexcvi does the same for organizational capabilities. CFOs and investors immediately understand Bloomberg's value-creation event — the framing requires no education.

### 9.2 Three-Phase Go-to-Market

**Phase 1 — Content-Led Authority (Months 1–6).** Establish epistemic credibility before selling.

- Publish CVI Industry Reports (Insurance, Healthcare, Banking) ungated. 20-page PDFs with Bayesian-scored capability maps, velocity analysis, executive summaries. Differentiated from consulting whitepapers because they cite live data with credible intervals.
- LinkedIn thought leadership: weekly CVI updates targeting CSOs and Chief Transformation Officers. Hook: "The capability your competitors are improving fastest right now."
- Academic positioning: submit CVI methodology paper to *Strategic Management Journal* or *Journal of Strategic Information Systems*.
- Explorer tier as content upgrade — readers of CVI reports offered free org assessment.

**Phase 2 — PLG → Sales-Assist (Months 4–12).** Convert Explorer users to Professional/Enterprise via in-product value delivery.

- AHA moment: organisation sees its gap vs. industry benchmark on the radar chart. Every product decision accelerates time-to-AHA.
- Sales-assist trigger: when Explorer org runs 3+ assessments, AE outbound with industry-specific insights about their gaps.
- Champion-led expansion: Professional users present CVI data in board meetings → board members ask how to get enterprise access → upmarket via internal champion.

**Phase 3 — Enterprise & Data Licensing (Months 12–36).** Land large contracts and high-margin data deals.

- PE Operating Partner channel: one PE firm covering 20 portfolio companies = $400K–$2M contract. Wedge: portfolio-level capability benchmarking.
- Big 4 partnership: white-label CVI data for consulting deliverables. McKinsey/BCG/Deloitte cannot build this fast enough; they will license. Position as "the data layer beneath their capability practice".
- Financial data terminals: Bloomberg, FactSet alternative-data programs. CVI as alt-data factor in equity research is a novel, defensible product category.

### 9.3 Demand Generation Channels

| Channel | CAC | Volume | Quality | Priority |
|---|---|---|---|---|
| Content / SEO (CVI reports) | ~$500 | Medium | Medium | High |
| LinkedIn outbound | ~$8,000 | Low | High | Medium |
| PLG (Explorer → paid) | ~$2,000 | Medium | High | Highest |
| Conference speaking (Gartner, MIT Sloan) | ~$15,000 | Low | Very high | Medium |
| Partner channel (PE firms) | ~$25,000 | Low | Very high | High |
| Data terminal licensing | ~$100,000 | Very low | Extreme | Long-term |

---

## 10. Operating Model & Financials

### 10.1 Cost Structure at Scale

**AI & infrastructure (non-headcount):**

| Service | Current (~10 users) | Year 2 (~200 users) | Year 3 (~500 users) |
|---|---|---|---|
| Perplexity API | $36/mo | $800/mo | $3,000/mo |
| Anthropic / OpenRouter | $36/mo | $1,200/mo | $5,000/mo |
| Mem0 Cloud | $10/mo | $200/mo | $800/mo |
| Railway (infra) | $20/mo | $500/mo | $2,000/mo |
| **Total AI + infra** | **$102/mo** | **$2,700/mo** | **$10,800/mo** |
| **% of ARR** | **<1%** | **<1%** | **<1%** |

Structural insight: AI API costs scale primarily with research volume (agent cycles × capabilities), not customer count. A 10× user increase triggers only 2–3× cost increase.

### 10.2 Headcount Plan

| Stage | Milestone | Critical hires |
|---|---|---|
| Now | $0 ARR | Founder + AI agent (the agent is a team member) |
| Seed ($500K) | $1M ARR | ML Engineer (agent quality), Enterprise AE |
| Series A ($5M) | $5M ARR | +2 Engineering, +2 Sales, +1 CS, +1 Data Science |
| Series B ($20M) | $15M ARR | +5 Eng, +5 Sales, +3 CS, +2 DS, +1 Finance, +1 Legal |

**Ratio target at scale:** Engineering : Sales : CS = 4 : 2 : 1. High engineering intensity reflects ongoing agent improvement as primary moat.

### 10.3 Three-Year Financial Projection

| Metric | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Professional customers | 20 | 120 | 500 |
| Enterprise customers | 2 | 12 | 30 |
| ARR | $660K | $5.4M | $17.7M |
| Gross margin | 80% | 83% | 85% |
| Gross profit | $528K | $4.5M | $15.0M |
| Headcount | 3 | 12 | 28 |
| OpEx (incl. salaries) | $1.2M | $4.8M | $10.5M |
| EBITDA | −$672K | −$300K | $4.5M |
| EBITDA margin | −102% | −6% | +25% |

**Path to profitability:** EBITDA-positive in Year 3 at ~$17.7M ARR. Achievable without additional capital if Seed funding ($500K) is used efficiently for product development and the first 20 enterprise customers are closed via founder-led sales.

---

## 11. Strategic Risks

### 11.1 Risk Register

| Risk | Category | Probability | Impact | Mitigation |
|---|---|---|---|---|
| LLM output quality degradation | Technology | Medium | High | Structured output + Zod; human review for enterprise reports; fallback models |
| Perplexity API pricing increase | Supplier | Medium | Medium | Abstraction layer enables switch to Exa/Tavily in <2 weeks |
| Enterprise sales cycle >12 months | Market | High | Medium | PLG motion generates revenue while enterprise cycles mature; PE channel is faster |
| Competitor replication by McKinsey/BCG | Competitive | Low (24–36mo) | High | Institutional-memory moat; proprietary formula; first-mover data accumulation |
| Capability score accuracy challenged | Epistemic | Medium | High | Bayesian credible intervals quantify own uncertainty; sources cited |
| AI API cost inflation | Supplier | Low | Medium | Current costs 0.5% of ARR — 10× inflation still yields >75% gross margin |
| Data privacy regulation | Legal | Low | Medium | No PII in AI pipeline; B2B only; GDPR-compliant by design |
| Single-founder execution risk | Operational | High | High | Seed hire: CTO/cofounder; document agent architecture; formalise board |
| Marketplace fraud / IP disputes | Trust | Medium | Medium | Watermarking + Hedera audit chain on every purchase; KYC for sellers |
| Hedera HCS rate-limits / costs | Supplier | Low | Low | Anchoring is asynchronous + batched; failure non-blocking for purchase flow |

### 11.2 The Epistemological Risk (Most Underappreciated)

The platform's greatest non-obvious risk is **epistemological legitimacy**: what if sophisticated users (CFOs, investment committees, PhD economists) challenge the validity of AI-generated capability scores?

**Mitigation architecture:**

1. **Credible intervals are mandatory.** Every score reports a 95% CI. Scores that pretend to certainty invite challenge; scores that quantify uncertainty invite collaboration.
2. **Source citation is mandatory.** Every CVI component cites its Perplexity research queries and returned sources. Evidence chain is auditable.
3. **Calibration studies.** Annually compare CVI scores to realised financial performance for companies whose assessed capabilities are known. Calibration data builds statistical evidence for the formula's predictive validity.
4. **Academic partnership.** Co-publish CVI methodology with a business school for third-party validation that sophisticated buyers cannot dismiss.
5. **Transparency report.** Quarterly publication of CVI accuracy, recall patterns, methodology updates builds institutional trust over time.

---

## 12. Roadmap & Why Now

### 12.1 Q2 2026 (Current State)

- ✅ Live CVI with autonomous agent (8h research cycles + urgency watchdog)
- ✅ 6 industries × 60+ capabilities with full Bayesian scoring
- ✅ C-Suite perspectives hub (AI-generated, 6 roles × 6 industries)
- ✅ Insurance case study with 5-year ROI timeline (AI-generated)
- ✅ Organization self-assessment with gap analysis
- ✅ Capability Assessment tool with voice input, EDGAR integration, WEF radar
- ✅ Marketplace MVP (listings, sellers, purchases, workspace, watermarking, auto-archive)
- ✅ Hedera audit chain (purchases + security violations)
- ✅ Railway production deployment with PostgreSQL + pgvector + Letta + Mem0

### 12.2 Q3 2026

- Multi-org dashboard (PE portfolio companies on one canvas)
- Healthcare and Banking deep-dive case studies (agent-generated)
- PDF report export (white-labelled, enterprise feature)
- Embeddable CVI widget (investor decks, board materials)
- Calibration study: CVI vs. financial performance for public companies
- Marketplace seller onboarding KYC flow (Didit integration end-to-end)

### 12.3 Q4 2026

- API access tier (JSON endpoints for BI integration)
- Custom capability taxonomy builder (enterprise feature)
- Slack/Teams alerts for threshold breaches
- 3 additional industries: Manufacturing, Technology, Retail (deep dive)
- Memory consolidation: agent merges observation memories into patterns automatically
- War-room collaboration surface (live cross-org capability deliberation)

### 12.4 Q1 2027

- Data licensing product (bulk API, historical snapshots, streaming webhooks)
- International calibration: UK, EU, APAC (regional GDP weights, regional sources)
- Agent fine-tuning: customers provide assessment data to personalise scoring priors
- Acquisition due-diligence module: rapid capability assessment workflow for PE deal teams
- Academic paper submission: CVI methodology + predictive validity evidence

### 12.5 Q2 2027

- Capability prediction model: forecast scores 12–24 months ahead (time-series ML)
- Peer community: anonymous benchmark sharing across organisations
- Custom agent: enterprise customers configure agent research schedule, taxonomy, weighting
- Series A fundraise target: $5M at $20–25M pre-money

### 12.6 Why Now

Five conditions converged in 2024–2026 to make this platform possible for the first time:

1. **LLM structured-output reliability.** Claude 3.5+/4.x produce valid JSON matching complex schemas at >98% first-attempt rate. Enables autonomous content generation without per-output human review.
2. **Real-time web research APIs.** Perplexity Sonar Pro provides programmatic live web research with source citations. Pre-2023 required brittle browser automation or expensive scraping licences.
3. **Semantic memory infrastructure.** Mem0 / Pinecone / Weaviate make vector-DB-backed semantic memory available as managed services. Building equivalent in 2020 required a 6-person ML team.
4. **LangGraph for stateful orchestration.** Production-ready directed-graph execution with typed state, checkpointing, error handling. Agent architecture takes 3 weeks now vs. 6 months in 2022.
5. **Organizational capability crisis.** Post-pandemic transformation failures are statistically documented (McKinsey 2023). Consulting-led capability assessment has 70% failure rate. Enterprise buyers actively seeking alternatives. Market is receptive in a way it was not before 2023.

The platform is a direct product of this convergence. Two years earlier: research project. Two years later: well-funded competition. **The window is now.**

---

# PART II — BUSINESS REQUIREMENTS DOCUMENT

## 13. Stakeholder Map

### 13.1 Internal Stakeholders

| Stakeholder | Role in product | Decision rights | Information needs |
|---|---|---|---|
| Founder/CEO | Strategy, fundraising, founder-led sales | All product/strategy trade-offs; pricing; positioning | CVI accuracy, customer references, runway, competitive intel |
| Head of Engineering | Architecture, agent quality, platform reliability | Tech stack choices, infra topology, SLO targets | Agent run telemetry, error rates, build/deploy state, CVE backlog |
| Head of Product | Feature prioritisation, UX, roadmap sequencing | Roadmap order, persona-feature mapping, beta gating | Feature usage, conversion funnel, NPS, support tickets |
| Head of Sales | Pipeline, ACV mix, enterprise close | Discount approval (within bands), proposal contents | Lead source attribution, win/loss notes, competitor mentions |
| Customer Success | Onboarding, expansion, churn prevention | Onboarding playbook content; in-app guidance copy | Health scores, feature adoption, renewal risk |
| Finance | Unit economics, runway, board reporting | Pricing approval (with founder); budget allocation | ARR, gross margin, CAC, payback, cost-of-goods detail |
| Compliance / Legal | DPA, GDPR/CCPA, marketplace IP, KYC | Data-handling, retention, take-down procedures | Data flow inventory, deletion logs, KYC pass rate |

### 13.2 External Stakeholders

| Stakeholder | Relationship | Mutual expectations |
|---|---|---|
| Explorer users | Free tier; future paying customers | Genuine value within 5 minutes of signup; no friction; no manipulative upgrade prompts |
| Professional buyers | $30K ACV; mid-market strategy leads | Replaces one consulting engagement annually; weekly value moments; in-product roadmap items shipped quarterly |
| Enterprise buyers | $180K–$600K ACV; CSO / PE Operating Partner | White-labelled deliverables; named CSM; quarterly business reviews; SLA enforced |
| Data-license customers | $100K–$500K/year; terminals & index providers | Bulk REST + streaming; reliability >99.9%; data dictionary versioned |
| Marketplace sellers | Take-rate relationship | Honest take-rate; transparent moderation; watermarking + audit trail to protect IP |
| Marketplace buyers | Per-transaction relationship | Authentic artifacts; clear provenance; chargeback-able through Stripe |
| Investors (current + prospective) | Funding source | Quarterly board pack; honest risk reporting; KPI transparency |
| Academic partners | Co-research on CVI methodology | Methodology transparency; co-publication credit; calibration data access |
| Suppliers (Anthropic, Perplexity, Mem0, Letta, Stripe, Clerk, Resend, NowPayments, Didit, Hedera, OpenRouter, Railway) | Vendor relationship | SLA adherence; predictable pricing; deprecation notice; security posture |
| Regulators (where applicable) | Compliance counterparty | Honest disclosures; data-handling per jurisdiction |

### 13.3 Governance & RACI Summary

- **Roadmap decisions** — R: Head of Product; A: CEO; C: Engineering, Sales, CS; I: All hands.
- **Pricing changes** — R: Head of Sales; A: CEO + Finance; C: Product, CS; I: Marketing.
- **Schema / contract changes (`openapi.yaml`)** — R: Engineer making change; A: Head of Engineering; C: Frontend lead (consumer of generated hooks); I: Product.
- **CVI methodology changes** — R: Founder/CEO + ML; A: CEO; C: Academic partners; I: All paying customers via release notes.
- **Marketplace moderation policy** — R: Trust & Safety / CS lead; A: CEO; C: Legal; I: Sellers.
- **Production incident response** — R: On-call engineer; A: Head of Engineering; C: CS (customer comms), CEO (>P1); I: All hands post-incident.

---

## 14. Business Objectives & KPIs

### 14.1 Strategic Objectives (12-month horizon)

| ID | Objective | KPI(s) | Target |
|---|---|---|---|
| OBJ-01 | Establish CVI as cited industry index | Inbound mentions in analyst reports; LinkedIn impressions on CVI updates; downloaded CVI Industry Reports | 3 analyst mentions; 100K monthly LinkedIn impressions; 5,000 report downloads |
| OBJ-02 | Achieve PLG-driven conversion engine | Explorer → Professional conversion rate; time-to-AHA (radar render) | 15%; <5 minutes |
| OBJ-03 | Build enterprise pipeline | Qualified enterprise opportunities; enterprise pipeline coverage | 30 opps; 4× target |
| OBJ-04 | Establish marketplace flywheel | Active sellers; completed transactions/month; take-rate revenue | 50 sellers; 75 txn/mo; $5K/mo |
| OBJ-05 | Sustain agent reliability | Successful agent runs / scheduled runs; CVI staleness P95 | >98%; <9 hours |
| OBJ-06 | Preserve epistemic credibility | Avg CI width on top-100 capabilities; sources cited per CVI component | <15 points; ≥4 sources |
| OBJ-07 | Build dataset moat | Agent memories in Mem0; source triangulations in DB; CVI snapshots | 3,000; 4,000; 500 |
| OBJ-08 | Maintain compliance posture | Open GDPR/CCPA deletion requests >30 days; KYC pass-rate for sellers | 0; >80% |

### 14.2 Product KPIs (Operational)

- **Activation:** % of new orgs that complete at least one capability assessment within 7 days. Target: 60%.
- **Retention:** D30 / D90 / D180 active-org cohort retention. Targets: 70% / 50% / 40%.
- **Expansion:** Net Revenue Retention (paid cohorts). Target: ≥115%.
- **Conversion funnel:** Explorer signup → Explorer active → Professional trial → Professional paid. Tracked as a 4-step funnel with weekly cohort analysis.
- **CVI freshness:** Time since last successful agent run, per industry. SLO: <9 hours (vs. 8h schedule).
- **Error budget:** API 5xx rate; agent run failure rate; SSE disconnect rate. Targets: <0.1%; <2%; <5%.

### 14.3 Engineering KPIs

- **Build green rate:** % of main-branch CI runs green. Target: >95%.
- **Deploy frequency:** PRs to `main` per week. Target: ≥10.
- **Mean time to restore (MTTR):** P1 incident. Target: <2 hours.
- **Schema drift incidents:** Frontend/backend type mismatches caught at runtime. Target: 0 (Orval pipeline prevents).
- **Cost per agent run:** All-in cost (Perplexity + OpenRouter + Mem0) per cycle. Target: <$0.50.

---

## 15. Scope

### 15.1 In Scope (Q2 2026 baseline)

- Public catalogue browse (industries, capabilities, roles, ontology, white papers, leaderboard, thresholds)
- CVI live dashboard with SSE agent activity, history, methodology, manual admin refresh
- Capability Assessment flow (multi-step wizard with voice input, EDGAR autocomplete, document upload, AI-driven clarifying questions, WEF radar + roadmap output)
- Organisation create/read/update + session-token auth
- C-Suite Perspectives Hub (6 roles × 6 industries × seeded capabilities)
- Knowledge Graph (D3 force-directed)
- Technology Project Impact Analysis (catalogue + per-project impact + executive insights + risks)
- Insights, Educational Content, Featured Content (CMS-style, admin-managed)
- Enrichment pipeline (admin-triggered Perplexity → LLM synthesis (Claude Sonnet 4.6 default; cascades to Haiku → GLM 5.1 on credit errors) → DB)
- Marketplace: listings CRUD, sellers, KYC integration, purchases via Stripe, watermarked deliverables, auto-archive, moderation
- Memberships (Free, Professional, Enterprise) with Stripe Checkout, invoice/crypto via admin approval, NowPayments crypto IPN
- Admin surfaces: overview, content, assessments, agent runs, payments, review queue, foundry admin, case-study admin, educational content
- Health & observability: `/api/health`, `/api/health/services`, structured pino logging
- Hedera HCS audit anchoring for purchases + security violations (asynchronous, non-blocking)
- Multi-frontend artifacts: inflexcvi (main SPA), ce-pitch-deck, mockup-sandbox

### 15.2 Out of Scope (current release; tracked separately)

- Native mobile apps (web-mobile responsive only)
- Real-time multi-user collaborative editing (war-room is read-mostly; turn-based)
- Bring-your-own-LLM customisation
- Self-serve API key issuance for Data License tier (manual provisioning)
- Customer-deployable on-prem build
- Multi-region deployment / data residency controls
- Multi-language UI (English only)
- Programmatic CVI methodology overrides per-customer (Enterprise tier roadmap)

### 15.3 Explicit Non-Goals

- We are **not** a BI tool. We don't build dashboards over customer data; we deliver capability intelligence with optional embedding.
- We are **not** a GRC platform. We don't manage compliance workflows; we surface capability evidence that informs them.
- We are **not** a consulting firm. We don't bill hours; agent-generated content is the product. (Limited "consulting packages" are a sales accelerator, not a business line.)

---

## 16. Business Requirements (BR-001 …)

Numbering convention: `BR-NNN`. Each requirement carries a priority (M=Must, S=Should, C=Could, W=Won't this release), an owner (P=Product, E=Engineering, B=Business), and a verification reference (the page, route, or service that demonstrates it).

### 16.1 Capability Intelligence Core

- **BR-001** [M / P,E] The platform shall publish a continuously-updated Capability Value Index (CVI) per supported industry, with score, velocity, confidence, and 95% credible interval per component. *Verified at `/cei`, `GET /api/cei/current`.*
- **BR-002** [M / E] The CVI shall be recomputed by the autonomous agent at least every 8 hours under normal conditions; the system shall provide an urgency-watchdog mechanism that triggers refresh when confidence drops below 0.35, data age exceeds 10 days, or CVI changes >5 points. *Verified at `src/services/agent/scheduler.ts`.*
- **BR-003** [M / E] Each CVI component shall cite at least 3 distinct sources from heterogeneous research frames (consulting, market analysis, academic, practitioner). *Verified at `source_triangulations` records and `/cei/methodology`.*
- **BR-004** [M / P,E] Every top-level capability shall have 4–6 sub-capabilities auto-generated by Haiku 4.5 and refreshed by the rotation scheduler. Parents must roll up children's posteriors (weighted average) and never be directly triangulated. *Verified at `services/sub-capability-generator.ts` and `expandAffectedCapabilityIds`.*
- **BR-005** [M / P] The platform shall expose at least 6 industries and ≥60 capabilities at launch; sub-capabilities bring the addressable capability count to ≥300.
- **BR-006** [M / P] CVI scoring bands (Nascent / Developing / Advancing / Leading / Transformative) shall be consistent across UI, API, and reports.

### 16.2 Capability Assessment

- **BR-010** [M / P,E] Any organisation shall be able to complete a capability self-assessment in <15 minutes, producing a WEF radar chart with credible intervals, gap analysis, and 12-month roadmap. *Verified at `/assess`.*
- **BR-011** [M / P] Assessment input shall accept voice dictation (Web Speech API) on all free-text fields.
- **BR-012** [M / P] Assessment input shall accept document upload (PDF/DOCX, ≤5 MB) with client-side text extraction.
- **BR-013** [M / P] Assessment input shall support SEC EDGAR public-company lookup with two-pass search (quoted exact → unquoted partial).
- **BR-014** [M / P] Each completed assessment shall be persisted to the DB and indexed in user history.
- **BR-015** [M / P] Each completed assessment shall be sharable via a public URL token; printable as PDF; downloadable as JSON.
- **BR-016** [S / E] Each completed assessment shall trigger a Letta memory write to retain analytical context for future assessments.

### 16.3 C-Suite Perspectives

- **BR-020** [M / P] The platform shall produce role-translated perspectives for at least six C-Suite roles (CEO, CFO, COO, CTO, CHRO, CISO) per capability per industry.
- **BR-021** [M / E] Perspectives shall be cached in DB with a `generated_at` timestamp; cache TTL ≤48 hours.
- **BR-022** [S / P] Each perspective shall include headline, executive summary, strategic priorities, KPIs, and ROI metrics.

### 16.4 Knowledge Graph & Ontology

- **BR-030** [M / P,E] The platform shall render an interactive capability dependency graph (D3 force-directed) over the ontology.
- **BR-031** [M / E] Ontology relationships shall include explicit `strength` (0–1) used in economic-multiplier computation.
- **BR-032** [S / P] The graph shall support industry filtering and capability search.

### 16.5 Technology Project Impact Analysis

- **BR-040** [M / P] The platform shall catalogue technology project archetypes (AI adoption, cloud migration, mainframe modernisation, application rationalisation) with capability-impact mappings, timelines, and investment ranges.
- **BR-041** [M / P] Each project shall expose executive insights per role and a risk register.

### 16.6 Organization & Dashboard

- **BR-050** [M / P,E] Organisations shall be created with a single-step setup wizard returning a session token stored in `localStorage` (`ce_session_token`).
- **BR-051** [M / P] Capability scores shall be upserted in bulk with a single transactional call, validated by generated Zod schemas.
- **BR-052** [M / P] Dashboard shall produce role-filtered gap analysis vs. industry benchmarks.
- **BR-053** [S / P] CSV bulk import shall be supported for capability assessments via `customFetch` (escape hatch around the generated client's body wrapper).

### 16.7 Marketplace

- **BR-060** [M / P,E] Sellers shall be able to create listings (title, description, artifact, price, category) with media attachments stored under `MARKETPLACE_STORAGE_DIR`.
- **BR-061** [M / E] All sellers shall be KYC-verified via Didit before payouts are released.
- **BR-062** [M / E] Purchases shall complete via Stripe Checkout; on-success, watermarked deliverables shall be issued to the buyer's workspace.
- **BR-063** [M / E] Listings shall auto-archive 30 days after creation unless renewed; admin moderation queue surfaces flagged listings.
- **BR-064** [M / E] Every completed purchase shall produce an audit-chain entry anchored on Hedera HCS, with the topic ID and sequence number persisted in `audit_chain`.
- **BR-065** [M / E] The marketplace shall enforce take-rate via Stripe Connect destination charges (12–18% per category).
- **BR-066** [S / P] Buyers shall be able to dispute purchases via in-product flow; admin moderation resolves disputes within 7 days.

### 16.8 Membership & Payments

- **BR-070** [M / E] Three payment paths shall be supported: Stripe Card Checkout, Invoice/Crypto (admin-approved), Free tier (auto-active).
- **BR-071** [M / E] The Stripe webhook shall be mounted **before** `express.json()` so the raw body is available for signature verification.
- **BR-072** [M / E] The webhook handler shall be idempotent: it transitions `pending → active` only when current status is `pending`. It must never override an admin rejection.
- **BR-073** [M / E] `STRIPE_WEBHOOK_SECRET` shall be required in production; absence shall fail loudly at boot.
- **BR-074** [M / E] NowPayments crypto IPN shall update membership status via signed callback.
- **BR-075** [S / P] Admin shall be able to manually comp memberships with audit-log entry.

### 16.9 Autonomous Agent

- **BR-080** [M / E] The agent shall be implemented as a LangGraph DAG (`evaluate → decide → research → compute → memorize → finalize`).
- **BR-081** [M / E] Concurrency: only one agent run shall execute at a time; a mutex shall block overlapping runs.
- **BR-082** [M / E] Agent activity shall stream in real time to clients via SSE at `/api/agent/events`.
- **BR-083** [M / E] All external dependencies (Mem0, Letta, Perplexity) shall graceful-degrade: missing or unreachable services log a warning and disable the dependent feature, never crash the process.
- **BR-084** [M / E] Each agent run shall write a row to `agent_runs` with status, trigger, counters, before/after CVI, error message, timings.
- **BR-085** [M / E] Perplexity calls per run shall be capped at 6 (configurable) for cost control.

### 16.10 Admin & Review

- **BR-090** [M / E] All admin-protected routes shall require `x-admin-key: <ADMIN_API_KEY>` header; `ADMIN_AUTH_BYPASS=1` shall disable the check (local only; forbidden in production).
- **BR-091** [M / E] The review queue shall allow draft → review → approved/rejected workflow with notes per item.
- **BR-092** [M / P] Admin dashboards shall surface: overview KPIs, assessment list, content inventory, agent runs, payments, foundry ontology controls, case-study admin, educational-content CMS.

### 16.11 Integrations

- **BR-100** [M / E] The platform shall integrate with Clerk for authentication (multi-tenant readiness).
- **BR-101** [M / E] Stripe shall mediate cards and Connect payouts; NowPayments shall mediate crypto.
- **BR-102** [M / E] Resend shall deliver transactional emails; templates centralised in `services/email.ts`.
- **BR-103** [M / E] Hedera HCS shall anchor purchase + security audit chain.
- **BR-104** [M / E] Mem0 Cloud shall provide semantic memory; Letta shall provide stateful memory blocks; both graceful-degrade.
- **BR-105** [M / E] Perplexity Sonar Pro shall drive research; OpenRouter shall drive synthesis (Claude Sonnet 4.6 by default, overridable via `LLM_MODEL`, with Sonnet → Haiku → GLM 5.1 fallback on credit/budget errors) and the Anthropic-compatible Claude shim.

### 16.12 Education & Content

- **BR-110** [M / P] Admin shall manage educational content via CMS (CRUD + publish/unpublish).
- **BR-111** [S / P] Featured content surfaces on home and CVI pages.
- **BR-112** [S / P] White papers shall be curated with publisher, URL, date, relevance score.

### 16.13 Export, API, Embeds

- **BR-120** [S / P] Data License customers shall consume CVI history + components via REST + signed webhook.
- **BR-121** [S / P] Enterprise customers shall embed a CVI widget via signed iframe URL.
- **BR-122** [C / P] Enterprise customers shall export white-labelled PDF reports.

---

## 17. Non-Functional Requirements

### 17.1 Performance

- **NFR-P-01** P95 API latency <300 ms for read endpoints; <800 ms for assessment write.
- **NFR-P-02** SSE event delivery latency <500 ms from event emission to client receipt.
- **NFR-P-03** Frontend Time-to-Interactive <2 seconds on cold load (target devices: laptops with 4G/cable).
- **NFR-P-04** Agent run total wall time <10 minutes per cycle under normal load (6 capabilities × 4 Perplexity calls + downstream synthesis).

### 17.2 Availability & Reliability

- **NFR-R-01** API uptime ≥99.5% (Professional); ≥99.9% (Enterprise; contractual SLA).
- **NFR-R-02** Successful agent runs ≥98% of scheduled runs.
- **NFR-R-03** Mean Time To Restore (MTTR) <2 hours for P1 incidents.
- **NFR-R-04** No data loss in agent-run snapshot writes (DB transactional integrity).
- **NFR-R-05** Stripe webhook reliability: idempotent processing; replay-safe.

### 17.3 Security

- **NFR-S-01** All secrets via environment variables; no secrets in code or logs.
- **NFR-S-02** All admin routes require `x-admin-key` header verification.
- **NFR-S-03** Drizzle ORM parameterized queries only; no raw SQL with user input.
- **NFR-S-04** Stripe webhook signature verification mandatory in production.
- **NFR-S-05** All user-facing rendering escapes by default (React) — no `dangerouslySetInnerHTML` of model output.
- **NFR-S-06** Rate limiting on `/api/research` and other user-triggered expensive endpoints.
- **NFR-S-07** Hedera HCS audit entries for security-relevant actions (purchases, KYC, admin overrides).
- **NFR-S-08** No PII in AI pipeline; user-submitted PII flagged for the user before transmission to LLM.

### 17.4 Privacy & Data Handling

- **NFR-D-01** GDPR/CCPA support: organisation deletion via `DELETE /organizations/:token` purges all dependent rows within 24 hours.
- **NFR-D-02** Data Subject Access Requests fulfilled within 30 days.
- **NFR-D-03** No third-party analytics scripts (no Google Analytics, no Meta Pixel) on logged-in surfaces.
- **NFR-D-04** Marketplace IP: watermarked deliverables + Hedera anchor prove provenance.

### 17.5 Maintainability

- **NFR-M-01** TypeScript strict mode across all packages.
- **NFR-M-02** Frontend and backend types synchronised via Orval codegen — drift is a compile error.
- **NFR-M-03** No edits to generated code (`lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`); regenerate instead.
- **NFR-M-04** Catalogued dependencies via `pnpm-workspace.yaml` catalog — single-place version bumps.
- **NFR-M-05** PR review required for `main` merges; no force-push to `main`.

### 17.6 Observability

- **NFR-O-01** All requests logged with structured pino JSON: req ID, method, URL, status, duration.
- **NFR-O-02** Agent runs emit structured events for each phase; persisted in `agent_runs` and broadcast via SSE.
- **NFR-O-03** `/api/health` returns 200 with version metadata; `/api/health/services` returns per-integration status (mem0, letta, openrouter, anthropic, perplexity, foundry, stripe, clerk, demo_readiness).
- **NFR-O-04** Failed agent runs persist `error_message` and surface in `/admin/agent-runs`.

### 17.7 Cost

- **NFR-C-01** AI + infrastructure cost <1% of ARR at all stages.
- **NFR-C-02** Per-agent-run cost <$0.50 in normal operation.
- **NFR-C-03** Perplexity calls capped at 6/run to enforce upper bound on burst cost.

### 17.8 Accessibility

- **NFR-A-01** WCAG 2.1 AA compliance on logged-out marketing surfaces.
- **NFR-A-02** Keyboard navigation for all interactive elements.
- **NFR-A-03** Voice dictation as an alternative input modality for assessment forms.

### 17.9 Internationalisation (Future)

- **NFR-I-01** Strings centralised for future translation (interim: English only).
- **NFR-I-02** Date/number formatting via `Intl` APIs (locale-aware where possible).

---

## 18. Constraints & Assumptions

### 18.1 Hard Constraints

- **C-01** **pnpm enforced.** Root `preinstall` hook deletes `package-lock.json` / `yarn.lock` and exits if user-agent isn't pnpm. Never run `npm install` or `yarn`.
- **C-02** **No tests configured.** There is no test runner. Do not invent `pnpm test`. Validation relies on `tsc --noEmit`, manual exercise, and live probe endpoints.
- **C-03** **OpenAPI `info.title` is load-bearing.** Changing it breaks Orval's generated filenames. Do not modify.
- **C-04** **Generated code is read-only.** `lib/api-zod/src/index.ts` must contain only `export * from "./generated/api";`. Orval re-adds duplicate exports on each codegen run — always revert.
- **C-05** **Vite `BASE_PATH` defaults to `/`.** Anything else breaks SPA fallback routing for root deploys.
- **C-06** **API server requires `PORT`.** Throws on boot if unset.
- **C-07** **Mem0 header is `X-API-Key`.** The Mem0 Railway template doc incorrectly recommends `Authorization: Bearer`; v2.x rejects that as a JWT validation failure.
- **C-08** **Mem0 Docker image must be self-built.** Docker Hub `mem0/mem0-api-server` is arm64-only — incompatible with Railway amd64. Use the in-repo Dockerfile that installs `libpq5` (upstream forgets, causing crash on import).
- **C-09** **Letta requires LLM provider key on its service.** Without `OPENROUTER_API_KEY` (or another provider key), Letta returns `NOT_FOUND: Handle <model> not found, must be one of []` on agent runs.
- **C-10** **Stripe webhook order matters.** Must mount the webhook route before `express.json()` middleware.

### 18.2 Soft Constraints (Recommended Defaults)

- **C-20** Editing happens primarily on desktop Claude Code (CLI auth persists). Replit shells lose `gh` / `railway` auth between sessions.
- **C-21** Authoritative source-of-truth for env vars is Railway, not Replit Secrets. Replit-injected values are stale.
- **C-22** Agent integrations graceful-degrade. Never throw on missing optional keys.

### 18.3 Assumptions

- **A-01** Perplexity, Anthropic (via OpenRouter), and Mem0 maintain pricing within current order of magnitude.
- **A-02** Customers tolerate session-token auth in early product (pre-Clerk multi-tenant cutover).
- **A-03** A single-process Node.js API server is sufficient until ~500 concurrent users.
- **A-04** Hedera HCS anchoring remains asynchronous and best-effort — purchase flow does not block on Hedera success.
- **A-05** Railway remains the deployment target through Year 2; migration to other infra is feasible but not required.

---

## 19. Acceptance Criteria & Test Strategy

### 19.1 Acceptance Criteria Pattern

Each BR is verified via one of:

- **API smoke test** — `curl` against staging with documented expected response.
- **Live UI exercise** — feature reachable from production URL with documented click-path.
- **Health probe** — entry in `/api/health/services` returns `ok`.
- **Database state** — row presence with expected shape after triggering action.
- **Hedera anchor** — `audit_chain` row with non-null `topicId` and `sequenceNumber`.

### 19.2 Test Strategy (Pragmatic, given no test runner)

| Layer | Strategy |
|---|---|
| Type safety | `pnpm run typecheck` (root) — composite TS project references compile; per-artifact `tsc --noEmit` |
| Contract integrity | Orval codegen — frontend hooks and Zod validators regenerate from OpenAPI; drift is a compile error |
| Backend smoke | Manual `curl` per route + automated `GET /api/health/services` in CI (planned) |
| Frontend smoke | Manual exercise of golden paths; type-checked Storybook for components (planned) |
| Agent reliability | `/admin/agent-runs` shows run history with status; alarms on >5% failure rate (planned) |
| Marketplace | Sandbox Stripe + Didit + Hedera testnet flows; production has reduced surface for first 90 days |

### 19.3 Release Gates

- ✅ `pnpm run typecheck` clean
- ✅ `pnpm run build:deploy` clean
- ✅ `/api/health/services` all critical integrations `ok` on staging
- ✅ Manual exercise of golden paths (assessment, dashboard, marketplace purchase) on staging
- ✅ No open P1 incidents in last 24 hours
- ✅ Release notes drafted in `CHANGELOG.md` (or PR description for small changes)

---

## 20. Compliance & Regulatory Requirements

### 20.1 Data Protection

- **GDPR** — Lawful basis: contractual necessity (paying customers) + legitimate interest (Explorer free tier). DPA template available on request. Subject rights (access, rectification, erasure) honoured within 30 days.
- **CCPA** — Right to know, right to delete, right to opt-out of sale (we do not sell). Honored via `DELETE /organizations/:token` and explicit request flow.
- **Data minimisation** — No PII in AI pipeline; capability scores, names, industries only. Assessment text may contain PII at user discretion; flagged to user.

### 20.2 Payment Compliance

- **PCI DSS** — All card data handled by Stripe; we never store card numbers. PCI scope is Stripe-mediated.
- **AML / KYC** — Marketplace sellers must complete Didit KYC before payouts. KYC level B (identity + sanctions screening) minimum.
- **Sanctions screening** — Stripe and Didit perform sanctions checks; we honour blocked accounts.

### 20.3 Cryptocurrency / Crypto Payments

- **NowPayments** — IPN handling; signed callbacks; we do not custody crypto.
- **Tax reporting** — Stripe handles 1099-K issuance for U.S. sellers above threshold.

### 20.4 Audit Chain (Hedera)

- Purchase + security-violation events anchored to Hedera HCS topic.
- Topic ID, sequence number, consensus timestamp persisted in `audit_chain` table.
- Anchoring is asynchronous and best-effort — failures are logged but never block user flow.
- Use case: third-party verification of purchase provenance and security incident timeline.

### 20.5 IP Protection (Marketplace)

- All deliverables watermarked at download time (`marketplace-watermark.ts`).
- Provenance verifiable via Hedera anchor.
- Take-down procedure: 48-hour response to DMCA-style complaints; counter-notice supported.

### 20.6 Future Compliance (Not Yet In Scope)

- **SOC 2 Type II** — Required by enterprise buyers; targeted Q3 2026.
- **ISO 27001** — Considered post-Series A.
- **HIPAA** — Not in scope (no PHI handled).
- **FedRAMP** — Not in scope.

---

# PART III — FUNCTIONAL SPECIFICATION

## 21. Personas

### 21.1 Persona 1 — Sarah, VP Strategy (Professional Tier)

- **Company:** Mid-market insurer, $1.2B revenue, 800 employees.
- **Role:** Reports to CSO; owns annual strategic plan; manages capability investments across underwriting, claims, distribution.
- **Daily reality:** Drowning in McKinsey decks; can't quantify whether her firm's fraud detection is in the top quartile; presents capability assessments to board annually using consultants.
- **Frustration:** Consulting engagements cost $200K and the insight is stale before the deck is printed.
- **Goal with the platform:** Replace one consulting engagement per year. Have a benchmark she can cite in board meetings.
- **Conversion event:** First time she sees her firm's capability radar overlaid on industry average and identifies a 23-point gap on Claims Automation.
- **Primary surfaces:** `/dashboard`, `/assess`, `/cei`, `/case-study`.
- **Success signal:** Cites CVI in a board deck within 60 days of signup.

### 21.2 Persona 2 — Marcus, Chief Strategy Officer (Enterprise Tier)

- **Company:** Fortune 500 healthcare system, $18B revenue.
- **Role:** Reports to CEO; owns enterprise transformation portfolio ($300M/year).
- **Daily reality:** Manages relationships with McKinsey, Deloitte, in-house strategy team; juggles 12 simultaneous transformation initiatives.
- **Frustration:** No single source of truth for capability maturity; functional silos produce conflicting assessments.
- **Goal:** Continuous capability monitoring; one-pane-of-glass view across business units; faster transformation cycle time.
- **Conversion event:** First demo where the C-Suite Perspectives Hub renders the same capability for CFO, COO, CTO, CHRO simultaneously — eliminating internal-translation overhead.
- **Primary surfaces:** `/cei`, `/c-suite`, `/knowledge-graph`, white-labelled enterprise reports.
- **Success signal:** Renews at higher tier; champions data-licensing conversation with CFO.

### 21.3 Persona 3 — Priya, PE Operating Partner (Enterprise Tier — PE Vertical)

- **Firm:** Mid-cap PE firm, $4B AUM, 20 portfolio companies.
- **Role:** Drives portfolio-level operational improvement; sits on 4 portco boards.
- **Daily reality:** Each portco assessed differently; no cross-portfolio capability view; 100-day plans rely on intuition.
- **Frustration:** Capability gaps surface 18 months post-acquisition.
- **Goal:** Pre-deal capability diagnostic in <2 weeks; continuous monitoring across the portfolio.
- **Conversion event:** Multi-org dashboard showing 20 portcos colour-coded by CVI band and velocity.
- **Primary surfaces:** Multi-org dashboard (roadmap Q3 2026), `/cei`, exports.
- **Success signal:** Uses CVI in 100-day plan for next acquisition.

### 21.4 Persona 4 — David, Independent Strategy Consultant (Marketplace Seller)

- **Firm:** Solo consultant, 15 years at McKinsey, now independent.
- **Role:** Produces capability deep-dives for $50K–$200K engagements.
- **Goal:** Reach mid-market clients who can't afford McKinsey; productise his expertise.
- **Platform use:** Lists capability artifacts (sector deep-dives, custom assessment templates) on the marketplace; watermarked + Hedera-anchored for IP protection.
- **Success signal:** Three completed transactions/month.

### 21.5 Persona 5 — Hannah, Junior Strategy Analyst (Explorer Tier, then Professional)

- **Company:** Mid-market technology firm.
- **Role:** Reports to VP Strategy (Sarah-equivalent); does the analysis Sarah presents.
- **Daily reality:** Cobbles capability benchmarks from public reports, vendor whitepapers, intuition.
- **Goal:** Faster turnaround on capability questions her VP asks.
- **Conversion event:** Finishes a self-assessment in 12 minutes that would have taken her 2 weeks.
- **Primary surfaces:** `/assess`, `/insights`, `/knowledge-graph`, public catalogue.
- **Success signal:** Recommends Professional tier to Sarah for budget approval.

### 21.6 Persona 6 — Tom, Platform Admin / Engineer (Internal)

- **Role:** Founding engineer; on-call for production; reviews agent runs.
- **Goal:** Observe and steer agent behaviour; resolve customer issues fast.
- **Primary surfaces:** `/admin/overview`, `/admin/agent-runs`, `/admin/payments`, `/admin/review`, health endpoints, Railway dashboard.

---

## 22. End-to-End User Journeys

### 22.1 Journey 1 — Explorer Activation (Hannah)

1. Lands on `/` from a LinkedIn CVI Industry Report download.
2. Reads the value prop; clicks "Try the assessment" → routed to `/assess`.
3. Skips signup wall — assessment is publicly accessible for the first step.
4. Enters company name; EDGAR autocomplete suggests her firm; selects it.
5. Records voice answer to "What's the business opportunity?" (Web Speech API).
6. Uploads her firm's most recent 10-K (PDF, ~3 MB); client-side extracts text.
7. AI generates 6 clarifying questions; Hannah answers in 4 minutes.
8. Analysis renders: WEF radar with 7 axes; industry average overlay; confidence intervals.
9. Sees her firm trails industry on Innovation Capability by 18 points. **AHA.**
10. Prompted to save assessment → enters email; org + session token created server-side.
11. Sharable URL generated; she emails it to Sarah (her VP).
12. Sarah opens link, sees the analysis, books a Professional tier demo via in-app CTA.

**Instrumentation:** Funnel events at steps 1, 3, 7, 9, 10, 11, 12. Conversion target: 60% reach step 9; 15% reach step 10; 3% reach step 12 within 30 days.

### 22.2 Journey 2 — Professional Conversion & First Board Use (Sarah)

1. Receives Hannah's shared assessment; books demo via embedded CTA.
2. Demo focuses on `/dashboard` (gap analysis) and `/c-suite` (role translation).
3. Signs Professional contract; receives Stripe Checkout link.
4. Pays via card; webhook flips status `pending → active`; account provisioned within 30 seconds.
5. Onboarding email (Resend) directs Sarah to her dashboard.
6. Sarah completes a full enterprise assessment (uploads 10-K, strategy deck, current capability survey).
7. Letta memory write retains her firm's context for future sessions.
8. Sarah runs cross-industry comparison via `/knowledge-graph`.
9. Generates PDF export for board (roadmap Q3 2026 — interim: screenshots).
10. Board meeting: CVI score cited in capital-allocation discussion.
11. CFO asks: "Can we see this monthly?" → CSM scheduled for expansion conversation.

**Instrumentation:** Time from contract to first assessment (target <7 days); time from first assessment to first board use (target <60 days); upsell conversation triggered at 90 days for cohorts that complete ≥3 assessments.

### 22.3 Journey 3 — Enterprise Discovery → Close (Marcus)

1. Inbound from CVI Industry Report (Healthcare).
2. SDR qualifies; books CSO discovery call.
3. CSO discovery: pain points around portfolio-of-transformations.
4. Technical deep-dive: Marcus's CIO + CDO attend; explore `/cei`, `/c-suite`, embedding plan.
5. Procurement: DPA, SOC 2 questionnaire (interim: bridge letter; SOC 2 Type II Q3 2026), pricing negotiation.
6. Contract: 12-month, $360K ACV with white-labelled enterprise reports + API access.
7. Provisioning: dedicated CSM; configured industry verticals; SSO via Clerk.
8. 90-day pilot: agent configured for healthcare-specific capability taxonomy.
9. Quarterly business review (QBR): CSM presents adoption metrics, ROI evidence, expansion targets.

**Instrumentation:** Sales-cycle length (target 6–9 months); win rate (target 25%); discount % (target <15%); first-90-day adoption depth (assessments, dashboard sessions, API calls).

### 22.4 Journey 4 — Marketplace Purchase (Sarah → David)

1. Sarah browses marketplace from `/marketplace`.
2. Filters: "Insurance — Claims Automation — Deep Dive".
3. Finds David's listing ($1,200, last updated 14 days ago, 4.8★ from 12 buyers).
4. Reads preview (watermarked first 5 pages).
5. Clicks "Purchase" → Stripe Checkout; pays via card.
6. Webhook flips status `paid`; deliverable (full PDF, watermarked with Sarah's org name + timestamp) issued to her `/marketplace/workspace`.
7. Hedera HCS anchor entry written (asynchronously; topic ID + sequence number in `audit_chain`).
8. Email confirmation (Resend) with download link.
9. David sees payout in his seller dashboard; Stripe Connect transfers 85% to his bank account on T+2.
10. Sarah leaves a 5★ review; review surfaces on David's listing.

**Instrumentation:** Time from listing view → purchase (target <10 minutes for warm leads); take-rate revenue per active seller; chargeback rate (target <0.5%).

### 22.5 Journey 5 — Agent Lifecycle (System, observed by Tom)

1. Server boot → scheduler initialised → executes a startup run.
2. Routine timer fires every 30 minutes; checks for due research.
3. `evaluate` node: loads capabilities + recalls relevant Mem0 memories.
4. `decide` node: identifies stale or low-confidence capabilities for research.
5. `research` node: issues 4 Perplexity Sonar Pro queries per target.
6. `compute` node: Bayesian posterior update; writes `cei_snapshots` + `cei_components` + `source_triangulations`.
7. `memorize` node: stores typed memories in Mem0; mirrors to `agent_memories` for SQL queryability.
8. `finalize` node: writes `agent_runs` row; emits `agent_completed` SSE event.
9. Frontend `/cei` page receives SSE; updates dashboard without reload.
10. Tom watches the run unfold in `/admin/agent-runs`; if failure, error message visible in row; he investigates.

**Instrumentation:** Per-phase duration; total wall time; Perplexity call count; memories stored; CVI delta; failure rate per node.

---

## 23. Feature Catalogue

This section catalogues every shipped feature with its purpose, primary surface, key API endpoints, and behaviour notes. Organised by domain. Specific endpoint contracts are in Appendix C.

### 23.1 Public Catalogue

- **Industries Browse** — Surface: `/industries` (frontend) / `GET /api/industries`. Lists the 6 seeded industries with metadata (slug, description, GDP weight). Public, no auth.
- **Capability Catalogue** — `GET /api/capabilities?industryId=&roleSlug=`. Returns capabilities filterable by industry and C-Suite role. Includes benchmark scores, economic-value bands, category. Used by `/knowledge-graph` and `/assess`.
- **Roles Reference** — `GET /api/roles`. 8 C-Suite roles with descriptions (CEO, CFO, COO, CTO, CISO, CHRO, CMO, CSO).
- **Ontology Browse** — `GET /api/ontology`. Capability-to-capability semantic relationships with strength and relationship-type.
- **Thresholds Browse** — `GET /api/thresholds`. R/Y/G thresholds with source citations and rationale.
- **Data Sources Registry** — `GET /api/data-sources`. Citation registry (publisher, date, URL).
- **White Papers** — `GET /api/white-papers`. Curated research with publisher, URL, relevance score.
- **Industry Leaderboard** — `GET /api/leaderboard?industryId=`. Company benchmark rankings per industry per year.

### 23.2 CVI Intelligence

- **CVI Dashboard** — Surface: `/cei`. Live composite index with sentiment gauge, industry breakdown, agent activity stream, history charts.
- **CVI Current** — `GET /api/cei/current`. Returns active snapshot with components.
- **CVI History** — `GET /api/cei/history?industryId=&limit=`. Time-series; paginated.
- **CVI Components** — `GET /api/cei/components?snapshotId=`. Per-capability score breakdown with velocity, multiplier, confidence, weight, CI low/high.
- **CVI Methodology** — `GET /api/cei/methodology`. Public formula documentation.
- **CVI Refresh** — `POST /api/cei/refresh`. Admin-only manual recompute trigger.
- **CVI Backtest** — `GET /api/admin/backtest/history?limit=` + `POST /api/admin/backtest/run`. Admin-only: re-scores historical capability data against current methodology; persists results to `backtest_runs` with regression alerts (log-loss vs. rolling avg).

### 23.3 Capability Assessment

- **Assessment Wizard** — Surface: `/assess`. 3-step wizard (context → clarifying questions → analysis output).
- **EDGAR Search** — `GET /api/sec/search?q=`. SEC EDGAR autocomplete with two-pass search (quoted exact → unquoted partial).
- **Assessment Submit** — `POST /api/assess`. Persists assessment; runs Claude analysis; returns radar data + roadmap.
- **Assessment History** — `GET /api/assess/history?orgToken=`. User's prior assessments.
- **Shared Assessment** — `GET /api/assess/shared/:token`. Public read-only assessment view via share token.
- **Export Assessment** — `GET /api/assess/:id/export.json`. JSON export.

### 23.4 C-Suite Perspectives

- **Perspectives Hub** — Surface: `/c-suite`. Role-filtered view of capability perspectives.
- **All Perspectives** — `GET /api/csuite?industryId=&capabilityId=`. Filterable list.
- **Single Perspective** — `GET /api/csuite/:roleSlug?industryId=&capabilityId=`. Headline, executive summary, strategic priorities, KPIs, ROI metrics.
- **Perspective Regeneration** — Triggered by agent on capability score change >5 points; cached 48h.

### 23.5 Knowledge Graph

- **Graph Surface** — `/knowledge-graph`. D3 force-directed layout over ontology relationships.
- **Graph Data** — `GET /api/ontology` + `GET /api/capabilities`. Combined client-side into nodes + edges.
- **Industry Filter** — Client-side filter; no separate endpoint.

### 23.6 Technology Project Impact

- **Project Catalogue** — `/projects` + `GET /api/projects`.
- **Project Detail** — `GET /api/projects/:id`. Includes capability impacts (uplift %, implementation effort, time-to-value), executive insights per role, risk register.
- **Project Generation** — `POST /api/projects/generate` (admin-only). Agent-generated project archetype.

### 23.7 Organisation & Dashboard

- **Org Create** — `POST /api/organizations`. Returns session token (UUID v4); stored client-side in `localStorage` as `ce_session_token`.
- **Org Read** — `GET /api/organizations/:token`.
- **Org Update** — `PATCH /api/organizations/:token`.
- **Org Delete** (GDPR) — `DELETE /api/organizations/:token`. Cascading purge of dependent rows; idempotent.
- **Capabilities Assess (Bulk)** — `POST /api/capabilities/assess`. Bulk upsert; transactional; unique constraint on `(org_id, capability_id)`.
- **CSV Upload** — `POST /api/capabilities/upload-csv`. Multipart; uses `customFetch(getUploadCsvUrl(...))` because generated `uploadCsv` wraps body in `JSON.stringify`.
- **Dashboard** — `GET /api/dashboard?token=&role=`. Role-filtered gap analysis. Hook signature: `useGetDashboard(sessionToken, params?, options?)`.

### 23.8 Marketplace

- **Listings Browse** — Surface: `/marketplace`. Filterable by industry, capability, category.
- **Listing Detail** — Surface: `/marketplace/listing/:id`. Includes seller bio, watermarked preview, reviews.
- **Sell Flow** — Surface: `/marketplace/sell`. Seller onboarding + listing creation. Requires KYC pass.
- **Buyer Workspace** — Surface: `/marketplace/workspace`. Purchased deliverables; watermarked PDFs; chat with seller (planned).
- **Listings CRUD** — `GET /api/marketplace/listings`, `POST /api/marketplace/listings`, `PATCH /api/marketplace/listings/:id`, `DELETE /api/marketplace/listings/:id`.
- **Sellers** — `GET/POST/PATCH /api/marketplace/sellers`.
- **Purchases** — `POST /api/marketplace/purchases` (creates Stripe Checkout Session); `GET /api/marketplace/purchases?buyerToken=`.
- **Workspace** — `GET /api/marketplace/workspace?buyerToken=`. Lists purchased artifacts.
- **Watermarking** — `services/marketplace-watermark.ts`. Per-purchase watermark generated at download (buyer org, timestamp, transaction ID).
- **Auto-Archive** — `services/marketplace-auto-archive.ts`. Cron job marks listings older than 30 days as archived unless renewed.
- **Seed** — `services/marketplace-seed.ts`. Boot-time seed of 15 listings (env-var gated).
- **Moderation** — Component: `marketplace-moderation.tsx`. Admin reviews flagged listings.
- **KYC** — `POST /api/kyc/start`, `POST /api/kyc-webhook` (Didit callback). Sellers must reach KYC level B before payouts.

### 23.9 Membership & Payments

- **Tiers** — `GET /api/membership/tiers`. Lists Free / Professional / Enterprise.
- **Tier Patch (Admin)** — `PATCH /api/membership/tiers/:id`.
- **My Membership** — `GET /api/me/membership`.
- **Card Checkout** — `POST /api/me/membership/checkout`. Creates pending row + Stripe Checkout Session; returns `checkoutUrl`.
- **Stripe Webhook** — `POST /api/stripe/webhook`. Mounted before `express.json()`. Verifies signature. Idempotent `pending → active` transition.
- **NowPayments Webhook** — `POST /api/nowpayments-webhook`. Crypto IPN; signed.
- **Admin Payments** — `GET /api/admin/payments`, `POST /api/admin/payments/:id/approve`, `POST /api/admin/payments/:id/reject`, `POST /api/admin/payments/:id/comp`.
- **Subscriptions** — `GET /api/subscriptions`. Read-only subscription state.

### 23.10 Autonomous Agent Surface

- **Agent Status** — `GET /api/agent/status`. Scheduler state, mutex state, last-run stats.
- **Agent History** — `GET /api/agent/history?limit=`. Run history with timing and errors.
- **Agent Memories** — `GET /api/agent/memories?limit=`. Paginated Mem0 + DB-mirrored memories.
- **Agent Tools Health** — `GET /api/agent/tools`. Integration health (Mem0, Perplexity, Letta).
- **Agent Events (SSE)** — `GET /api/agent/events`. Server-Sent Events stream; lifecycle + phase events.
- **Scheduler Controls (Admin)** — `POST /api/agent/scheduler/start`, `POST /api/agent/scheduler/stop`.
- **Run Ontology (Admin)** — `POST /api/agent/run-ontology`. Manual ontology re-derivation.

### 23.11 Enrichment Pipeline

- **Trigger Run (Admin)** — `POST /api/enrichment/run?phase=`. Phases: `quadrants`, `value_chain`, `companies`.
- **Run Status** — `GET /api/enrichment/status`.
- **Quadrants** — `GET /api/enrichment/quadrants?industryId=`.
- **Value Chain** — `GET /api/enrichment/value-chain?industryId=`.
- **Companies** — `GET /api/enrichment/companies?industryId=`.
- **Concurrency** — Lock in `enrichment_runs`; prevents simultaneous runs.

### 23.12 Alpha (Power-User Analysis Tools)

- **Alpha Enrich (Admin)** — `POST /api/alpha/enrich`. On-demand deep enrichment for a single capability.
- **Alpha Enrich Detail (Admin)** — `POST /api/alpha/enrich-detail`.
- **Alpha Thesis (Admin)** — `POST /api/alpha/thesis`. Generates investment thesis for a capability/industry pair.

### 23.13 Insights, Education, Content

- **Insights Browse** — Surface: `/insights`. Mixed AI-generated + seeded insights.
- **Insights Generate (Admin)** — `POST /api/insights/generate?capabilityId=`.
- **Educational Content CMS (Admin)** — `GET/POST/PATCH/DELETE /api/admin/educational-content[/:id]`.
- **Featured Content** — `GET /api/featured-content`. Home/CVI surface highlights.

### 23.14 Case Studies

- **Case Studies List** — `GET /api/case-studies`.
- **Case Study Detail** — `GET /api/case-studies/:slug`.
- **Generate (Admin)** — `POST /api/case-studies/generate`. Agent-produced; persists to `case_study_content`.
- **Delete (Admin)** — `DELETE /api/admin/case-studies/:id`.

### 23.15 Research & Disruption

- **Research (Admin)** — `POST /api/research`. On-demand Perplexity query.
- **Disruption** — `GET /api/disruption?industryId=`. Disruption indicators.
- **Disruption Patterns** — `GET /api/disruption-patterns`. Pattern catalogue.
- **Disruption Watch** — `GET /api/disruption-watch`. Subscribable disruption alerts.
- **Macro Events** — `GET /api/macro-events`. Events affecting capabilities; expanded bidirectionally via `expandAffectedCapabilityIds`.

### 23.16 Comparative & Decision Tools

- **Compare** — `GET /api/compare?capabilityIds=`. Side-by-side comparison.
- **Companies** — `GET /api/companies`. Public company directory.
- **Benchmarking** — `GET /api/benchmarking?industryId=&capabilityId=`.
- **Stack Optimizer** — `POST /api/stack-optimizer`. Optimisation suggestions for a capability stack.
- **Innovation Pipeline** — `GET /api/innovation-pipeline`. Pipeline-stage view.
- **Ideation** — `POST /api/ideation`. Idea-generation helper.
- **Simulation** — `POST /api/simulation`. What-if projections.
- **Trade Signals** — `GET /api/trade-signals`. CVI-derived trade-style signals for data-license customers.
- **Watchlist** — `GET/POST/DELETE /api/watchlist`. User-curated capability watchlist.

### 23.17 Collaboration & War Room

- **War Room** — Surface: `/war-room`. Live cross-org capability deliberation (read-mostly initially).
- **Collaboration** — `GET/POST /api/collaboration`. Shared-session primitives.
- **Peer Co-Op** — `GET /api/peer-coop`. Anonymous peer benchmarking pool.

### 23.18 Audit, Proof, KYC, Coverage

- **Audit Log** — `GET /api/audit-log?orgToken=`. Per-org action history.
- **Audit Chain** — Persisted in `audit_chain` table; Hedera HCS topic ID + sequence number; surfaced in `/admin/audit-chain` (Hedera explorer UI).
- **Proof** — `GET /api/proof/:id`. Anchored-proof verification for marketplace artifacts.
- **KYC** — see §23.8.
- **Coverage** — `GET /api/coverage?industryId=`. Capability-coverage telemetry.
- **Source Quality** — `GET /api/source-quality`. Citation-quality scoring.

### 23.19 Embed, Export, API Keys, Credits, Usage, Metrics

- **Embed** — `GET /api/embed/cei?widgetId=&signature=`. Signed iframe URL for embeddable CVI widget.
- **Exports** — `GET /api/exports/:id`. PDF / JSON / CSV exports.
- **API Keys** — `GET/POST/DELETE /api/api-keys`. Self-serve API key management for Data License tier (manual provisioning today).
- **Credits** — `GET /api/credits`. Per-org usage credits.
- **Usage** — `GET /api/usage`. Usage telemetry.
- **API Volume** — `GET /api/api-volume`. Volume metrics for Data License monitoring.
- **Metrics** — `GET /api/metrics`. Prometheus-style metrics (planned).

### 23.20 Admin Surfaces (Aggregated)

- **Admin Overview** — `GET /api/admin/overview`. KPIs panel.
- **Admin Assessments** — `GET /api/admin/assessments`.
- **Admin Content** — `GET /api/admin/content`.
- **Admin Agent Runs** — `GET /api/admin/agent-runs`.
- **Admin Trigger** — `POST /api/admin/trigger/:tool`. Manual tool invocation.
- **Admin Models** — `GET /api/admin/models`. LLM model registry.
- **Admin Payments** — (see §23.9).
- **Admin Security** — `GET /api/admin-security/*`. Security incident log; Hedera anchor verifications.
- **Foundry Admin** — `GET /api/foundry-admin/*`. Ontology controls.
- **Review Queue** — `POST /api/review/draft`, `GET /api/review/queue`, `POST /api/review/:id/retry`, `POST /api/review/:id/approve`, `POST /api/review/:id/reject`, `GET /api/review/:id/notes`.
- **Impersonate** — `POST /api/impersonate`. Admin impersonation for support.

### 23.21 V1 Public API (Data License)

- **`GET /api/v1/cei`** — Programmatic CVI access for Data License customers; auth via API key in `x-api-key` header.
- **`GET /api/v1/capabilities`** — Capability registry export.
- **`GET /api/v1/companies`** — Company directory export.
- **`GET /api/v1/snapshots?since=`** — Incremental snapshot pull for webhook-style consumers.

### 23.22 Notifications & Digests

- **Digests** — `GET /api/digests?orgToken=`. Weekly digest queue.
- **Onboarding Emails** — Triggered by `services/email.ts` (Resend transactional emails).

### 23.23 Health & Operations

- **Health** — `GET /api/health`. 200 + version metadata.
- **Health Services** — `GET /api/health/services`. Per-integration probe results.
- **Probes** (internal) — `services/health/probes.ts`. One probe per integration (mem0, letta, openrouter, anthropic, perplexity, foundry, stripe, clerk, demo_readiness).

---

## 24. UI/UX Specification

### 24.1 Design-System Foundation

- **Color tokens** — semantic-only (`--background`, `--primary`, `--foreground`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--card`, `--popover`). No Tailwind colour utilities (`bg-emerald-500`, `text-blue-700`) anywhere in the codebase.
- **Primary accent** — `hsl(244 47% 50%)` indigo. Conveys institutional reliability without the over-used blue of financial services.
- **HSL format** — Space-separated values without `hsl()` wrapper (e.g. `244 47% 50%`). This is load-bearing for Tailwind v4's CSS-variable model.
- **Typography hierarchy** — Headings: Playfair Display (serif, editorial authority). Body: Outfit (sans-serif, technical clarity). Data labels: Outfit Mono (monospace, numeric precision). Google Fonts `@import` must be the **first line** of `index.css`.
- **Shape language** — Square / minimally-rounded corners (`rounded-none`, `rounded-sm`). High-information density. Minimal decorative elements. Aesthetic target: CFO who has seen enough rounded-corner SaaS dashboards.
- **Iconography** — Lucide React; consistent stroke system.
- **Animation** — Framer Motion; spring physics; layout animations on data state changes.
- **Charts** — Recharts; composable; Recharts radar for capability views; LineChart for CVI history and backtest trends.

### 24.2 Page-by-Page Specification (Frontend `artifacts/inflexcvi/`)

| Route | Primary purpose | Key components | Refresh strategy | Notes |
|---|---|---|---|---|
| `/` | Landing + value prop | Hero + real-estate analogy + Mem0 institutional memory section | staleTime: 2 min | Public |
| `/cei` | Live CVI dashboard | Sentiment gauge, industry breakdown, agent activity SSE, history line chart | SSE + staleTime: 30 s | Public read; SSE keeps it live |
| `/assess` | Capability assessment wizard | Multi-step form, voice dictation, EDGAR autocomplete, document upload, WEF radar output | staleTime: 24 h on catalogue data | Anonymous start; saved via session token |
| `/case-study` | Insurance case study | Capability cards, 5-yr ROI line chart, implementation timeline | staleTime: 1 h | AI-generated content |
| `/c-suite` | C-Suite perspectives | Role × industry × capability matrix; tabbed by role | staleTime: 1 h | Public |
| `/knowledge-graph` | Capability dependency graph | D3 force-directed; industry filter; capability search | staleTime: 24 h | Public |
| `/projects` | Technology project catalogue | Project cards filtered by category; per-project drawer with impacts + risks | staleTime: 24 h | Public |
| `/insights` | Insights, leaderboard, white papers | Tabbed; AI + seeded insights | staleTime: 30 min | Public |
| `/organization` | Org setup wizard | Single-step; returns session token | n/a | Session-bound |
| `/dashboard` | Personalised gap analysis | Role-filtered radar + roadmap | staleTime: 5 min | Session-bound |
| `/marketplace` | Listing browse | Filter sidebar; listing cards | staleTime: 60 s | Public read |
| `/marketplace/listing/:id` | Listing detail | Preview, seller bio, reviews, "Purchase" CTA | staleTime: 60 s | Public read |
| `/marketplace/sell` | Seller onboarding + listing creation | Multi-step (KYC gate → listing form) | n/a | Auth-gated |
| `/marketplace/workspace` | Buyer workspace | Purchased artifacts, watermarked PDFs | staleTime: 30 s | Auth-gated |
| `/workbench` | Custom analysis workbench | Workspace for building capability assessments | n/a | Auth-gated |
| `/war-room` | Live cross-org deliberation | Read-mostly initially; turn-based collaboration | staleTime: 10 s | Auth-gated |
| `/backtest` | CVI methodology backtest dashboard | TrendChart (Brier + log-loss), regression alert | n/a | Admin-only |
| `/system-status` | System status (public) | Health table; latency badges | staleTime: 30 s | Public |
| `/admin/*` | Admin surfaces | (see §23.20) | varies | Admin-gated |

### 24.3 Component Library

- **Built on shadcn/ui (Radix primitives + Tailwind)** — accessible primitives, unstyled base, fully Tailwind-compatible.
- **Custom components** — `marketplace-nav.tsx`, `marketplace-moderation.tsx`, `case-study-admin.tsx`, `layout.tsx` (shared shell).
- **State management** — TanStack Query for server state; React hooks for local UI state; `localStorage` for session token + industry id.

### 24.4 Accessibility

- WCAG 2.1 AA on public marketing surfaces.
- Keyboard navigation for all interactive elements (Radix primitives provide).
- Voice dictation as alternative input on `/assess`.
- All charts have an underlying data-table fallback for screen readers (planned; currently visual only).

### 24.5 Mobile Responsiveness

Mobile responsive pass completed across all surfaces (commits `Task #40` series). Strategy: stack columns, collapse navigation, preserve all functionality. Charts shrink with container queries.

---

## 25. Data Flow Specification

### 25.1 CVI Refresh Flow

```
Scheduler (every 30 min)  ─┐
Urgency Watchdog          ─┤  triggers
Admin POST /cei/refresh   ─┘
                              │
                              ▼
                       Agent.evaluate ──► Mem0 recall
                              │
                              ▼
                       Agent.decide   (which capabilities to research)
                              │
                              ▼
                       Agent.research  ──► Perplexity (×4 per capability)
                              │
                              ▼
                       Agent.compute   ──► Bayesian posterior + EMA velocity
                              │              │
                              │              ▼
                              │           Drizzle: insert cei_snapshots
                              │                   + cei_components
                              │                   + source_triangulations
                              ▼
                       Agent.memorize ──► Mem0.store + mirror to agent_memories
                              │
                              ▼
                       Agent.finalize ──► Drizzle: insert agent_runs
                              │
                              ▼
                       SSE broadcast (cei_updated, agent_completed)
                              │
                              ▼
                       Frontend /cei live-updates without reload
```

### 25.2 Assessment Flow

```
User submits /assess form (step 3)
        │
        ▼
POST /api/assess  (validated by generated Zod schema)
        │
        ├─► Drizzle: insert assessments row (status: in_progress)
        │
        ├─► Claude (via OpenRouter shim): synthesise analysis
        │       Structured JSON output with retry-on-parse-fail
        │
        ├─► Drizzle: update assessments (status: complete; payload: JSONB)
        │
        ├─► Letta.store_memory (best-effort; non-blocking)
        │
        └─► Response: { assessmentId, radarData, roadmap, shareToken }
        │
        ▼
Frontend renders WEF radar + roadmap; shows share URL
```

### 25.3 Marketplace Purchase Flow

```
Buyer clicks "Purchase" on /marketplace/listing/:id
        │
        ▼
POST /api/marketplace/purchases  (creates pending row)
        │
        ├─► Stripe: create Checkout Session (destination charges to seller's connected account; platform take-rate retained)
        │
        └─► Response: { checkoutUrl }
        │
        ▼
Browser redirects to Stripe Checkout
        │
        ▼
Buyer pays
        │
        ▼
Stripe POSTs /api/stripe/webhook (raw body; signature verified)
        │
        ├─► Idempotent: only act if purchase.status === 'pending'
        │
        ├─► Drizzle: update purchases (status: paid)
        │
        ├─► marketplace-watermark: generate watermarked deliverable
        │
        ├─► Resend: send buyer confirmation email
        │
        └─► Hedera HCS: anchor purchase event (asynchronous, best-effort)
                │
                ▼
        Drizzle: insert audit_chain row (topicId, sequenceNumber, consensusTimestamp)
        │
        ▼
Buyer's /marketplace/workspace shows new artifact on next poll
```

### 25.4 Membership Activation Flow

```
User selects Professional tier on /pricing
        │
        ▼
POST /api/me/membership/checkout
        │
        ├─► Drizzle: insert user_memberships row (status: pending)
        │
        └─► Stripe: create Checkout Session; return checkoutUrl
        │
        ▼
Browser redirects to Stripe Checkout; user pays
        │
        ▼
Stripe POSTs /api/stripe/webhook
        │
        ├─► verifyWebhookSignature (STRIPE_WEBHOOK_SECRET required in prod)
        │
        └─► Idempotent transition: pending → active (only if currently pending)
                    paymentStatus → paid
        │
        ▼
Frontend re-queries GET /api/me/membership; tier active
```

### 25.5 Agent Event Streaming

```
Agent node emits event ─► events.publish(event)
                              │
                              ▼
                  In-process subscriber list (Set<Response>)
                              │
                              ▼
        For each connected SSE client: res.write("data: ...\n\n")
                              │
                              ▼
                  Frontend EventSource onmessage → state update
```

**Reliability:** Heartbeat event every 30 seconds keeps proxies from closing idle connections. Reconnect-on-error in `EventSource` client. At multi-process scale, replace in-process pub/sub with Redis pub/sub (see §42.3).

---

## 26. API Contract Surface

All API contracts are authoritatively defined in `lib/api-spec/openapi.yaml`. The OpenAPI 3.1 document is the **single source of truth**; both backend validation (Zod schemas in `@workspace/api-zod`) and frontend hooks (TanStack Query in `@workspace/api-client-react`) are generated from it via Orval.

**Codegen invariants:**

- `pnpm --filter @workspace/api-spec run codegen` regenerates both packages.
- **Never** edit files under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`.
- `lib/api-zod/src/index.ts` must contain **only** `export * from "./generated/api";`. Orval re-adds a duplicate export on every regeneration — always revert.
- Do not modify OpenAPI `info.title` — it controls generated filenames.

**Escape hatches:**

- `customFetch` from `@workspace/api-client-react` — used when generated hooks don't fit. Example: CSV upload uses `customFetch(getUploadCsvUrl(...))` directly because the generated `uploadCsv` wraps the body in `JSON.stringify`.

**Frontend conventions:**

- Some pages hardcode `const API_BASE = "/api"` and call `fetch` directly instead of going through `customFetch` or generated hooks. When changing the API base URL, grep for `API_BASE` — `setBaseUrl()` alone won't redirect those calls.
- Session token in `localStorage` as `ce_session_token`; industry id as `ce_industry_id`.
- Hook signatures:
  - `useUpsertAssessments()` takes no args; the mutation receives `{ sessionToken, data }`.
  - `useGetDashboard(sessionToken, params?, options?)`.

A complete endpoint catalogue is in Appendix C.

---

# PART IV — TECHNICAL ARCHITECTURE

## 27. System Overview

### 27.1 What This System Is

A full-stack intelligence platform that autonomously researches, scores, and advises on the economic value of organizational capabilities across industries. The platform operationalizes Resource-Based View, Dynamic Capabilities, and Core Competencies theory — transforming qualitative capability assessments into quantifiable economic signals via Bayesian inference over heterogeneous external sources.

### 27.2 Four Hard Problems Solved Simultaneously

| Problem | Solution |
|---|---|
| **Signal triangulation** — how to construct a reliable point estimate when ground-truth doesn't exist | Bayesian consensus over heterogeneous Perplexity-sourced evidence with conjugate-Gaussian posterior |
| **Temporal dynamics** — how to model velocity from infrequent, noisy measurements | Exponential Moving Average (α=0.7) with adaptive decay; analogous to a Kalman filter under stationary noise |
| **Cross-industry comparability** — how to compare Healthcare vs. Manufacturing capabilities under different market conditions | GDP-weighted normalisation with industry-specific maturity priors |
| **Institutional memory** — how to accumulate insight across autonomous cycles without human intervention | Persistent semantic memory via Mem0 Cloud with typed memory classifications; Letta for stateful core blocks |

### 27.3 System Topology (Production)

```
                          ┌─────────────────────────────────────┐
                          │           Railway Project           │
                          │       "Inflexcvi"        │
                          ├─────────────────────────────────────┤
                          │                                     │
   Browser ◄───HTTPS─────►│  inflexcvi (api-server)   │
                          │  ├─ Express 5 (port: $PORT)         │
                          │  ├─ Static SPA fallback             │
                          │  ├─ LangGraph agent (in-process)    │
                          │  └─ pino logging                    │
                          │                                     │
                          │  letta-2EOT                         │
                          │  └─ stateful memory blocks          │
                          │                                     │
                          │  Mem0                               │
                          │  ├─ uvicorn (port 8000)             │
                          │  └─ X-API-Key auth                  │
                          │                                     │
                          │  Postgres (Railway plugin)          │
                          │  ├─ DATABASE_URL → api-server       │
                          │  └─ Drizzle ORM                     │
                          │                                     │
                          │  pgvector (Railway plugin)          │
                          │  └─ vector store for Mem0           │
                          │                                     │
                          │  Neo4j Graph (Metal-Ready)          │
                          │  └─ ontology graph (future)         │
                          └─────────────────────────────────────┘
                                       │
                                       │ outbound HTTPS
                                       ▼
                          ┌─────────────────────────────────────┐
                          │       External integrations         │
                          ├─────────────────────────────────────┤
                          │  Perplexity Sonar Pro               │
                          │  OpenRouter (Sonnet→Haiku→GLM5.1)   │
                          │  Anthropic (direct, if configured)  │
                          │  Stripe + Stripe Connect            │
                          │  Clerk (auth)                       │
                          │  Resend (email)                     │
                          │  NowPayments (crypto IPN)           │
                          │  Didit (KYC)                        │
                          │  Hedera HCS (audit anchoring)       │
                          │  SEC EDGAR (public filings)         │
                          └─────────────────────────────────────┘
```

---

## 28. Monorepo & Build System

### 28.1 Repository Layout

```
workspace/                         # pnpm monorepo root (pnpm@10.26.1)
├── artifacts/
│   ├── api-server/                # Express 5 API + agent runtime
│   ├── inflexcvi/      # React 19 + Vite SPA (main product)
│   ├── ce-pitch-deck/             # pitch deck frontend
│   └── mockup-sandbox/            # component preview
├── lib/
│   ├── db/                        # Drizzle schema + pg Pool
│   ├── api-spec/                  # OpenAPI 3.1 (source of truth) + Orval config
│   ├── api-zod/                   # generated Zod validators (never edit)
│   ├── api-client-react/          # generated TanStack Query hooks + customFetch
│   ├── integrations-anthropic-ai/ # OpenRouter-backed Anthropic shim
│   └── integrations/              # other integration packages
├── scripts/                       # seeders, Perplexity client, backfills
├── mem0/                          # Mem0 Dockerfile (self-built; installs libpq5)
├── letta/                         # Letta Dockerfile
├── docs/                          # documentation (incl. this file)
├── .claude/                       # Claude Code settings, preflight, hooks
├── railway.json + nixpacks.toml   # deploy config
├── pnpm-workspace.yaml            # workspace + version catalog
└── CLAUDE.md                      # Claude Code instructions (authoritative)
```

### 28.2 TypeScript Project References

The root `tsconfig.json` is a **solution file** with project references to the four `lib/*` packages requiring declaration emit (`db`, `api-spec`, `api-zod`, `api-client-react`, `integrations-anthropic-ai`).

- `pnpm run typecheck:libs` runs `tsc --build` on the solution.
- Per-artifact `typecheck` scripts then run `tsc -p tsconfig.json --noEmit` inside each artifact.
- `composite: true` + `declarationMap: true` enable incremental compilation.

### 28.3 pnpm Workspace + Catalog

- pnpm enforced via root `preinstall` hook that deletes `package-lock.json` / `yarn.lock` and exits if user-agent isn't pnpm.
- Shared dependency pinning via `pnpm-workspace.yaml` catalog section. React, Vite, Tailwind, Drizzle, Zod, tsx are `"catalog:"` — single-place version bumps.
- Note: `zod: 3.25.76` in the catalog, but **import from `zod/v4`** in code consuming generated schemas (Orval uses Zod v4 API).

### 28.4 Codegen Pipeline (OpenAPI → Generated)

`lib/api-spec/openapi.yaml` is authoritative. `pnpm --filter @workspace/api-spec run codegen` runs Orval and produces:

1. `lib/api-client-react/src/generated/api.ts` — TanStack Query hooks + fetch wrappers
2. `lib/api-zod/src/generated/api.ts` — Zod schemas used by backend for request validation

**Generated-code invariants:**

- Never modify generated files.
- `lib/api-zod/src/index.ts` must contain only `export * from "./generated/api";`. Orval re-adds a duplicate re-export; revert every time.
- Do not change OpenAPI `info.title` — it controls generated filenames.

### 28.5 Build Targets

| Script | What it does |
|---|---|
| `pnpm run typecheck` | tsc --build for libs + per-artifact tsc --noEmit |
| `pnpm run build` | typecheck + `pnpm -r run build` (all packages) |
| `pnpm run build:deploy` | libs + inflexcvi + api-server only (Railway build) |
| `pnpm run start` | runs api-server (which also serves built SPA) |
| `pnpm --filter @workspace/api-server run dev` | NODE_ENV=development, build + start |
| `pnpm --filter @workspace/api-server run build` | esbuild → `artifacts/api-server/dist/index.mjs` |
| `pnpm --filter @workspace/inflexcvi run build` | `vite build` → `dist/public` |
| `pnpm --filter @workspace/api-spec run codegen` | regenerate api-client-react + api-zod from openapi.yaml |
| `cd lib/db && npx drizzle-kit push --force` | push schema changes (dev only) |

There is **no test runner configured in any package** — do not invent `pnpm test`.

### 28.6 Build Pipeline (Production)

```
pnpm run build:deploy
    │
    ├── pnpm run typecheck:libs
    │   └── tsc --build (TypeScript project references)
    │       Compiles: lib/db, lib/api-spec, lib/api-client-react,
    │                 lib/api-zod, lib/integrations-anthropic-ai
    │       Output: declaration files (.d.ts) + source maps
    │
    ├── pnpm --filter @workspace/inflexcvi run build
    │   └── vite build
    │       Input: src/main.tsx
    │       Output: artifacts/inflexcvi/dist/public/
    │       Chunks: vendor chunk (React, Recharts), route chunks (code-split)
    │       Asset hashing: [name]-[hash].js for cache busting
    │
    └── pnpm --filter @workspace/api-server run build
        └── node build.mjs
            └── esbuild({
                  entryPoints: ['src/index.ts'],
                  bundle: true,
                  platform: 'node',
                  target: 'node22',
                  format: 'esm',
                  outfile: 'dist/index.mjs',
                  sourcemap: true
                })
            + esbuild-plugin-pino (transports as sibling pino-*.mjs)
            + externalize native/unbundleable packages (see build.mjs)
```

---

## 29. Backend Architecture

### 29.1 Runtime Characteristics

| Attribute | Value |
|---|---|
| Framework | Express 5.x (native async error propagation) |
| Process model | Single Node.js process; event-loop concurrent |
| Port binding | `process.env.PORT` (throws if unset) |
| Logging | pino structured JSON; pino-pretty in development |
| Request validation | Zod middleware via `@workspace/api-zod` on all routes |
| ORM | Drizzle ORM with pg driver (max 10 connections) |
| Background work | `setInterval` scheduler in same process |
| SSE | Native Node.js `res.write()` with `text/event-stream` MIME |
| Bundle output | Single `dist/index.mjs` via esbuild (~5 MB) |

### 29.2 Boot Sequence

1. `src/index.ts` reads `process.env.PORT` (throws on missing).
2. Builds the Express app via `src/app.ts`.
3. `app.use("/api", router)` mounts all routes under `/api`.
4. When a built frontend bundle is resolvable, mounts it statically with a non-`/api` SPA fallback.
   - Resolution order: `FRONTEND_DIST_PATH` env → `$cwd/artifacts/inflexcvi/dist/public` → `__dirname/../../inflexcvi/dist/public`.
   - Missing bundle is non-fatal: server logs a warning and runs API-only.
5. `app.listen(PORT, callback)` — callback invokes `startScheduler()`.
6. Scheduler runs `executeRun("startup")` immediately, then schedules routine (every 30 min) + urgency watchdog (every 5 min).

### 29.3 Route Taxonomy (Mount Tree)

All routes mount under `/api`. Categorised:

```
/api
├── Public catalogue          (industries, capabilities, roles, ontology, …)
├── CVI Intelligence          (cei/*, including methodology, history)
├── Capability Assessment     (assess/*, sec/*)
├── C-Suite Perspectives      (csuite/*)
├── Knowledge Graph           (ontology, knowledge-graph)
├── Technology Projects       (projects/*)
├── Organisation & Dashboard  (organizations/*, dashboard, capabilities/assess, capabilities/upload-csv)
├── Marketplace               (marketplace-listings, marketplace-sellers,
│                              marketplace-purchases, marketplace-workspace,
│                              workbench)
├── Membership & Payments     (me/membership, membership/tiers, subscriptions,
│                              stripe-webhook, nowpayments-webhook,
│                              admin/payments)
├── Autonomous Agent          (agent/*, agent/events SSE)
├── Enrichment Pipeline       (enrichment/*, alpha/*)
├── Insights & Content        (insights/*, educational-content/*, featured-content,
│                              case-studies/*, white-papers)
├── Research & Disruption     (research, disruption/*, macro-events, disruption-watch)
├── Comparative Tools         (compare, companies, benchmarking, stack-optimizer,
│                              innovation-pipeline, ideation, simulation, trade-signals,
│                              watchlist, analogues)
├── Collaboration             (collaboration, peer-coop, war-room)
├── Audit, Proof, KYC         (audit-log, proof, kyc/*, kyc-webhook, coverage,
│                              source-quality)
├── Embed / Export / API      (embed, exports, api-keys, credits, usage, api-volume,
│                              metrics)
├── Admin                     (admin/*, admin-security/*, foundry-admin/*, review/*,
│                              impersonate)
├── Public V1 API (Data Lic.) (v1/*)
├── Notifications             (digests, onboarding)
└── Health & Operations       (health, health/services)
```

### 29.4 Request Validation Pipeline

```
HTTP Request
    │
    ▼
pino request logger (req ID, method, URL)
    │
    ▼
Zod schema validation (path, query, body — generated from openapi.yaml)
    │  ├── On failure: 422 Unprocessable Entity + structured error array
    │  └── On success: typed parsed object forwarded to handler
    ▼
Route handler (async; Express 5 native error propagation)
    │
    ▼
Drizzle ORM query (parameterised — no raw SQL with user input)
    │
    ▼
Zod response validation (optional, dev mode)
    │
    ▼
pino completion logger (statusCode, responseTime)
```

### 29.5 Authentication & Authorisation

**Two coexisting auth models** as of Q2 2026:

1. **Session-token model** (legacy / self-serve). Random UUID v4 stored in browser `localStorage` (`ce_session_token`). Each route validates against `organizations` table. No password, no JWT. Tradeoff: non-revocable without DB deletion; acceptable at current scale.
2. **Clerk Auth** (multi-tenant readiness). For paid tiers and admin surfaces; PKCE + JWT with org-level RBAC. Webhook-driven user enrichment (commit `30e9443`).

**Admin gate.** `src/middlewares/requireAdmin.ts` enforces `x-admin-key: <ADMIN_API_KEY>` header. `ADMIN_AUTH_BYPASS=1` disables (local only). Routes behind:

- `POST/GET /api/review/*`
- `GET /api/admin/*`
- `POST /api/admin/trigger/:tool`
- `POST /api/enrichment/run`
- `POST /api/alpha/*`
- `POST /api/agent/scheduler/start|stop`
- `POST /api/agent/run-ontology`
- `POST /api/cei/refresh`
- `POST /api/insights/generate`
- `POST /api/research`
- `PATCH /api/membership/tiers/:id`
- `GET /api/admin/payments` + approve/reject/comp
- `POST /api/industries`
- `POST /api/projects/generate`
- `DELETE /api/admin/case-studies/:id`
- `POST /api/case-studies/generate`
- `GET/POST/PATCH/DELETE /api/admin/educational-content[/:id]`

Public read-only endpoints (catalog browse, capability detail, EVaR, moat, fragility, arbitrage, flows, talent, twin, status, graph, public educational content) remain open.

### 29.6 Bundling Specifics

- esbuild bundles the entire api-server into `dist/index.mjs`.
- `esbuild-plugin-pino` writes pino transports as sibling `pino-*.mjs` files (separate output files because pino spawns worker threads).
- Native/unbundleable packages externalised in `build.mjs` — add to that list if a new dep uses native modules or path traversal.
- ESM format; target node22.
- Source maps enabled for production debugging.

---

## 30. Autonomous Agent Subsystem

### 30.1 Theoretical Basis

1. **Active Inference (Friston, 2010).** The agent minimises surprise about capability scores by acquiring information from Perplexity research. Low confidence triggers research (surprise-reduction behaviour). Mathematically analogous to variational free-energy minimisation; implemented heuristically.
2. **Bayesian Updating.** Prior beliefs about capability scores are updated with new evidence. Posterior estimate serves as the next cycle's prior — continual belief refinement.
3. **Exponential Smoothing.** EMA with α=0.7 weights recent score deltas heavily while preserving historical signal. Approximates Kalman behaviour under stationary noise.

### 30.2 LangGraph State Machine

The agent is a stateful DAG. State object is typed and carries forward across all nodes:

```typescript
interface AgentState {
  runId: string;
  trigger: RunTrigger;
  startedAt: Date;

  // evaluate outputs
  capabilities: CapabilityRecord[];
  memories: MemoryRecord[];
  stalenessMap: Record<number, number>;
  confidenceMap: Record<number, number>;

  // decide outputs
  researchTargets: number[];
  skipReasons: Record<number, string>;
  contentQueue: ContentTarget[];

  // research outputs
  researchResults: ResearchResult[];
  failedResearch: number[];

  // compute outputs
  ceiComponents: CeiComponent[];
  newCeiSnapshot: CeiSnapshot | null;

  // memorize outputs
  memoriesStored: number;

  // generateContent outputs
  contentGenerated: ContentRecord[];
  contentFailed: ContentTarget[];

  stats: {
    perplexityCalls: number;
    claudeCalls: number;
    memoriesRecalled: number;
    memoriesStored: number;
    capabilitiesResearched: number;
    capabilitiesSkipped: number;
  };
  errors: Array<{ node: string; error: string; timestamp: Date }>;
}
```

**Node execution graph:**

```
┌────────────┐   ┌────────┐   ┌──────────┐   ┌─────────┐
│  evaluate  │──▶│ decide │──▶│ research │──▶│ compute │
└────────────┘   └────────┘   └──────────┘   └────┬────┘
                                                  │
┌────────────┐   ┌──────────────────┐   ┌─────────▼─────────┐
│  finalize  │◀──│ generateContent  │◀──│     memorize      │
└────────────┘   └──────────────────┘   └───────────────────┘
```

**Node responsibility matrix:**

| Node | Inputs | Outputs | Failure mode |
|---|---|---|---|
| `evaluate` | DB capabilities, Mem0 memories | Staleness assessments, confidence flags | Continues with empty memories if Mem0 fails |
| `decide` | Staleness/confidence | Research target list, content queue | Skips all research if 0 targets selected |
| `research` | Target capability list | 4 Perplexity results per capability | Partial: failed capabilities marked, others proceed |
| `compute` | Research results, current DB scores | Bayesian posteriors, new CVI snapshot | Rolls back on DB write failure |
| `memorize` | Research findings, decisions | Mem0 write confirmations | Non-blocking — failure logged, agent continues |
| `generateContent` | Content queue, Perplexity context | C-Suite perspectives, case-study ROI | Per-item failure logged; others proceed |
| `finalize` | Run stats | DB run record, SSE completion event | Best-effort — never blocks process exit |

### 30.3 4-Source Research Protocol

For each capability targeted for research, the agent executes **exactly 4** Perplexity queries using distinct epistemic frames:

```
Q1: "Current state of [capability] in [industry] — consulting perspective 2025-2026"
    → Sources: McKinsey, BCG, Deloitte, Accenture

Q2: "Market adoption benchmarks for [capability] in [industry] 2025"
    → Sources: Gartner Magic Quadrant, Forrester Wave, IDC

Q3: "Academic research on [capability] maturity measurement 2023-2026"
    → Sources: Peer-reviewed journals, working papers, MIT/HBS/Wharton

Q4: "Practitioner implementations of [capability] — case studies and outcomes"
    → Sources: CIO/CDO case studies, vendor whitepapers, conference proceedings
```

Each query returns: estimated score (0–100), source confidence (0–1), key evidence cited, trend direction, time horizon of evidence.

### 30.4 Scheduler & Urgency Logic

```
Server boot
    │
    ▼
startScheduler()
    │
    ├─── executeRun("startup")                  [t=0, immediate]
    │
    ├─── setInterval(30 min)                    [routine]
    │    └── executeRun("routine")
    │
    └─── setInterval(5 min)                     [urgency watchdog]
         └── detectUrgentConditions()
              │
              ├── confidence < 0.35?  → executeRun("urgency:low_confidence")
              ├── research age > 10d? → executeRun("urgency:stale_data")
              └── CVI drop > 5pts?    → executeRun("urgency:cei_drop")
```

**Mutex pattern.** `isRunning: boolean` flag in module scope. `executeRun` checks-and-sets atomically (JavaScript single-threaded event loop guarantees). Overlapping runs are impossible within a single process. Distributed mutex (Redis Redlock) required when scaling to multiple instances.

### 30.5 Memory Architecture (Mem0)

**Type taxonomy:**

| Type | Purpose | Example |
|---|---|---|
| `observation` | Raw findings from this cycle | "Insurance fraud detection improved 71→78 after Q1 2026 vendor entrants" |
| `pattern` | Cross-cycle patterns | "Healthcare AI adoption leads other industries by 8–12 pts across 6 cycles" |
| `insight` | Strategic synthesis | "Claims-automation velocity accelerating; suggest increasing research frequency" |
| `decision_context` | Why decisions were made | "Skipped underwriting research — confidence 0.82, researched 3 days ago" |

**Recall mechanics.** At `evaluate`, the agent issues a semantic similarity query: "capability research context for [industry] [current date]". Mem0 returns top-K most relevant memories ranked by embedding cosine similarity. Injected into LangGraph state, available to all downstream nodes.

This approximates the **dual-memory model** from cognitive neuroscience (Complementary Learning Systems): working memory (AgentState, one cycle) + long-term memory (Mem0, indefinite).

**Growth trajectory.** 3–8 memories per cycle. 3 cycles/day = ~3,000 memories/year. Mem0 semantic search remains efficient at this scale. At 10,000+, introduce consolidation: periodically merge `observation` memories into higher-level `pattern` memories using Claude.

**Local mirror.** Memories are mirrored to `agent_memories` DB table. `metadata.mem0Id` links cloud ↔ local rows. `getAllMemories` dedupes on that. Enables SQL queries over memory content (e.g., "show all memories mentioning Healthcare AI") that Mem0's semantic search alone can't answer.

### 30.6 Letta (Stateful Memory Blocks)

Letta provides persistent memory blocks that survive agent process restarts. Mem0 handles semantic/episodic memory; Letta maintains structural memory blocks (core beliefs, organisational context, research heuristics) loaded at agent initialisation.

**Config.** `LETTA_BASE_URL` (default `http://localhost:8283` in dev; `http://letta.railway.internal:8283` in prod). Lazy initialisation with health check + 60s retry cooldown. Graceful-degrade: if unreachable, logs warning and continues without Letta blocks.

**Required on the Letta service:** `LETTA_SERVER_PASSWORD` (any strong string); `OPENROUTER_API_KEY` (or another provider key) — without it, Letta has no LLM handles and agent runs fail with `NOT_FOUND: Handle <model> not found, must be one of []`.

### 30.7 Real-Time Activity (SSE)

The dashboard's live panel connects to `/api/agent/events`. Typed events:

```typescript
type AgentEvent =
  | { type: "agent_started"; runId: string; trigger: string }
  | { type: "phase_changed"; phase: AgentPhase; runId: string }
  | { type: "research_completed"; capabilityId: number; score: number; confidence: number }
  | { type: "cei_updated"; newIndex: number; delta: number }
  | { type: "memory_stored"; memoryType: MemoryType; content: string }
  | { type: "agent_completed"; runId: string; stats: RunStats }
  | { type: "scheduler_started"; nextRunIn: number }
  | { type: "heartbeat" };  // every 30s
```

Events broadcast via in-memory subscriber list. Works at single-process scale; requires Redis pub/sub at multi-process scale.

---

## 31. CVI Computation Pipeline

### 31.1 Full CVI Formula

$$\text{CVI} = \frac{\sum_{c} W_c \cdot C_c \cdot (1 + V_c) \cdot E_c \cdot \alpha_c}{\sum_{c} W_c} \times 10$$

| Variable | Symbol | Range | Derivation |
|---|---|---|---|
| Industry GDP weight | $W_c$ | 0.01–0.35 | Industry contribution normalised by sector GDP share (World Bank) |
| Bayesian consensus score | $C_c$ | 0–100 | Posterior mean from 4-source Perplexity triangulation |
| Velocity (EMA) | $V_c$ | −0.5 to +0.5 | $V_c = 0.7 \cdot \Delta C_{c,t} + 0.3 \cdot V_{c,t-1}$ |
| Economic multiplier | $E_c$ | 1.0–2.0 | PageRank-inspired traversal of ontology dependency graph |
| Confidence | $\alpha_c$ | 0–1 | Posterior precision normalised |

### 31.2 Bayesian Consensus Model

**Prior:**

$$p(\theta_c) = \mathcal{N}(\mu_0, \sigma_0^2)$$

where $\mu_0 = 50$ (non-informative for first cycle; later $\mu_0 = \hat\theta_{c,t-1}$); $\sigma_0^2 = 625$ (SD=25).

**Likelihood per source $i$:**

$$p(x_i \mid \theta_c) = \mathcal{N}(\theta_c, \sigma_i^2)$$

with $\sigma_i^2 = (1 - \text{confidence}_i)^{-1} \cdot 100$ reflecting source uncertainty.

**Posterior (conjugate Gaussian):**

$$\mu_n = \frac{\mu_0 / \sigma_0^2 + \sum_i x_i / \sigma_i^2}{1/\sigma_0^2 + \sum_i 1/\sigma_i^2}, \qquad \sigma_n^2 = \left(\frac{1}{\sigma_0^2} + \sum_i \frac{1}{\sigma_i^2}\right)^{-1}$$

**Confidence:** $\alpha_c = \max(0, 1 - \sigma_n / 25)$.

**95% credible interval:** $[\mu_n - 1.96 \sigma_n, \; \mu_n + 1.96 \sigma_n]$, stored in `cei_components.confidence_interval_low/high`.

### 31.3 Velocity Computation

EMA on score delta:

$$V_{c,t} = 0.7 \cdot (C_{c,t} - C_{c,t-1}) + 0.3 \cdot V_{c,t-1}$$

Normalised to $[-0.5, +0.5]$ via tanh-like compression. Velocity term `(1 + V_c)` amplifies improving capabilities and discounts declining ones — implicit momentum signal.

### 31.4 Economic Multiplier (PageRank-Inspired)

$$E_c = 1 + \frac{\sum_{j: c \in \text{deps}(j)} \text{strength}(j,c) \cdot E_j}{N_{deps}}$$

Capabilities that are prerequisites for many others receive higher multipliers (platform capabilities). Example: Data Architecture (score: 72) that enables AI Operations, Fraud Detection, and Predictive Analytics receives multiplier ~1.8×.

### 31.5 Sub-Capability Decomposition

Every top-level capability has 4–6 sub-capabilities auto-generated by Haiku 4.5. Children get factually triangulated by the rotation scheduler; **parents are pure rollups** (weighted average of children's posteriors, never directly triangulated — avoids double-counting). Macro events on a parent expand bidirectionally through `expandAffectedCapabilityIds`.

- Auto-decompose on approval: `services/sub-capability-generator.ts`
- Backfill: `scripts/backfill-sub-capabilities.ts`

### 31.6 Methodology Versioning & Backtest

`BACKTEST_METHODOLOGY_VERSION` constant (`"1.1"` as of `08fd27d`) stamped on every `backtest_runs` row, so future scoring-math changes don't pollute historical comparisons.

`runBacktest` (in `services/backtest.ts`) inserts a row at completion (non-fatal on failure) and returns `history` (last 20 runs, oldest→newest) + `regression` (latest log-loss vs. rolling avg of prior runs on same methodology version, threshold +0.05).

UI: `/backtest` TrendChart (Recharts LineChart) plotting Brier + log-loss with uniform-prior reference lines (0.667, 1.099). Amber regression-alert card when `summary.regression.triggered`.

---

## 32. Enrichment Pipeline

Perplexity research feeds into the **LLM synthesis layer** (Claude Sonnet 4.6 via OpenRouter by default; overridable per-deploy via `LLM_MODEL` env var; cascades Sonnet → Haiku → `z-ai/glm-5.1` on OpenRouter credit/budget errors via `services/llm-fallback.ts`) for typed-JSON synthesis and DB insertion. Three phases per industry:

1. **Capability quadrant classification** — placement on a 2×2 strategic matrix
2. **Value chain stages** — decomposition of capabilities by value-chain position
3. **Company profiles** — per-company capability profile against the industry baseline

**Concurrency.** `enrichment_runs` table holds a lock — prevents simultaneous runs.

**Trigger.** Admin-only via `POST /api/enrichment/run?phase=`.

**Persistence.** Run history in `enrichment_runs` (status, duration, payload metadata). Phase outputs persisted in `capability_quadrants`, `value_chain_stages`, `company_capability_profiles`.

---

## 33. Marketplace Subsystem

### 33.1 Components

```
artifacts/api-server/src/routes/
  marketplace-listings.ts   # CRUD over listings
  marketplace-sellers.ts    # seller registry; tied to KYC
  marketplace-purchases.ts  # Stripe Checkout creation; purchase records
  marketplace-workspace.ts  # buyer's purchased-artifact workspace
  workbench.ts              # custom analysis workspace

artifacts/api-server/src/services/
  marketplace-storage.ts    # blob storage under MARKETPLACE_STORAGE_DIR
  marketplace-watermark.ts  # per-purchase watermark generation
  marketplace-auto-archive.ts # cron: archive listings >30 days old
  marketplace-seed.ts       # boot-time seed (env-var gated)

lib/db/src/schema/
  marketplace.ts            # listings, sellers, purchases, reviews

artifacts/inflexcvi/src/
  pages/marketplace-listing.tsx
  pages/marketplace-library.tsx
  pages/marketplace-workspace.tsx
  pages/marketplace-sell.tsx
  components/marketplace-moderation.tsx
  components/marketplace-nav.tsx
```

### 33.2 Lifecycle

1. **Listing creation.** Seller completes KYC via Didit → creates listing → admin moderation queue → published.
2. **Discovery.** Buyer browses `/marketplace` (filter by industry/capability/category).
3. **Purchase.** Stripe Checkout (destination charges to seller's connected account). Webhook idempotently flips status.
4. **Delivery.** Per-purchase watermark applied (`marketplace-watermark.ts`); artifact issued to buyer's `/marketplace/workspace`.
5. **Audit anchor.** Hedera HCS anchor written asynchronously; topic ID + sequence number in `audit_chain`.
6. **Lifecycle hygiene.** Listings auto-archive 30 days after creation unless renewed.

### 33.3 Take-Rate Mechanics

- Stripe Connect destination charges: platform retains 12–18% per category at the Stripe layer.
- Payouts to sellers on T+2 (Stripe default for express accounts).
- Refunds: full Stripe refund flow; platform clawback included automatically.

### 33.4 IP Protection

- Watermark embedded at download time: buyer org, timestamp, transaction ID.
- Hedera HCS anchor proves provenance: third parties can verify a deliverable's existence at a given consensus timestamp via the topic ID.
- Take-down: 48-hour response to DMCA-style complaints; counter-notice supported.

### 33.5 Configuration

- `MARKETPLACE_STORAGE_DIR` — base path for artifact storage (env var on api-server service).
- Stripe Connect requires platform `STRIPE_SECRET_KEY` + seller `stripe_connected_account_id`.
- Didit KYC requires `DIDIT_API_KEY` + `DIDIT_WORKFLOW_ID`.

---

## 34. Hedera Audit Chain

### 34.1 Purpose

A tamper-evident, third-party-verifiable audit trail for security-critical events:

- Marketplace purchases (commit `e8f5472`)
- Security violations (admin overrides, KYC failures, anomalous access)
- KYC events
- Future: dataset publication, methodology version changes

### 34.2 Architecture

```
Event source (purchase webhook, security middleware, KYC webhook)
    │
    ▼
audit-anchor service (queued, asynchronous)
    │
    ▼
Hedera SDK: TopicMessageSubmitTransaction
    │
    ▼
Hedera Consensus Service network
    │
    ▼
Consensus reached → sequenceNumber + consensusTimestamp returned
    │
    ▼
Drizzle: update audit_chain row (status: anchored,
                                  topicId, sequenceNumber, consensusTimestamp)
```

### 34.3 Properties

- **Asynchronous.** Anchoring never blocks user-facing flow. Failure → row stays `pending`; retry job re-attempts.
- **Unified anchor service.** Single code path for all event types (commit `6e60ba9`).
- **Scheduled rotation.** Topic rotated periodically to avoid topic-length issues.
- **Admin explorer UI.** Surfaces anchored events for verification.

### 34.4 Configuration

- Hedera account credentials in env (operator account ID + private key).
- Topic ID(s) per environment.
- Asynchronous batching to amortise per-event cost.

---

## 35. Membership, Billing, Payments

### 35.1 Tiered Membership Model

Three subscription tiers (Free, Professional, Enterprise) plus a Data License path. Tier definitions in `membership_tiers` table; configurable via `PATCH /api/membership/tiers/:id` (admin-only).

### 35.2 Payment Paths

1. **Card (Stripe Checkout).**
   - `POST /api/me/membership/checkout` → creates `pending` row + Stripe Checkout Session → returns `checkoutUrl`.
   - Browser redirects to Stripe.
   - On success, Stripe POSTs `POST /api/stripe/webhook`.
2. **Invoice / Crypto.**
   - Admin reviews in `/admin/payments`.
   - Approve → status flips `active`.
   - Crypto via NowPayments IPN (`POST /api/nowpayments-webhook`).
3. **Free tier.** Auto-active on request.

### 35.3 Webhook Discipline

- `POST /api/stripe/webhook` mounted **before** `express.json()` so raw body is available for signature verification.
- `verifyWebhookSignature` requires `STRIPE_WEBHOOK_SECRET`; throws in production if absent; falls back to unverified parse in dev with loud warning.
- Idempotent: status transitions only `pending → active`. Never overrides admin rejection.

### 35.4 Stripe Connect (Marketplace)

- Sellers onboard via Stripe Express accounts.
- Destination charges automatically split platform take-rate from seller proceeds.
- Payouts on Stripe's default schedule (T+2).

### 35.5 Configuration

- `STRIPE_SECRET_KEY` (server)
- `STRIPE_WEBHOOK_SECRET` (server, required in prod)
- `VITE_STRIPE_PUBLISHABLE_KEY` (client; injected at build)
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` (server)

---

## 36. Database Architecture

### 36.1 Engine & Tooling

- **Engine:** PostgreSQL 17 (Railway managed; dev: Postgres 16/17)
- **ORM:** Drizzle ORM with `pg` driver (single connection pool, max 10)
- **Schema mgmt:** `drizzle-kit push` (schema-diff DDL; no migration files)
- **Validators:** `drizzle-zod` produces Zod validators from schema; supplements `@workspace/api-zod` (which generates from OpenAPI)

### 36.2 Schema Design Philosophy

- Normalised to 3NF with **deliberate denormalisation** for dashboard read performance (`cei_snapshots`, `cei_components` are append-only time-series tables redundant with `capabilities`).
- JSONB columns for dynamic key-sets (capability `metrics`, case-study `roi_data`, agent `decisions`).
- Unique constraints carry product semantics: `organization_capabilities (org_id, capability_id)`; `csuite_perspectives (role_id, industry_id, capability_id)`; `case_study_content (industry_id, capability_id)`.

### 36.3 Domain Tables (Summary)

(Full enumerated catalogue in Appendix B.)

- **Capability graph:** `industries`, `capabilities`, `capability_metrics`, `capability_dependencies`, `c_suite_roles`, `capability_role_mappings`, `ontology_relationships`, `ontology_industry_adapters`.
- **Organisations:** `organizations`, `organization_capabilities`.
- **CVI time-series:** `cei_snapshots`, `cei_components`, `source_triangulations`.
- **Agent state:** `agent_runs`, `agent_memories`.
- **Content (AI-generated, cached):** `csuite_perspectives`, `case_study_content`, `capability_insights`, `industry_leaderboard`, `industry_white_papers`, `data_sources`.
- **Projects:** `technology_projects`, `project_capability_impacts`, `project_executive_insights`, `project_risks`.
- **Marketplace:** `marketplace_listings`, `marketplace_sellers`, `marketplace_purchases`, `marketplace_reviews`.
- **Membership/Billing:** `user_memberships`, `membership_tiers`, `subscriptions`, `payments`, `invoices`.
- **Audit:** `audit_chain`, `audit_log`.
- **Backtest:** `backtest_runs`.

### 36.4 Indexing Strategy

Critical read-path indexes:

```sql
CREATE INDEX idx_cei_snapshots_industry_timestamp
  ON cei_snapshots (industry_id, timestamp DESC);

CREATE INDEX idx_agent_memories_user_created
  ON agent_memories (user_id, created_at DESC);

CREATE INDEX idx_org_capabilities_org_id
  ON organization_capabilities (org_id, capability_id);

CREATE INDEX idx_csuite_generated_at
  ON csuite_perspectives (generated_at DESC);

CREATE INDEX idx_backtest_runs_ran_at
  ON backtest_runs (ran_at DESC);
```

### 36.5 Citation System

Several tables (thresholds, leaderboard, white-papers) carry a `sourceIds` JSONB array referencing rows in `data_sources`. This implements the "every claim cites sources" property without forcing a many-to-many join table for read-heavy citation lookups.

### 36.6 Connection Management

- Single `pg.Pool` exported from `lib/db/src/index.ts`.
- Throws on import if `DATABASE_URL` not set — fast-fail intentional.
- Default pool max: 10 connections. Suitable for a single-instance api-server; revisit when scaling out.

---

## 37. Frontend Architecture

### 37.1 Stack

| Layer | Technology | Version | Rationale |
|---|---|---|---|
| UI | React | 19.1 | Concurrent rendering; Server Components readiness |
| Build | Vite | 7.x | Sub-second HMR; native ESM; fast production builds |
| Styling | Tailwind CSS | v4 | CSS-first variables; no JS config overhead |
| Animation | Framer Motion | 12.x | Spring physics; layout animations; gestures |
| Charts | Recharts | 2.x | React-native; composable; radar suits CVI |
| Routing | Wouter | 3.x | 2.1 KB router; sufficient for the page count |
| Data fetching | TanStack Query v5 + Orval | 5.90 | Auto cache, dedup, staleness; codegen hooks |
| Components | shadcn/ui (Radix) | latest | Accessible primitives; unstyled base; Tailwind-friendly |
| Icons | Lucide React | 0.545 | Tree-shakeable; consistent stroke system |

### 37.2 Vite Configuration

Both Vite configs (inflexcvi and pitch-deck) default `PORT=5173/5174` and `BASE_PATH="/"` when unset — safe to `pnpm run build` with no env setup.

- `PORT` affects dev/preview server only.
- `BASE_PATH` becomes the `<base href>` of the built bundle. Must be `/` for root deploys (otherwise SPA fallback breaks).
- `@tailwindcss/vite` plugin handles Tailwind v4.

### 37.3 Code Organisation

```
artifacts/inflexcvi/src/
├── main.tsx                # entry
├── App.tsx                 # router + providers
├── pages/                  # one per route
├── components/             # shared shell + feature components
│   ├── layout.tsx
│   ├── marketplace-nav.tsx
│   ├── marketplace-moderation.tsx
│   ├── case-study-admin.tsx
│   └── …
├── hooks/                  # custom hooks
├── lib/                    # utilities (formatters, etc.)
└── index.css               # Google Fonts @import (must be first line)
```

### 37.4 Session State

- Session token: `localStorage["ce_session_token"]`
- Industry id: `localStorage["ce_industry_id"]`
- No cookie-based session; no JWT in client until Clerk path used.

### 37.5 Per-Page Data Dependencies

(See §24.2 page table for refresh strategies and key components.)

### 37.6 Assessment Tool Deep Dive (`/assess`)

3-step wizard implementing the platform's flagship conversion mechanism.

**Step 1 — Context input:**

- Company name + industry selector (EDGAR integration for public companies)
- Business opportunity textarea with voice dictation (Web Speech API, SpeechRecognition interface)
- Voice briefing mode (separate audio layer for off-the-record context)
- Document upload (PDF/DOCX, up to 5 MB, client-side text extraction via FileReader)
- Competitor search with EDGAR autocomplete (two-pass: quoted exact → unquoted partial)

**Step 2 — Clarifying questions:**

- 5–8 AI-generated questions (Claude, context-aware from Step 1)
- Voice dictation on each answer field
- Progressive disclosure — answers refine the analysis prompt

**Step 3 — Analysis output:**

- WEF Global Competitiveness Framework radar chart (7 axes: ICT Adoption, Talent & Skills, Business Dynamism, Innovation Capability, Market Agility, Financial System, Institutional Resilience)
- Confidence score with Bayesian credible interval
- Strategic recommendations (prioritised gap analysis)
- Suggested investment roadmap (12-month horizon)

**SEC EDGAR integration:**

- Endpoint: `https://efts.sec.gov/LATEST/search-index?q=[query]&dateRange=custom&startdt=2020-01-01&category=form-type&forms=10-K`
- Field mapping: `entity_name` → `display_names` (`"Company Name (TICKER) (CIK 0000XXXXXX)"`)
- Two-pass search: quoted exact match; if <3 results, unquoted partial fallback.
- Outside-click detection with `AbortController` for cleanup (replaces `onBlur` which fired before click).

---

## 38. AI Integration Architecture

### 38.1 Anthropic / OpenRouter Shim

The "Anthropic integration" (`@workspace/integrations-anthropic-ai`) is a shim that routes Claude calls through **OpenRouter**, not the direct Anthropic API. The single env var required is `OPENROUTER_API_KEY` — the shim throws on import without it.

- Model name remapping: short names like `claude-haiku-4-5` map to OpenRouter model ids (`anthropic/claude-haiku-4.5`).
- The LLM synthesis layer (Claude Sonnet 4.6 default, swap via `LLM_MODEL`) is routed through OpenRouter; `z-ai/glm-5.1` is the cheapest tier of the automatic fallback chain.
- Reasoning: OpenRouter provides single-key access to multiple providers, simplifies failover, and supports cost arbitration.
- Direct `ANTHROPIC_API_KEY` is also set on Railway for paths that bypass the shim (kept for future direct-Anthropic optionality).

**Structured output pattern:** Claude is prompted with a JSON schema in the system prompt; outputs are parsed with Zod. On parse failure, retry once with a schema-correction prompt. ~98% first-attempt parse success.

**Usage contexts:**

- Capability Assessment analysis (per-assessment, user-triggered)
- C-Suite perspective generation (per agent cycle, cached 48h)
- Case study ROI generation (per agent cycle, cached 48h)
- On-demand insight generation (per-insight, cached indefinitely)
- Clarifying question generation (assessment Step 2)
- Sub-capability decomposition (Haiku 4.5)

### 38.2 Perplexity Sonar

- `sonar-pro`: 4 queries per capability in CVI research cycles (higher cost, deeper search).
- `sonar`: on-demand research endpoint (lower cost, sufficient for ad-hoc queries).
- Per-run cap: **6 Perplexity calls** (configurable in `tools.ts`). At 6 capabilities × 6 industries = 36 calls/cycle max.
- Preferred over direct web scraping: real-time access without browser automation, built-in citation tracking, structured response, predictable rate limits.

### 38.3 Mem0 Cloud

- Backend: LlamaIndex with Qdrant vector DB.
- Embeddings: OpenAI `text-embedding-3-small`.
- Memory dedup + automatic consolidation.
- Agent identity: fixed `user_id = "cei-agent"`. Multi-tenant evolution → partition by `orgId`.
- Local sync: memories mirror to `agent_memories` DB table for SQL queries over content.

**Deployment specifics (Railway).**

- Built from `mem0/Dockerfile` in this repo (Railway → New Service → root directory `mem0`).
- Dockerfile installs `libpq5` (which mem0ai/mem0's `server/Dockerfile` forgets — upstream image crashes with `ImportError: no pq wrapper available … libpq library not found`).
- Pinned to upstream release tag; installs Python deps; runs uvicorn.
- Required env on Mem0 service: `OPENAI_API_KEY`, `JWT_SECRET`, `ADMIN_API_KEY`, `POSTGRES_*` set pointing at a pgvector service in the same Railway project.
- **Do not** point this service at Docker Hub `mem0/mem0-api-server` — arm64-only, incompatible with Railway amd64.
- Pair with a `pgvector/pgvector:pg18` service for vector storage.
- **Auth header is `X-API-Key`** (not `Authorization: Bearer`; the Railway template doc is wrong on this; v2.x rejects Bearer as invalid JWT).

### 38.4 Letta

- Built from `letta/Dockerfile` in this repo.
- Required env on Letta service: `LETTA_SERVER_PASSWORD`, `OPENROUTER_API_KEY` (or another provider key).
- Without provider key → `NOT_FOUND: Handle <model> not found, must be one of []`.

### 38.5 Wiring API-Server to Mem0 + Letta

On the api-server service set:

- `MEM0_BASE_URL=http://<mem0-service-name>.railway.internal:8000`
- `MEM0_API_KEY=<ADMIN_API_KEY value from the Mem0 service>` (sent as `X-API-Key`)
- `LETTA_BASE_URL=http://letta.railway.internal:8283`
- `LETTA_API_KEY=<same value as LETTA_SERVER_PASSWORD>`

Verify via `GET /api/health/services` — `mem0` and `letta` both `status: "ok"`.

### 38.6 SEC EDGAR

- Public endpoint; no auth.
- Two-pass search; outside-click cleanup; client-side rendering only.

### 38.7 Resend (Email)

- Transactional emails (onboarding, marketplace purchase confirmation, payment receipts).
- Centralised in `services/email.ts`.

### 38.8 Stripe & Stripe Connect

- Card payments (subscriptions + marketplace purchases).
- Connect Express accounts for marketplace sellers; destination charges retain platform take-rate.
- Webhook signature verification required in prod.

### 38.9 Clerk (Auth)

- Multi-tenant readiness path.
- Webhook-driven user enrichment.
- Frontend SDK for protected routes; backend JWT verification.

### 38.10 NowPayments (Crypto)

- IPN signed callbacks update `payments` rows.
- Admin manual approval also supported (invoice path).

### 38.11 Didit (KYC)

- Required for marketplace sellers.
- KYC level B (identity + sanctions screening) minimum for payouts.
- Callback to `POST /api/kyc-webhook`.

### 38.12 Hedera HCS (Audit Chain)

(See §34.)

---

## 39. Deployment Architecture (Railway)

### 39.1 Service Topology

Single Railway project ("Inflexcvi") with these services:

| Service | Source | Purpose |
|---|---|---|
| `inflexcvi` | this repo (`main`) | api-server + static SPA |
| `letta-2EOT` | `letta/Dockerfile` | Stateful memory blocks |
| `Mem0` | `mem0/Dockerfile` | Semantic memory (uvicorn) |
| `Postgres` | Railway plugin | Primary OLTP store |
| `pgvector` | `pgvector/pgvector:pg18` | Vector store for Mem0 |
| `Neo4j Graph (Metal-Ready)` | Railway plugin | Ontology graph (future) |

Service IDs and project IDs are documented in `CLAUDE.md` for fast lookup via Railway GraphQL.

### 39.2 Build & Run (api-server)

- `railway.json` + `nixpacks.toml` configure the build.
- Railway runs: `pnpm install --frozen-lockfile && pnpm run build:deploy`, then `pnpm run start`.
- api-server both exposes `/api/*` and serves the built inflexcvi SPA with a client-routing fallback.
- `PORT` injected by Railway. All AI integration keys are optional — absence logs a warning and disables the dependent feature.

### 39.3 Schema Push at Deploy

Provision Postgres and set `DATABASE_URL`; run `drizzle-kit push` against prod before first boot. Idempotent — applies only diff. Zero-downtime deploys because Railway spins up the new container before terminating the old; push completes in <5 s on empty diff.

### 39.4 Static SPA Fallback

api-server resolves the SPA bundle in this order:

1. `FRONTEND_DIST_PATH` env override
2. `$cwd/artifacts/inflexcvi/dist/public`
3. `__dirname/../../inflexcvi/dist/public` (monorepo layout)

Missing bundle is non-fatal — the server logs a warning and runs API-only.

### 39.5 Internal Networking

- Service-to-service traffic over `*.railway.internal` hostnames.
- `MEM0_BASE_URL=http://mem0.railway.internal:8000`, `LETTA_BASE_URL=http://letta.railway.internal:8283`.

### 39.6 CI/CD

- Railway watches the `main` branch; auto-deploys on merge.
- `nixpacks.toml` provides a fallback when Dockerfile-less mode is used.
- Pre-deploy checks: typecheck + build:deploy must pass before deploy completes.

---

## 40. Observability & Operations

### 40.1 Logging

- **pino** structured JSON across the api-server.
- Per-request log: req ID, method, URL, status, duration.
- Per-agent-run log: run ID, trigger, per-phase timings, counters, errors.
- `pino-pretty` in development; raw JSON in production for log aggregator ingestion.

### 40.2 Health Probes

`GET /api/health` — 200 + version metadata.

`GET /api/health/services` — per-integration probe. Each probe returns one of: `ok`, `degraded`, `down`, `not_configured`. Probes:

| Service | What it checks |
|---|---|
| mem0 | `GET /health` against `MEM0_BASE_URL` with `X-API-Key` |
| letta | `GET /v1/health/` against `LETTA_BASE_URL` |
| openrouter | `GET /auth/key` |
| anthropic | `ANTHROPIC_API_KEY` presence + (planned) lightweight test call |
| perplexity | minimal completion (1 token; cost-controlled) |
| foundry | Foundry URL env var presence |
| stripe | account ping (live mode aware) |
| clerk | API auth ping |
| demo_readiness | composite of agent run availability + CVI snapshot freshness |

### 40.3 Agent Telemetry

- `agent_runs` row per cycle with start/end timestamps, counters, status, error message.
- `/admin/agent-runs` UI surfaces history with filters and detail drawer.
- SSE event stream provides real-time visibility for power users.

### 40.4 Production Incident Runbook (Outline)

1. **First signal.** Customer report OR `/api/health/services` non-ok OR agent run failure spike in `/admin/agent-runs`.
2. **Triage.** Check Railway logs (api-server, Letta, Mem0, Postgres). Identify whether issue is integration (Mem0 down, Perplexity rate-limited) or platform (DB connection saturation, OOM).
3. **Mitigation.** Toggle scheduler off via `POST /api/agent/scheduler/stop` if agent is failing in a loop. Restart service via Railway dashboard if necessary.
4. **Communication.** CS posts status page update if customer-visible. CEO notified for P1.
5. **Resolution.** Root-cause analysis; fix in PR; deploy.
6. **Post-mortem.** Within 5 business days for P1.

### 40.5 SessionStart Preflight (Local)

`.claude/preflight.sh` runs on every Claude Code session start and reports:

- git: branch, ahead/behind, dirty count, unpushed commits
- gh CLI auth status
- railway CLI auth status
- prod `/api/health/services` HTTP status code

This surface eliminates a category of "Railway didn't deploy" investigation that's actually rooted in unpushed local commits.

### 40.6 Post-Merge Hook

`.replit` `[postMerge]` invokes `scripts/post-merge.sh` after merges. 20 s timeout.

---

## 41. Security Architecture

### 41.1 Threat Model

| Threat | Vector | Mitigation |
|---|---|---|
| API key exposure | Code / env leak | All keys via env vars; secrets in Railway/Replit (Railway authoritative); never in repo |
| SQL injection | User input in queries | Drizzle ORM parameterised queries; no raw SQL with user input |
| XSS | Stored AI content rendered as HTML | Content served as API JSON, never `dangerouslySetInnerHTML`; React escapes by default |
| Session hijacking | Token theft | Tokens are single-org; no privilege escalation; low-value target. Multi-tenant tier upgrades to Clerk JWT |
| Prompt injection | User text → Claude | System prompts instruct Claude to ignore instructions in user content; structured-output schema limits damage |
| LLM output abuse | Malicious structured output | Zod validates all Claude output; malformed responses are rejected, not executed |
| CORS misconfiguration | Cross-origin requests | CORS restricted to known origins in production |
| Rate-limiting absent | API abuse | Rate-limiting on `/api/research` (only expensive user-triggered endpoint) |
| Webhook signature bypass | Stripe / NowPayments | Signature verification required in prod; webhook mounted before `express.json()` for Stripe |
| Marketplace IP theft | Buyer redistributes deliverable | Per-purchase watermarking + Hedera anchor enables enforcement |
| Admin endpoint abuse | Stolen `ADMIN_API_KEY` | Rotate ADMIN_API_KEY on incident; admin actions audit-logged + Hedera anchored for security actions |

### 41.2 Data Privacy Posture

- No PII stored — organisations identified by session token + optional name only.
- No third-party analytics scripts on logged-in surfaces.
- Perplexity queries contain capability + industry names, never user data.
- Claude receives assessment text — users informed before submission if PII risk.
- GDPR: session data deletable via `DELETE /organizations/:token` (cascading).

### 41.3 Secrets Management

- Production source of truth: **Railway service Variables**.
- Local dev: env vars injected by Replit Secrets (treated as stale; not authoritative).
- Never commit secrets. `.env` is not currently in `.gitignore` — if one is created, gitignore first.
- Rotation: card-blast on suspected compromise; AI provider keys rotate via provider dashboards; Stripe keys rotate via Stripe dashboard.

### 41.4 Hedera-Anchored Security Audit

Security-critical actions (admin overrides, KYC failures, anomalous access) write to `audit_chain` with Hedera HCS anchor (see §34). Provides tamper-evident incident timeline.

### 41.5 Marketplace Trust

- KYC via Didit before payouts.
- Watermarking embedded at delivery time.
- Hedera anchor proves provenance.
- 48-hour DMCA response window with counter-notice support.

---

## 42. Scalability & Evolution Path

### 42.1 Current Constraints

| Constraint | Current limit | Trigger to upgrade |
|---|---|---|
| Concurrent users | ~500 (Node.js event loop) | SSE connection pool exhaustion |
| Agent runs | 1 at a time (in-process mutex) | Multiple tenants needing simultaneous runs |
| DB connections | 10 (pg pool max) | Query queue latency >100 ms |
| Memory recall latency | ~200 ms (Mem0 round-trip) | >50 recall operations per cycle |
| Perplexity budget | 6 calls/run | Multi-industry expansion |
| SSE broadcast | In-process subscriber list | Multi-process api-server |

### 42.2 Multi-Tenant Evolution

```
Current (single-tenant)          Multi-tenant (Phase 2)
─────────────────────────        ─────────────────────────
session token → org              Clerk Auth → JWT → org RBAC
fixed agent_id                   agent_id per org
shared CVI index                 CVI index per org + industry
in-process scheduler             BullMQ + Redis job queue per org
single Mem0 user_id              user_id = orgId
```

See `docs/saas-multi-tenant-isolation.md` for the full migration plan.

### 42.3 Agent Scale-Out

```
Current: API Server → in-process agent
Future:  API Server → BullMQ queue → Worker Service → agent

Worker Service (separate Railway service):
├── BullMQ worker (Redis-backed)
├── One worker process per concurrent run
├── Redis pub/sub for SSE event broadcasting
└── Database: same Postgres, separate connection pool
```

### 42.4 Research Volume Scale-Out

At 12 industries × 12 capabilities × 4 Perplexity queries × 3 cycles/day = **1,728 calls/day**. At `sonar-pro` (~$5/1000 queries), that's ~$8.64/day or **~$260/month**.

Caching strategies:

- **Source deduplication** — Cache Perplexity responses by `(query_hash, date)` with 24 h TTL in Redis.
- **Adaptive frequency** — Research capabilities proportionally to volatility; stable capabilities monthly, volatile daily.
- **Hierarchical research** — Industry-level trend queries shared across all capabilities in that industry.

### 42.5 Frontend Scale-Out

- Static SPA bundle served from api-server today. At scale, move to CDN (CloudFront, Cloudflare R2 + Workers) — separates SPA hosting from API capacity.
- Code-split per route already in place (Vite default for `import()` boundaries).

### 42.6 Database Scale-Out

- Single Postgres instance suffices to ~5,000 active orgs at current schema.
- Add read replicas before sharding (dashboard reads dominate).
- Time-series tables (`cei_snapshots`, `cei_components`) are candidates for partitioning by month at >10M rows.

### 42.7 Cost Scaling

(See §10.1 — AI + infra <1% of ARR through Year 3.)

---

# APPENDICES

## Appendix A. Mathematical Reference

### A.1 Bayesian Posterior (Conjugate Gaussian)

Prior: $p(\theta_c) = \mathcal{N}(\mu_0, \sigma_0^2)$
Likelihood per source $i$: $p(x_i \mid \theta_c) = \mathcal{N}(\theta_c, \sigma_i^2)$

Posterior mean:

$$\hat\theta_c = \mu_n = \frac{\mu_0 / \sigma_0^2 + \sum_i x_i / \sigma_i^2}{1/\sigma_0^2 + \sum_i 1/\sigma_i^2}$$

Posterior variance:

$$\sigma_n^2 = \left(\frac{1}{\sigma_0^2} + \sum_i \frac{1}{\sigma_i^2}\right)^{-1}$$

Source variance from confidence: $\sigma_i^2 = (1 - \text{conf}_i)^{-1} \cdot 100$

### A.2 EMA Velocity

$$V_{c,t} = \alpha \cdot (C_{c,t} - C_{c,t-1}) + (1 - \alpha) \cdot V_{c,t-1}, \quad \alpha = 0.7$$

### A.3 Economic Multiplier (PageRank-Inspired)

$$E_c = 1 + \frac{\sum_{j : c \in \text{deps}(j)} \text{strength}(j,c) \cdot E_j}{N_{\text{deps}}}$$

Iterate to fixed point (~5–10 iterations on the ontology graph).

### A.4 Capability Value Index

$$\text{CVI} = \frac{\sum_c W_c \cdot \hat\theta_c \cdot (1 + V_c) \cdot E_c \cdot \alpha_c}{\sum_c W_c} \times 10$$

### A.5 Confidence

$$\alpha_c = \max\left(0, \; 1 - \frac{\sigma_{n,c}}{25}\right)$$

### A.6 95% Credible Interval

$$CI_{95} = [\mu_n - 1.96 \sigma_n, \; \mu_n + 1.96 \sigma_n]$$

### A.7 Backtest Metrics

**Brier score (binary outcome):**

$$\text{Brier} = \frac{1}{N} \sum_{i=1}^N (p_i - o_i)^2$$

**Log-loss:**

$$\text{LogLoss} = -\frac{1}{N} \sum_i \left[o_i \log p_i + (1 - o_i) \log (1 - p_i)\right]$$

Uniform-prior reference lines: Brier 0.667 (random 3-class), log-loss 1.099 ($\ln 3$).

Regression alert triggers when latest log-loss exceeds rolling-average of prior runs on same methodology version by +0.05.

---

## Appendix B. Database Schema Reference

### B.1 Core Domain

```sql
industries               (id SERIAL PK, name, slug, description, gdp_weight NUMERIC)
capabilities             (id SERIAL PK, industry_id FK, name, slug, description,
                          benchmark_score INT, economic_value_min NUMERIC,
                          economic_value_max NUMERIC, category)
capability_metrics       (id SERIAL PK, capability_id FK, name, unit,
                          current_value NUMERIC, benchmark_value NUMERIC, source)
capability_dependencies  (id SERIAL PK, capability_id FK, depends_on_id FK,
                          strength NUMERIC)
c_suite_roles            (id SERIAL PK, name, slug, title, abbreviation)
capability_role_mappings (capability_id FK, role_id FK, relevance_score NUMERIC,
                          PRIMARY KEY (capability_id, role_id))
ontology_relationships   (id, source_capability_id FK, target_capability_id FK,
                          relationship_type TEXT, strength NUMERIC, description TEXT)
ontology_industry_adapters (id, industry_id FK, capability_id FK,
                            maturity_model TEXT, stage_definitions JSONB)
```

### B.2 Organisations

```sql
organizations             (id SERIAL PK, name, industry_id FK,
                           session_token UUID UNIQUE, created_at, updated_at)
organization_capabilities (id SERIAL PK, org_id FK, capability_id FK, score INT,
                           UNIQUE (org_id, capability_id))
```

### B.3 CVI Time-Series

```sql
cei_snapshots         (id SERIAL PK, industry_id FK, index_value NUMERIC,
                       timestamp TIMESTAMPTZ, run_id FK, methodology_version INT)
cei_components        (id SERIAL PK, snapshot_id FK, capability_id FK,
                       score NUMERIC, velocity NUMERIC, multiplier NUMERIC,
                       confidence NUMERIC, weight NUMERIC,
                       confidence_interval_low NUMERIC,
                       confidence_interval_high NUMERIC)
source_triangulations (id SERIAL PK, component_id FK, source_index INT,
                       raw_score NUMERIC, confidence NUMERIC, evidence TEXT,
                       query_type TEXT, created_at TIMESTAMPTZ)
```

### B.4 Agent State

```sql
agent_runs    (id SERIAL PK, status TEXT, trigger TEXT,
               industries_evaluated INT, capabilities_researched INT,
               capabilities_skipped INT, perplexity_calls INT,
               memories_recalled INT, memories_stored INT, decisions JSONB,
               cei_before_index NUMERIC, cei_after_index NUMERIC,
               error_message TEXT, started_at TIMESTAMPTZ,
               completed_at TIMESTAMPTZ)
agent_memories (id SERIAL PK, mem0_id TEXT UNIQUE, content TEXT,
                memory_type TEXT, user_id TEXT, run_id FK,
                metadata JSONB, created_at TIMESTAMPTZ)
```

### B.5 Content (AI-Generated, Cached)

```sql
csuite_perspectives (id SERIAL PK, role_id FK, industry_id FK, capability_id FK,
                     headline TEXT, executive_summary TEXT,
                     strategic_priorities JSONB, kpis JSONB, roi_metrics JSONB,
                     generated_at TIMESTAMPTZ,
                     UNIQUE (role_id, industry_id, capability_id))
case_study_content  (id SERIAL PK, industry_id FK, capability_id FK,
                     title TEXT, description TEXT, metrics JSONB,
                     roi_data JSONB, timeline_data JSONB,
                     implementation_phases JSONB, generated_at TIMESTAMPTZ,
                     UNIQUE (industry_id, capability_id))
```

### B.6 Insights & Research

```sql
capability_thresholds  (id, capability_id FK, red_threshold NUMERIC,
                        yellow_threshold NUMERIC, green_threshold NUMERIC,
                        source TEXT, rationale TEXT, source_ids JSONB)
capability_insights    (id, capability_id FK, industry_id FK,
                        type TEXT, title TEXT, content TEXT,
                        severity TEXT, generated_at)
industry_leaderboard   (id, industry_id FK, company_name TEXT, score NUMERIC,
                        rank INT, year INT, source_ids JSONB)
industry_white_papers  (id, industry_id FK, title TEXT, publisher TEXT,
                        url TEXT, published_date DATE,
                        relevance_score NUMERIC, source_ids JSONB)
data_sources           (id, title TEXT, publisher TEXT, url TEXT,
                        published_date DATE, capability_ids INT[])
```

### B.7 Technology Projects

```sql
technology_projects        (id, name TEXT, slug TEXT, category TEXT,
                            description TEXT, timeline_years INT,
                            investment_range_low NUMERIC,
                            investment_range_high NUMERIC)
project_capability_impacts (project_id FK, capability_id FK,
                            uplift_percentage NUMERIC,
                            implementation_effort TEXT,
                            time_to_value_months INT,
                            PRIMARY KEY (project_id, capability_id))
project_executive_insights (id, project_id FK, role_id FK,
                            insight_type TEXT, headline TEXT,
                            details TEXT, financial_impact TEXT)
project_risks              (id, project_id FK, title TEXT, description TEXT,
                            severity TEXT, probability TEXT, mitigation TEXT)
```

### B.8 Marketplace

```sql
marketplace_listings  (id SERIAL PK, seller_id FK, title, description,
                       category, price_cents INT, currency TEXT,
                       artifact_path TEXT, preview_path TEXT,
                       status TEXT, published_at, archived_at,
                       UNIQUE (seller_id, slug))
marketplace_sellers   (id SERIAL PK, user_id FK, display_name,
                       bio TEXT, stripe_connected_account_id,
                       kyc_status TEXT, kyc_verified_at)
marketplace_purchases (id SERIAL PK, listing_id FK, buyer_org_id FK,
                       amount_cents INT, currency TEXT, status TEXT,
                       stripe_session_id TEXT, stripe_payment_intent_id TEXT,
                       watermark_token TEXT, created_at, paid_at)
marketplace_reviews   (id SERIAL PK, listing_id FK, buyer_id FK,
                       rating INT, comment TEXT, created_at)
```

### B.9 Membership & Billing

```sql
membership_tiers   (id SERIAL PK, slug TEXT UNIQUE, name TEXT,
                    price_cents INT, billing_period TEXT, features JSONB)
user_memberships   (id SERIAL PK, user_id FK, tier_id FK, status TEXT,
                    payment_status TEXT, stripe_subscription_id TEXT,
                    created_at, activated_at, cancelled_at)
subscriptions      (id, user_id FK, stripe_subscription_id TEXT,
                    status TEXT, current_period_end TIMESTAMPTZ)
payments           (id, user_id FK, amount_cents INT, currency TEXT,
                    method TEXT, stripe_payment_intent_id TEXT,
                    nowpayments_invoice_id TEXT, status TEXT, created_at)
invoices           (id, user_id FK, payment_id FK, pdf_url TEXT,
                    issued_at, paid_at)
```

### B.10 Audit Chain

```sql
audit_chain (id SERIAL PK, event_type TEXT, payload JSONB,
             topic_id TEXT, sequence_number BIGINT,
             consensus_timestamp TIMESTAMPTZ,
             status TEXT,                        -- pending | anchored | failed
             retries INT DEFAULT 0,
             created_at, anchored_at)
audit_log   (id SERIAL PK, actor_id TEXT, action TEXT, resource TEXT,
             resource_id TEXT, metadata JSONB, created_at)
```

### B.11 Backtest

```sql
backtest_runs (id SERIAL PK, ran_at TIMESTAMPTZ NOT NULL,
               methodology_version TEXT NOT NULL,
               event_count INT, aggregate_matched INT,
               aggregate_scored INT, aggregate_accuracy NUMERIC,
               brier NUMERIC, log_loss NUMERIC, probabilistic_count INT)
CREATE INDEX idx_backtest_runs_ran_at ON backtest_runs (ran_at DESC);
```

---

## Appendix C. Complete API Endpoint Catalogue

Grouped by route file. All endpoints under `/api`. Admin-protected endpoints marked with 🛡.

### C.1 Public Catalogue

- `GET /industries` — list industries
- `POST /industries` 🛡 — create industry
- `GET /capabilities` — list capabilities (filter: industryId, roleSlug)
- `GET /capabilities/:id`
- `GET /capability-annotations` — public annotations
- `GET /roles` — C-Suite roles
- `GET /ontology` — capability-to-capability relationships
- `GET /thresholds`
- `GET /data-sources`
- `GET /white-papers`
- `GET /leaderboard`
- `GET /companies`
- `GET /compare?capabilityIds=…`
- `GET /benchmarking`
- `GET /analogues` — capability analogues (cross-industry mirrors)
- `GET /regulations` — regulatory context per capability
- `GET /macro-events`

### C.2 CVI

- `GET /cei/current`
- `GET /cei/history`
- `GET /cei/components`
- `GET /cei/methodology`
- `POST /cei/refresh` 🛡

### C.3 Assessment

- `POST /assess`
- `GET /assess/history`
- `GET /assess/shared/:token`
- `GET /assess/:id/export.json`
- `GET /sec/search`

### C.4 C-Suite

- `GET /csuite`
- `GET /csuite/:roleSlug`

### C.5 Knowledge Graph & Ontology

- `GET /ontology` (also in §C.1)
- `GET /capabilities` (also in §C.1)
- Foundry admin: `GET/POST /foundry-admin/*` 🛡

### C.6 Projects

- `GET /projects`
- `GET /projects/:id`
- `POST /projects/generate` 🛡

### C.7 Organisation & Dashboard

- `POST /organizations`
- `GET /organizations/:token`
- `PATCH /organizations/:token`
- `DELETE /organizations/:token`
- `POST /capabilities/assess`
- `POST /capabilities/upload-csv`
- `GET /dashboard`
- `GET /dashboard-views`

### C.8 Marketplace

- `GET /marketplace-listings`, `GET /marketplace-listings/:id`
- `POST /marketplace-listings`, `PATCH /marketplace-listings/:id`, `DELETE /marketplace-listings/:id`
- `GET /marketplace-sellers`, `GET /marketplace-sellers/:id`
- `POST /marketplace-sellers`, `PATCH /marketplace-sellers/:id`
- `POST /marketplace-purchases`
- `GET /marketplace-purchases`
- `GET /marketplace-workspace`
- `GET /workbench`, `POST /workbench`
- KYC: `POST /kyc/start`, `POST /kyc-webhook`

### C.9 Membership & Payments

- `GET /membership/tiers`
- `PATCH /membership/tiers/:id` 🛡
- `GET /me/membership`
- `POST /me/membership/checkout`
- `POST /stripe-webhook` (signature verified; mounted pre-`express.json()`)
- `POST /nowpayments-webhook`
- `GET /subscriptions`
- `GET /invoices`
- `GET /admin/payments` 🛡
- `POST /admin/payments/:id/approve` 🛡
- `POST /admin/payments/:id/reject` 🛡
- `POST /admin/payments/:id/comp` 🛡
- `GET /billing-orgs`, `POST /billing-orgs`

### C.10 Autonomous Agent

- `GET /agent/status`
- `GET /agent/history`
- `GET /agent/memories`
- `GET /agent/tools`
- `GET /agent/events` (SSE)
- `POST /agent/scheduler/start` 🛡
- `POST /agent/scheduler/stop` 🛡
- `POST /agent/run-ontology` 🛡

### C.11 Enrichment

- `POST /enrichment/run` 🛡
- `POST /enrichment-config` 🛡
- `GET /enrichment/status`
- `GET /enrichment/quadrants`
- `GET /enrichment/value-chain`
- `GET /enrichment/companies`
- `POST /alpha/enrich` 🛡
- `POST /alpha/enrich-detail` 🛡
- `POST /alpha/thesis` 🛡

### C.12 Insights, Content, Education

- `GET /insights`
- `POST /insights/generate` 🛡
- `GET /educational-content`
- `GET/POST/PATCH/DELETE /admin/educational-content[/:id]` 🛡
- `GET /featured-content`
- `GET /content`

### C.13 Case Studies

- `GET /case-studies`
- `GET /case-studies/:slug`
- `POST /case-studies/generate` 🛡
- `DELETE /admin/case-studies/:id` 🛡

### C.14 Research, Disruption, Discovery

- `POST /research` 🛡
- `GET /disruption`
- `GET /disruption-patterns`
- `GET /disruption-watch`
- `GET /macro-events`
- `GET /trade-signals`
- `GET /innovation-pipeline`
- `POST /ideation`
- `POST /simulation`
- `GET /watchlist`, `POST /watchlist`, `DELETE /watchlist/:id`
- `POST /stack-optimizer`

### C.15 Collaboration

- `GET/POST /collaboration`
- `GET /peer-coop`
- `GET /war-room`

### C.16 Audit, Proof, Coverage

- `GET /audit-log`
- `GET /proof/:id`
- `GET /coverage`
- `GET /source-quality`
- `GET /admin-security/*` 🛡

### C.17 Embed, Export, API Keys, Credits, Usage

- `GET /embed/cei`
- `GET /exports/:id`
- `GET /api-keys`, `POST /api-keys`, `DELETE /api-keys/:id` 🛡
- `GET /credits`
- `GET /usage`
- `GET /api-volume`
- `GET /metrics`

### C.18 Explainability & Decision Tools

- `GET /explainability`
- `GET /roi`
- `POST /nl-query`
- `GET /semantic-search`

### C.19 Review

- `POST /review/draft` 🛡
- `GET /review/queue` 🛡
- `POST /review/:id/retry` 🛡
- `POST /review/:id/approve` 🛡
- `POST /review/:id/reject` 🛡
- `GET /review/:id/notes` 🛡

### C.20 Admin Aggregations

- `GET /admin/overview` 🛡
- `GET /admin/assessments` 🛡
- `GET /admin/content` 🛡
- `GET /admin/agent-runs` 🛡
- `POST /admin/trigger/:tool` 🛡
- `GET /admin/models` 🛡
- `GET /admin/backtest/history` 🛡
- `POST /admin/backtest/run` 🛡
- `POST /impersonate` 🛡

### C.21 Dynamic Industries

- `GET /dynamic-industries`
- `POST /dynamic-industries` 🛡

### C.22 Health

- `GET /health`
- `GET /health/services`

### C.23 V1 Public API (Data License)

- `GET /v1/cei` (api-key auth)
- `GET /v1/capabilities`
- `GET /v1/companies`
- `GET /v1/snapshots?since=`

### C.24 Notifications

- `GET /digests`
- `POST /onboarding`

### C.25 Other

- `GET /vce`, `POST /vce/*` — VCE (Value Chain Evaluator) tools
- `GET /me`
- `GET /membership/*`, `PATCH /membership/*` 🛡
- `GET /products`
- `GET /products/:id`

---

## Appendix D. Environment Variables Reference

### D.1 Mandatory (api-server)

| Var | Purpose | Failure mode if missing |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `lib/db` throws on import |
| `PORT` | api-server listen port | `src/index.ts` throws |

### D.2 Feature-Gated (Graceful Degrade)

| Var | Purpose | Behaviour when missing |
|---|---|---|
| `PERPLEXITY_API_KEY` | Sonar research | Research feature disabled; agent logs warning |
| `MEM0_API_KEY` + `MEM0_BASE_URL` | Semantic memory | Agent skips Mem0 calls; local-DB fallback only |
| `LETTA_BASE_URL` + `LETTA_API_KEY` | Stateful memory blocks | Agent skips Letta; lazy retry with 60s cooldown |
| `OPENROUTER_API_KEY` | LLM synthesis (Sonnet 4.6 default; Haiku 4.5 + GLM 5.1 in fallback chain) | enrichment + alpha + thesis + assess routes 500; `services/llm-fallback.ts` chain unavailable |
| `LLM_MODEL` (optional) | Overrides the default synthesis model without redeploy. Falls back to `anthropic/claude-sonnet-4.6`. | none — used only when set |
| `ANTHROPIC_API_KEY` | Direct Anthropic path + anthropic probe | Probe reports `not_configured` |

### D.3 Admin & Auth

| Var | Purpose |
|---|---|
| `ADMIN_API_KEY` | Required for admin routes (`x-admin-key` header match) |
| `ADMIN_AUTH_BYPASS` | `1` disables admin auth check — **local dev only** |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` | Clerk multi-tenant auth |

### D.4 Payments

| Var | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature (required in prod) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Frontend Stripe Elements |
| `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` | Crypto payments + IPN |

### D.5 Marketplace & KYC

| Var | Purpose |
|---|---|
| `MARKETPLACE_STORAGE_DIR` | Base path for artifact storage |
| `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID` | KYC workflow |

### D.6 Communications

| Var | Purpose |
|---|---|
| `RESEND_API_KEY` | Transactional emails |
| `EMAIL_FROM` | Default sender |

### D.7 Foundry (Optional)

| Var | Purpose |
|---|---|
| `FOUNDRY_BASE_URL` (or `PALANTIR_URL`, `PALANTIR_BASE_URL`, `FOUNDRY_URL`) | Foundry endpoint |
| `FOUNDRY_TOKEN` | Foundry auth |

### D.8 Audit Chain (Hedera)

| Var | Purpose |
|---|---|
| `HEDERA_OPERATOR_ID` | Operator account id |
| `HEDERA_OPERATOR_KEY` | Operator private key |
| `HEDERA_TOPIC_ID` | HCS topic for audit anchors |
| `HEDERA_NETWORK` | `mainnet` / `testnet` |

### D.9 Optional / Runtime

| Var | Purpose |
|---|---|
| `LOG_LEVEL` | pino level; default `info` |
| `NODE_ENV` | `development` / `production` |
| `BASE_PATH` | Vite `base:`; defaults `/` |
| `FRONTEND_DIST_PATH` | Override SPA static dir |

### D.10 Letta Service (Letta Railway service env)

| Var | Purpose |
|---|---|
| `LETTA_SERVER_PASSWORD` | Server password |
| `OPENROUTER_API_KEY` | LLM provider; **required** or agent runs fail |

### D.11 Mem0 Service (Mem0 Railway service env)

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | Embeddings |
| `JWT_SECRET` | Server-side JWT signing |
| `ADMIN_API_KEY` | Mem0 admin auth (sent as `X-API-Key` from api-server) |
| `POSTGRES_HOST/PORT/DB/USER/PASSWORD` | pgvector connection |
| `AUTH_DISABLED` | Auth flag |
| `MEM0_DEFAULT_EMBEDDER_MODEL`, `MEM0_DEFAULT_LLM_MODEL`, `MEM0_TELEMETRY` | Mem0 defaults |

---

## Appendix E. Glossary

- **Active Inference** — Information-theoretic principle that intelligent agents minimise surprise. Used loosely to describe the agent's confidence-driven research scheduling.
- **AHA moment** — Specific in-product event where a user perceives the value proposition. For this platform: org sees its gap vs. industry benchmark on the radar chart.
- **Anchor (Hedera)** — Persisting an event's hash on Hedera HCS for tamper-evident verification.
- **Bayesian credible interval** — A range $[a, b]$ such that the posterior probability of the parameter being in that range is, e.g., 95%. The Bayesian counterpart to a frequentist confidence interval; semantically more honest for use cases where the parameter is genuinely uncertain.
- **CVI (Capability Value Index)** — Composite 0–1000 score per industry; primary platform output.
- **CSO** — Chief Strategy Officer; primary enterprise buyer persona.
- **Conjugate Gaussian** — A Bayesian formulation where Normal prior + Normal likelihood yield Normal posterior, with closed-form update equations. Computationally cheap; suited to repeated incremental updating.
- **D3 force-directed layout** — Graph visualisation technique using simulated physical forces. Used for the knowledge graph.
- **EMA (Exponential Moving Average)** — Weighted average where recent observations carry more weight. Used to compute velocity from score deltas.
- **Enrichment** — Pipeline that transforms Perplexity research into structured DB rows (quadrants, value chains, company profiles) via the LLM synthesis layer (Claude Sonnet 4.6 default).
- **Explorer** — Free PLG tier.
- **GDP weight** — Per-industry economic weighting factor used in the CVI formula.
- **GraphQL (Railway)** — Authoritative way to inspect Railway state from a Claude shell. Documented in CLAUDE.md.
- **Hedera HCS** — Hedera Consensus Service, used to anchor audit-chain events with consensus timestamps.
- **Idempotent webhook** — Webhook handler safe to invoke multiple times with the same payload without changing state more than once. Required for Stripe / NowPayments callbacks.
- **KYC level B** — Identity verification + sanctions screening minimum required for marketplace payout.
- **LangGraph** — Framework for building stateful AI agents as directed graphs with typed state.
- **Letta** — Stateful memory framework providing persistent memory blocks across agent process restarts.
- **Mem0** — Semantic memory infrastructure with vector-DB-backed similarity search.
- **Methodology version** — Stamp on CVI / backtest computations; protects historical comparisons from being polluted by formula changes.
- **NRR (Net Revenue Retention)** — % of revenue retained from existing customers including expansion. >100% means expansion exceeds churn.
- **OpenAPI** — Specification language for HTTP APIs. The platform's contract authority lives in `lib/api-spec/openapi.yaml`.
- **Ontology** — Capability dependency graph; relationships have type and strength.
- **Orval** — Codegen tool that produces TanStack Query hooks and Zod validators from OpenAPI.
- **Perplexity Sonar** — Web research API; `sonar-pro` for CVI cycles, `sonar` for ad-hoc.
- **PLG (Product-Led Growth)** — Go-to-market motion where the product drives acquisition, expansion, and retention; sales is assistive.
- **Posterior** — In Bayesian inference, the updated belief about a parameter after observing evidence. Combines prior + likelihood.
- **Project token (Railway)** — UUID-format token scoped to a single Railway project; sent as `Project-Access-Token` header on the GraphQL endpoint.
- **R/Y/G threshold** — Red / Yellow / Green capability score bands with source citations and rationale.
- **SSE (Server-Sent Events)** — Push from server to browser over HTTP. Used to stream agent activity.
- **shadcn/ui** — Component library built on Radix UI primitives + Tailwind. Unstyled base, copy-paste integration.
- **Sub-capability** — Child capability auto-generated by Haiku 4.5; parents are pure rollups (weighted avg of children), never directly triangulated.
- **Triangulation** — Combining estimates from multiple heterogeneous sources to produce a single Bayesian posterior. The agent triangulates over 4 Perplexity epistemic frames.
- **VRIN** — Valuable, Rare, Inimitable, Non-substitutable. Barney 1991's criteria for resources yielding sustained competitive advantage.
- **War Room** — Live cross-org capability deliberation surface (read-mostly in Q2 2026).
- **WEF radar** — World Economic Forum's 7-axis competitiveness framework used as the assessment output visualisation.

---

**End of document.**






