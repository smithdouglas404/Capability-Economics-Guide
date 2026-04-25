import { db, curriculumPacksTable } from "@workspace/db";
import { sql } from "drizzle-orm";

type Pack = {
  slug: string;
  title: string;
  subtitle: string;
  industrySlug: string;
  level: "undergrad" | "mba" | "executive";
  durationWeeks: number;
  learningObjectives: string[];
  caseStudyMarkdown: string;
  assignmentPrompts: { title: string; prompt: string; deliverable: string }[];
  rubricMarkdown: string | null;
  datasetExportUrls: { label: string; url: string }[];
  sourceCitations: { title: string; url: string }[];
};

const PACKS: Pack[] = [
  {
    slug: "banking-2026-fintech-challenger",
    title: "Banking 2026: Score a Fintech Challenger",
    subtitle: "Decide whether to acquire, partner with, or compete against a digital-native bank using live capability data.",
    industrySlug: "banking",
    level: "mba",
    durationWeeks: 2,
    learningObjectives: [
      "Decompose a digital-native bank into its constituent capabilities and compare them against incumbent benchmarks.",
      "Compute relative moat scores using the Capability Economics Index (CEI) framework.",
      "Translate capability gaps into concrete acquire / partner / compete recommendations.",
      "Construct a board-ready memo that defends a capital allocation decision under uncertainty.",
    ],
    caseStudyMarkdown: `# Banking 2026: Score a Fintech Challenger

## The dilemma

It is the second Tuesday of February 2026. Eleanor Voss, recently appointed Chief Strategy Officer of Cascadia Federal — a $94 billion regional bank headquartered in Portland, Oregon — is sitting in front of a deck her team prepared three weeks ago. The deck recommends a $1.4 billion acquisition of a European challenger bank with roughly nine million users in the United Kingdom and Western Europe. The challenger has never turned an annual profit. Its valuation has compressed 38 percent from its 2021 peak. The deck calls this a "discount window."

Voss is not convinced.

She has spent the last twenty years watching banks pay premium multiples for capabilities they could have built in eighteen months — and pay discount multiples for businesses whose capabilities decayed within twelve. The question on her mind is simple but unanswerable with the conventional valuation playbook: what is Cascadia actually buying? Customer acquisition machinery? A technology stack? A brand? A regulatory permission? Or just nine million email addresses with checking accounts attached?

## The setting

Cascadia Federal is a 132-year-old bank with strong commercial lending in the Pacific Northwest, a respected wealth management franchise, and a digital banking experience that internal NPS surveys describe as "adequate." Its return on tangible common equity sits at 14.2 percent — above peer median, below the digital-native cohort. Its core banking platform was last replaced in 2019, an effort that ran four months over schedule and $42 million over budget.

The challenger — call it Vega, since the deal team has redacted the actual name from circulating documents — was founded in 2015 in London. It runs on a modern microservices architecture. Its mobile app is the highest-rated banking app in the United Kingdom App Store. Its customer acquisition cost is $7.40 per funded account. Cascadia's blended figure is $284. Vega's payments capability processes 4.2 billion transactions per year on infrastructure built in-house. Its credit decisioning capability is, by Vega's own admission, "still in development."

Cascadia's deal team has framed the transaction as a "capability acquisition" — a phrase Voss finds simultaneously fashionable and unfalsifiable. She has asked her chief economist, a former McKinsey banking lead named Marcus Aurelio, to score Vega using the Capability Economics Index methodology that Cascadia's data science team licensed two quarters ago.

## The data

Aurelio's analysis covers fifteen capabilities across the banking value chain. For each capability he has computed three numbers: Vega's CEI score, the Cascadia score, and the global digital-native cohort median. The picture is uneven. Vega leads the cohort median in mobile experience (84 vs. 71), customer acquisition (88 vs. 64), and brand resonance among under-35 users (76 vs. 52). Vega trails the cohort median in credit decisioning (38 vs. 67), regulatory engagement (41 vs. 71), and capital efficiency (29 vs. 62).

Cascadia leads Vega in eight of the fifteen capabilities. Vega leads Cascadia in four. The remaining three are within statistical tie range.

The interesting cell in Aurelio's spreadsheet is the moat column. Of Vega's four leading capabilities, three score "thin" or "evaporating" on the AI-disruptability index — meaning that capabilities Vega is paying its team to maintain are capabilities that generative AI will commoditize within thirty-six months. Mobile UX, in particular, is forecast to compress to the cohort median by mid-2027 as foundation-model assistants reduce the marginal value of polished native apps.

The capability that does have a durable moat — Vega's payments infrastructure — is the one Cascadia could most easily license through existing vendor relationships at a fraction of the acquisition cost.

## The constraint

Voss has three options on the table.

**Acquire.** $1.4 billion in cash and stock. Closes Q3 2026, subject to regulatory approval. Capability-level integration risk is meaningful — the deal team's own analysis assumes 22 percent of Vega's engineering staff will depart within twelve months of close. Cost synergies are projected at $180 million annually by year three, of which the model assumes 60 percent realization.

**Partner.** Joint venture in which Cascadia provides regulatory perimeter and capital, Vega provides front-end and customer acquisition. Five-year exclusive in three Cascadia geographies. No premium paid up front; revenue share of 22 percent of net interest margin on jointly acquired customers. Vega's executive chair has signaled openness, contingent on Cascadia not pursuing a competing build.

**Build.** Allocate $340 million over three years to elevate Cascadia's mobile experience, payments throughput, and customer acquisition machinery to cohort-leading levels. Aurelio's CEI projections suggest this is feasible if Cascadia hires aggressively in three specific roles, retires its 2019 core banking decisions in two specific places, and accepts that the brand will not move among under-35 users for at least four years.

The board meets in nine days. Voss has been asked for a single-page recommendation by Friday.

## The question

She opens her laptop, pulls up the platform, and starts scoring.`,
    assignmentPrompts: [
      {
        title: "Score the cohort",
        prompt: "Use the screener to filter the banking industry for digital-native challengers. Add three of them — Revolut, Monzo, and one of your own choosing — to a portfolio. Sort by CEI composite. Note where each leads and where each trails the cohort median.",
        deliverable: "A screenshot of your portfolio table with a 200-word interpretation of the ranking, identifying which capabilities are doing the work and which are noise.",
      },
      {
        title: "Run a Diligence Pack",
        prompt: "Pick the highest-scoring challenger from your ranking and generate a Diligence Pack. Read it critically. Identify three claims that the data supports strongly and one claim that the data does not support.",
        deliverable: "A one-page critique annotating the Diligence Pack output. Cite specific CEI components or capability scores in your critique.",
      },
      {
        title: "Write the memo",
        prompt: "You are Eleanor Voss. The board meets in nine days. Recommend acquire, partner, or build. Defend your recommendation using capability-level evidence — not industry narrative.",
        deliverable: "A 500-word memo addressed to the Cascadia Federal board. Cite at least four capabilities by name and reference at least two CEI components. End with a single, falsifiable success metric.",
      },
    ],
    rubricMarkdown: `# Grading Rubric

| Dimension | Weight | Excellent (A) | Adequate (B/C) | Insufficient (D/F) |
|-----------|--------|---------------|----------------|--------------------|
| Capability literacy | 30% | Cites specific capabilities by name and demonstrates understanding of how each contributes to composite | Names capabilities but treats them as interchangeable | Falls back on industry-level generalities |
| Data discipline | 25% | Distinguishes signal from noise; flags low-confidence components | Uses platform numbers but does not interrogate them | Quotes numbers without attribution or context |
| Decision framing | 25% | States a clear acquire/partner/build recommendation with falsifiable success metric | Recommends but hedges; success metric is vague | No clear recommendation |
| Writing | 20% | Memo reads like a CSO would write it; respects the reader's time | Clear but verbose | Padded, repetitive, or hard to follow |
`,
    datasetExportUrls: [
      { label: "Banking companies (CSV)", url: "/api/export/csv?dataset=companies&industryId=1" },
      { label: "Banking CEI components (CSV)", url: "/api/export/csv?dataset=cei_components&industryId=1" },
      { label: "Banking capability moats (CSV)", url: "/api/export/csv?dataset=moats&industryId=1" },
    ],
    sourceCitations: [
      { title: "McKinsey Global Banking Annual Review 2025", url: "https://www.mckinsey.com/industries/financial-services/our-insights/global-banking-annual-review" },
      { title: "Wall Street Journal — Inside the Challenger Bank Margin Squeeze", url: "https://www.wsj.com/finance/banking" },
      { title: "Financial Times — Revolut and Monzo at Profitability Inflection", url: "https://www.ft.com/banking" },
      { title: "BCG Retail Banking Excellence Benchmarking 2025", url: "https://www.bcg.com/industries/financial-institutions/retail-banking" },
      { title: "Bloomberg Intelligence — European Neobank Coverage", url: "https://www.bloomberg.com/professional/product/bloomberg-intelligence/" },
    ],
  },
  {
    slug: "insurance-climate-risk-capability-gap",
    title: "Insurance: Climate Risk as a Capability Gap",
    subtitle: "Diagnose a P&C insurer's climate-modeling capability against the cohort and recommend a build-versus-buy path.",
    industrySlug: "insurance",
    level: "executive",
    durationWeeks: 1,
    learningObjectives: [
      "Frame climate-risk modeling as a capability rather than a regulatory obligation.",
      "Use Earnings Value at Risk (EVaR) to quantify the P&L exposure of a capability gap.",
      "Compare in-house build, vendor partnership, and reinsurance offload as capability strategies.",
    ],
    caseStudyMarkdown: `# Insurance: Climate Risk as a Capability Gap

## The room

Tatiana Brennan, Chief Underwriting Officer of Pacific Mutual — a $38 billion property and casualty insurer with significant exposure across the western United States — is staring at a heat map of her own balance sheet. Each red cell represents a ZIP code where Pacific Mutual's loss ratio has exceeded 110 percent for three consecutive years. The red cells are no longer isolated. They are now contiguous across portions of Oregon, Northern California, Nevada, and Arizona.

Her CEO has asked one question: is Pacific Mutual's climate-modeling capability good enough to keep writing in these markets, or is the company committing slow underwriting suicide?

Brennan's honest answer is that she does not know.

## The gap

Pacific Mutual's climate-risk modeling capability is built around a 2019 vendor solution, augmented by an internal team of seven actuaries who maintain a parallel model that the underwriting committee uses for non-binding sanity checks. The vendor's model has not been retrained on post-2022 wildfire data. The internal model has been retrained, but its outputs disagree with the vendor's by between 14 and 38 percent across the high-risk corridors.

Two of Pacific Mutual's three largest competitors have spent the last eighteen months rebuilding their climate-modeling capability in-house. One has hired a forty-person team and acquired a small geospatial analytics firm for $84 million. The other has signed a five-year partnership with a national lab. Both now publish capability scores on the Capability Economics Index that exceed the cohort median by margins Brennan finds uncomfortable.

Pacific Mutual's CEI score for "Climate Risk Capability" is 41. The cohort median is 58. The two leading competitors score 74 and 71 respectively.

## The exposure

Pacific Mutual's chief economist has run the EVaR — Earnings Value at Risk — calculation for the climate-modeling capability gap. The headline number is $312 million in annualized expected earnings shortfall, with a 90 percent confidence interval ranging from $180 million to $510 million. The shortfall is driven by two mechanisms: mispriced renewals where the model under-estimates loss frequency, and adverse selection in new business where competitors with better models cherry-pick the profitable risks and leave Pacific Mutual with the rest.

The CFO has independently estimated the cost of three remediation paths.

**Build.** A forty-person internal team plus a $35 million data infrastructure investment. Eighteen months to first production deployment. $48 million annual run-rate cost. Brennan's confidence in the team's ability to recruit forty qualified people in eighteen months is, she admits, modest.

**Buy.** Partnership with a leading climate-analytics vendor. $22 million annual subscription. Six months to first production deployment. Loses some control over model methodology and creates a dependency that the vendor could re-price at the next renewal.

**Offload.** Increase reinsurance cover on the high-risk corridors. Annual premium of $94 million. Reduces but does not eliminate the EVaR exposure. Reduces Pacific Mutual's ability to develop the underlying capability over time.

## The board

Pacific Mutual's board includes a former federal regulator, a retired CEO of a competing insurer, and a climate scientist who joined the board in 2024 as part of an ESG-driven refresh. The climate scientist has begun asking pointed questions. The regulator has begun asking polite questions that mean the same thing. The retired CEO has not yet asked anything, which Brennan reads as the loudest signal of all.

The next board meeting is in three weeks. Brennan has been asked for a recommendation, the EVaR exposure number, and a clear narrative the board can absorb in fifteen minutes.

She begins, as she always does, with the data.`,
    assignmentPrompts: [
      {
        title: "Pull the EVaR",
        prompt: "Open the insurance industry view, locate the Climate Risk Capability, and pull its EVaR exposure for Pacific Mutual's risk profile. Note the confidence interval and the components that drive it.",
        deliverable: "A 150-word note interpreting the EVaR for a non-quantitative reader. Include the 90% CI and identify the two largest contributing components.",
      },
      {
        title: "Identify the gap",
        prompt: "Compare Pacific Mutual's CEI score on climate risk capability against the cohort median and the two leaders. Identify which sub-capabilities are most responsible for the gap.",
        deliverable: "A capability scorecard table comparing four insurers across at least five climate-risk sub-capabilities, with a one-paragraph diagnostic.",
      },
      {
        title: "Recommend the path",
        prompt: "Choose build, buy, or offload. Justify your recommendation against the EVaR exposure, the implementation timeline, and Pacific Mutual's strategic position.",
        deliverable: "A one-page board memo with explicit decision, timeline, cost, and a single accountability metric to be reviewed at the following board meeting.",
      },
    ],
    rubricMarkdown: `# Grading Rubric

| Dimension | Weight | Excellent | Adequate | Insufficient |
|-----------|--------|-----------|----------|--------------|
| EVaR fluency | 35% | Reads EVaR with appropriate skepticism; identifies driver components | Reports EVaR number without context | Misinterprets or ignores EVaR |
| Capability decomposition | 30% | Distinguishes between modeling, data, and underwriting integration sub-capabilities | Treats climate-risk as a single capability | No decomposition |
| Path defensibility | 25% | Build/buy/offload choice is defended on capability and exposure grounds | Choice is defended on cost grounds only | No clear choice |
| Board readability | 10% | Memo is one page, scannable in 90 seconds | Memo is clear but long | Memo buries the recommendation |
`,
    datasetExportUrls: [
      { label: "Insurance companies (CSV)", url: "/api/export/csv?dataset=companies&industryId=2" },
      { label: "Insurance EVaR snapshot (CSV)", url: "/api/export/csv?dataset=evar&industryId=2" },
      { label: "Climate-risk capability scores (CSV)", url: "/api/export/csv?dataset=capability_scores&industryId=2" },
    ],
    sourceCitations: [
      { title: "Swiss Re sigma — Natural Catastrophes 2025", url: "https://www.swissre.com/institute/research/sigma-research" },
      { title: "Munich Re NatCatSERVICE Annual Review", url: "https://www.munichre.com/en/insights/natural-disaster-and-climate-change.html" },
      { title: "Deloitte 2026 Insurance Outlook", url: "https://www2.deloitte.com/us/en/insights/industry/financial-services/financial-services-industry-outlooks/insurance-industry-outlook.html" },
      { title: "McKinsey — Climate Risk and Decarbonization in Insurance", url: "https://www.mckinsey.com/industries/financial-services/our-insights" },
    ],
  },
  {
    slug: "healthcare-capability-moats-value-based",
    title: "Healthcare: Capability Moats in a Value-Based World",
    subtitle: "Plan a five-year capability roadmap for a regional hospital system competing against integrated systems and specialty groups.",
    industrySlug: "healthcare",
    level: "mba",
    durationWeeks: 3,
    learningObjectives: [
      "Distinguish durable from transient capability moats under value-based care reimbursement.",
      "Construct a five-year capability investment roadmap with explicit sequencing logic.",
      "Use comparable-systems analysis to identify which capabilities differentiate winners from laggards.",
      "Translate the roadmap into a Boardroom Pack that survives scrutiny from clinical, operational, and financial board members.",
    ],
    caseStudyMarkdown: `# Healthcare: Capability Moats in a Value-Based World

## The handoff

Dr. Imani Okafor inherited the CEO role at Meridian Regional Health on the first business day of January 2026, two weeks after her predecessor's abrupt retirement. Meridian is a six-hospital, $4.2 billion-revenue regional system serving the central Midwest. Its primary competitors include a forty-hospital integrated system to the north, a ten-hospital faith-based system to the south, and a growing constellation of single-specialty groups — orthopedics, cardiology, oncology — that have systematically extracted Meridian's most profitable service lines over the last decade.

Okafor's first board meeting included a slide that has not left her thoughts. It showed Meridian's commercial payer mix shifting toward value-based contracts at a rate of roughly six percentage points per year. By 2030, more than half of Meridian's commercial revenue will be tied to capitation, shared savings, or bundled-payment arrangements. By 2032, the figure will exceed 70 percent.

The slide ended with a question: which of Meridian's capabilities will matter under that revenue model, and which will not?

## The puzzle

Healthcare strategy under fee-for-service was, in retrospect, intuitive. Volume mattered. Throughput mattered. Marquee specialists mattered. Margin came from doing more procedures at higher acuity. Capability was a means to volume.

Under value-based care, the equation inverts. Avoided admissions become revenue, not lost revenue. Care coordination capabilities — the ones that prevent the hospitalization in the first place — become more valuable than the surgical capabilities that historically drove the P&L. Population health management, social-determinants intervention, behavioral-health integration, and primary-care access become economically primary. Specialty depth remains important but no longer dominates.

The single-specialty groups that have eaten Meridian's lunch under fee-for-service are, in many cases, ill-equipped for value-based contracts. They lack the population denominator. They lack the primary-care attribution. They lack the data infrastructure to manage risk across an attributed panel. The integrated system to the north has all three. The faith-based system to the south has aggressive capability investments underway in two of the three.

## The data

Okafor's chief strategy officer has scored Meridian against the four named comparables across thirty-one capabilities. Meridian leads in five — primarily clinical excellence in cardiology, neurology, and complex surgery. Meridian trails the integrated system in seventeen, most concentrated in the data, coordination, and population-health domains. Meridian is roughly tied with the faith-based system in the remaining nine.

The CEI moat scores tell a more granular story. Of Meridian's five leading capabilities, three score "transient" — cardiology and neurology in particular face increasing competitive pressure from the specialty groups, and the durability of Meridian's lead is forecast to compress materially within thirty-six months. Of Meridian's seventeen lagging capabilities, eleven score "durable" once acquired — meaning that the integrated system's lead, if not contested, will compound.

The economic implication is clear. The capabilities Meridian leads in are losing economic value. The capabilities Meridian trails in are gaining economic value. The trajectory, if uncorrected, is decline.

## The constraint

Okafor has one hundred and twenty million dollars in capital available for capability investment over the next five years, plus the ability to redirect roughly two hundred million more in operating budget through deliberate reallocation. She does not have the option of competing across all thirty-one capabilities. She must pick.

She has scheduled a three-day strategy retreat with her senior team in eight weeks. Before the retreat, she has asked each of her four service-line presidents and her chief medical officer to propose a capability portfolio — five to seven capabilities to invest in aggressively, five to seven to maintain at current levels, and five to seven to deprioritize or exit.

The proposals are due in four weeks. Okafor will pick from among them.

## The chair

The chair of Meridian's board is a former CEO of a national health insurer. He has told Okafor, in private, that he will support a credible five-year roadmap regardless of where it lands — but he will not support an incremental plan that pretends the world is not changing.

Okafor opens the platform and begins scoring.`,
    assignmentPrompts: [
      {
        title: "Build the portfolio",
        prompt: "In the pipeline tool, create a portfolio containing four healthcare comparables: Meridian and three of its named competitors. Score each across the platform's full healthcare capability set.",
        deliverable: "A portfolio export with a 300-word interpretation identifying the three capabilities most responsible for the gap between Meridian and the leading integrated system.",
      },
      {
        title: "Sequence the roadmap",
        prompt: "Construct a five-year capability investment roadmap. Sequence aggressively-invest, maintain, and deprioritize capabilities. Justify each sequencing choice on capability-moat grounds, not budget grounds.",
        deliverable: "A roadmap document with explicit Year 1 through Year 5 milestones and a one-paragraph defense of each capability assignment.",
      },
      {
        title: "Generate the Boardroom Pack",
        prompt: "Use the Boardroom Pack generator to produce a board-ready presentation of the roadmap. Critique what the generator produces — what is the Boardroom Pack good at communicating, and what does it miss?",
        deliverable: "The generated Boardroom Pack plus a 400-word critique with at least three concrete suggestions for how a human strategist must augment the output before presenting it to a real board.",
      },
    ],
    rubricMarkdown: `# Grading Rubric

| Dimension | Weight | Excellent | Adequate | Insufficient |
|-----------|--------|-----------|----------|--------------|
| Strategic logic | 30% | Roadmap follows from value-based-care economics, not generic best practice | Roadmap is reasonable but generic | Roadmap is a wishlist |
| Sequencing | 25% | Year-over-year sequencing is defensible — early investments enable later ones | Sequencing is plausible | No sequencing logic |
| Comparable analysis | 20% | Cites specific competitor capabilities and explains how Meridian closes or leapfrogs | Notes competitors but does not engage with their capability mix | Ignores competition |
| Boardroom critique | 15% | Identifies AI-generated artifacts that would not survive board scrutiny | Critique is descriptive, not prescriptive | Accepts Boardroom Pack uncritically |
| Writing | 10% | Roadmap reads like a CEO wrote it | Clear but mechanical | Padded |
`,
    datasetExportUrls: [
      { label: "Healthcare systems (CSV)", url: "/api/export/csv?dataset=companies&industryId=3" },
      { label: "Healthcare capability moats (CSV)", url: "/api/export/csv?dataset=moats&industryId=3" },
      { label: "Healthcare CEI components (CSV)", url: "/api/export/csv?dataset=cei_components&industryId=3" },
    ],
    sourceCitations: [
      { title: "Health Affairs — Value-Based Care Adoption Trends 2025", url: "https://www.healthaffairs.org/" },
      { title: "Advisory Board — Hospital Strategy Outlook 2026", url: "https://www.advisory.com/" },
      { title: "McKinsey on Healthcare Systems and Services", url: "https://www.mckinsey.com/industries/healthcare/our-insights" },
      { title: "CMS Innovation Center — APM Performance Reports", url: "https://innovation.cms.gov/" },
      { title: "Kaufman Hall — National Hospital Flash Report", url: "https://www.kaufmanhall.com/insights" },
    ],
  },
  {
    slug: "retail-ai-disruptability-long-tail",
    title: "Retail: AI Disruptability and the Long Tail",
    subtitle: "Diagnose which retail capabilities are evaporating and identify where to invest as a department-store chain hits an AI inflection point.",
    industrySlug: "retail",
    level: "undergrad",
    durationWeeks: 2,
    learningObjectives: [
      "Read AI-disruptability scores at the capability level rather than the company level.",
      "Use whitespace analysis to identify capabilities a firm could plausibly own that no incumbent currently dominates.",
      "Use trade-signal data to validate the timing of a capability investment.",
    ],
    caseStudyMarkdown: `# Retail: AI Disruptability and the Long Tail

## The chain

Larkspur is a 142-store department-store chain operating primarily across the southeastern United States. It generates $5.1 billion in annual revenue, employs roughly 19,000 people, and has been profitable in seventeen of the last twenty years — a record that places it ahead of most peers in a brutal sector. Its private-label apparel program is widely admired. Its loyalty program has 11 million members, of whom roughly 4 million are active on a trailing-twelve-month basis.

In December 2025, Larkspur's CEO of nine years announced his retirement. The board appointed Marisol Ortega — formerly the chief commercial officer of a major European fashion retailer — as his successor. She started on January fifteenth.

Three weeks into the role, Ortega convened a meeting of her direct reports and asked one question: which of Larkspur's capabilities will be worth maintaining in 2030?

The room was quiet for longer than she expected.

## The pressure

Larkspur's competitive set has shifted three times in the last decade. First, Amazon and the broader e-commerce wave compressed margin in apparel and home goods. Second, vertically integrated direct-to-consumer brands attacked Larkspur's private-label proposition. Third — and this is the wave Ortega believes is most underappreciated by Larkspur's leadership — generative AI assistants have begun materially shifting how consumers shop.

The platform's AI-disruptability scores tell the story Ortega is trying to make her team see. Of Larkspur's twenty-two top-level capabilities, nine score "high" or "very high" on AI disruptability — meaning that within thirty-six months, foundation-model assistants and AI-driven retail tools will substantially erode the marginal value of those capabilities. The list includes search-and-discovery, personalization, customer service, basic merchandising, and a swath of marketing functions that Larkspur has historically considered competitive strengths.

Of the remaining thirteen capabilities, six score "low" — meaning AI compresses them only marginally — and seven score "moderate." The low-disruptability capabilities cluster around physical experience, store operations, supply chain logistics, supplier relationships, private-label design, and trust and brand. These are the capabilities Ortega believes Larkspur should defend and extend.

The capabilities Larkspur has historically over-invested in are concentrated in the high-disruptability bucket. The capabilities Ortega believes Larkspur should now over-invest in are concentrated in the low-disruptability bucket. The reorientation will be neither cheap nor popular.

## The whitespace

Ortega has asked her chief data officer to run the platform's whitespace analysis for the retail industry. The analysis identifies capabilities where no incumbent has established a dominant position — capabilities that are economically meaningful, technologically tractable, and currently un-owned.

Three candidates surface from the analysis. First, "store-as-fulfillment-node" — a capability bundle around using physical store inventory and labor to serve digital orders at lower cost than dedicated fulfillment centers. Second, "private-label data-driven design" — a capability bundle around using purchase data and trend signals to drive private-label assortment decisions on a much shorter cycle than the eighteen-month industry standard. Third, "trusted-curation-at-scale" — a capability bundle around using human merchandising judgment as a moat against AI-driven sameness.

All three are plausibly within Larkspur's reach. None can be addressed without disinvesting elsewhere.

## The signal

Ortega's chief economist has begun reviewing trade-signal data — capability-level investment patterns across the retail sector. The signals suggest that two of Larkspur's largest competitors are already moving capital toward "store-as-fulfillment-node." One has begun publicly discussing the strategy in earnings calls. The other has not, but the trade signals are unambiguous.

The other two whitespace candidates appear, for now, to be uncontested.

## The board

Larkspur's board includes two former retail CEOs, a private-equity partner, the founder of a successful direct-to-consumer brand, and a recently retired federal labor secretary. They have given Ortega ninety days to present a strategic direction. They have not given her a budget number — they have indicated, instead, that she should propose one.

Her first draft is due in three weeks.`,
    assignmentPrompts: [
      {
        title: "Map the disruptability landscape",
        prompt: "Use the platform to pull AI-disruptability scores for the retail industry. Group capabilities into high, moderate, and low disruptability buckets. Identify which of Larkspur's historical strengths fall into each bucket.",
        deliverable: "A grouped table of retail capabilities by AI-disruptability tier with a 200-word interpretation of how Larkspur's strengths are distributed.",
      },
      {
        title: "Run the whitespace scanner",
        prompt: "Open the whitespace tool and identify the three highest-scoring whitespace candidates in retail. For each, note why no incumbent has established dominance.",
        deliverable: "A short whitespace report with three candidates ranked, including a one-sentence diagnosis of why each remains uncontested.",
      },
      {
        title: "Validate with trade signals",
        prompt: "Pull trade signals for the three whitespace capabilities. Identify which capabilities are quietly being contested by competitors and which appear to remain uncontested.",
        deliverable: "A 300-word memo recommending which whitespace capability Larkspur should pursue first, defended on disruptability, whitespace, and timing grounds.",
      },
    ],
    rubricMarkdown: `# Grading Rubric

| Dimension | Weight | Excellent | Adequate | Insufficient |
|-----------|--------|-----------|----------|--------------|
| Disruptability literacy | 30% | Reads scores critically and recognizes the difference between automation and substitution | Uses scores at face value | Ignores or misreads scores |
| Whitespace identification | 25% | Distinguishes plausible from implausible whitespace; engages with why incumbents have not moved | Lists whitespace mechanically | No engagement |
| Timing | 20% | Uses trade signals to defend the timing of recommended action | Mentions trade signals | Ignores timing |
| Recommendation | 15% | Single, clear, falsifiable recommendation | Recommendation hedges | No recommendation |
| Writing | 10% | Memo is concise and decision-grade | Clear but long | Padded |
`,
    datasetExportUrls: [
      { label: "Retail companies (CSV)", url: "/api/export/csv?dataset=companies&industryId=4" },
      { label: "Retail AI-disruptability (CSV)", url: "/api/export/csv?dataset=ai_disruptability&industryId=4" },
      { label: "Retail whitespace candidates (CSV)", url: "/api/export/csv?dataset=whitespace&industryId=4" },
      { label: "Retail trade signals (CSV)", url: "/api/export/csv?dataset=trade_signals&industryId=4" },
    ],
    sourceCitations: [
      { title: "BCG — The Future of Retail in the Age of AI", url: "https://www.bcg.com/industries/retail" },
      { title: "McKinsey State of the Consumer 2025", url: "https://www.mckinsey.com/industries/retail/our-insights" },
      { title: "NRF Retail Industry Outlook 2026", url: "https://nrf.com/research" },
      { title: "WSJ Retail Coverage", url: "https://www.wsj.com/business/retail" },
    ],
  },
  {
    slug: "strategic-management-live-capability-dataset",
    title: "Strategic Management: A Live Capability Dataset",
    subtitle: "Replace a strategic-management textbook with the platform itself for a full undergraduate semester.",
    industrySlug: "technology",
    level: "undergrad",
    durationWeeks: 14,
    learningObjectives: [
      "Develop fluency in capability-based strategic analysis across multiple industries.",
      "Use live data sources to evaluate strategic claims rather than relying on case archives.",
      "Cite primary-source data in a research paper using the platform's citation export.",
      "Distinguish strategic frameworks that hold up under live data from those that do not.",
    ],
    caseStudyMarkdown: `# Strategic Management: A Live Capability Dataset

## The premise

This course is an experiment.

For roughly forty years, the introductory strategic-management course at most undergraduate business programs has been taught from a textbook, supplemented by a small portfolio of canonical case studies — most of them assembled at the Harvard Business School or the Ivey School and most of them drawn from the period between 1985 and 2015. The case method, in its current form, predates the personal computer. It predates the internet. It predates almost every shift in how companies actually compete.

This course departs from that tradition. The textbook is the platform.

Across the next fourteen weeks, you will use the Capability Economics Index — a live dataset covering tens of thousands of capabilities across six industries — as the primary source for every strategic question we ask. There will still be readings. There will still be lectures. But the data you analyze will not be five years old. It will not be assembled into a tidy narrative. It will be the actual capability inventory of actual firms competing in actual markets, updated continuously by enrichment pipelines and triangulated against multiple primary sources.

The implications are substantial.

First, you cannot rely on the case archive's selection bias. The case archive is a curated museum of strategic decisions that someone — usually a faculty member, decades after the fact — judged to be interesting. The platform contains the firms that interested the case archivists and the firms that did not. This matters. The lessons strategy textbooks draw from the curated subset are, in many cases, lessons that do not survive contact with the unselected majority.

Second, the conventional analytical frameworks — Porter's Five Forces, the Resource-Based View, blue-ocean strategy, dynamic capabilities, the BCG growth-share matrix — were each developed against a particular dataset and a particular era. Some hold up beautifully against the live data. Others do not. You will be asked, repeatedly, to test framework against data and to report what you find. You will not always find what the textbooks predict.

Third, you will be asked to write a research paper. The paper will use the platform's citation export to ground every empirical claim in a primary source. You will not be permitted to cite "the consensus" or "industry experts" or "well-known dynamics." Every claim must be either logically derived from data you can point to or explicitly labeled as conjecture.

## The cycle

The course follows a weekly cycle. Each week, we will pick one feature of the platform, one industry, and one strategic question. You will spend the first half of the week using the feature to investigate the question. You will spend the second half writing a short response — between four hundred and seven hundred words — that defends a position with reference to specific platform outputs.

Examples of the questions we will ask: Which insurers have closed the climate-modeling capability gap fastest, and what did they do? Which retail capabilities are most under attack from generative AI, and which are not? Which healthcare systems generate above-cohort moats with below-cohort capability investment? Which banks are vulnerable to fintech entry and which are not? Which industries have capability dispersion that suggests imminent consolidation?

You will not always find satisfying answers. The data will sometimes be ambiguous. The platform will sometimes contradict itself. Strategy is not a branch of mathematics, and the platform is not an oracle.

## The paper

Your final project is a research paper of roughly five thousand words. The topic is your choice, subject to two constraints.

First, the paper must address a strategic question that admits a defensible answer using the platform's data. You may not write a paper whose argument requires data the platform does not contain.

Second, the paper must include a complete citation export. Every empirical claim must be footnoted to a specific data point or primary source visible in the platform. The bibliography must contain at least twenty distinct sources, of which at least ten must be primary sources from the platform's citation system.

The papers that have done best in past offerings of this course have shared three characteristics. They picked questions narrow enough that the data could actually answer them. They engaged honestly with data that contradicted their initial hypothesis. And they ended with a clear, falsifiable claim that someone could, in principle, disprove with future data.

## The contract

You will leave this course with three things.

You will leave with fluency in capability-based strategic analysis. You will be able to look at a firm and decompose it into its constituent capabilities. You will be able to read a CEI score and understand what it does and does not tell you. You will be able to construct a defensible strategic argument from primary-source data.

You will leave with a healthy skepticism of strategic frameworks. You will know which ones survive contact with live data and which ones do not. You will not be impressed by frameworks that demand the world conform to them.

You will leave with a research paper you can show employers, graduate-school admissions committees, or your own future self.

That is the deal. The semester begins next Monday.`,
    assignmentPrompts: [
      {
        title: "Weekly cycle",
        prompt: "Each week, pick one platform feature, one industry, and one strategic question assigned by the instructor. Use the feature to investigate the question, then write a 400 to 700 word response defending a position with reference to specific platform outputs.",
        deliverable: "Fourteen weekly responses, submitted by 11:59 PM each Sunday. Late responses lose 20% per day. Each response must reference at least two specific platform outputs by name.",
      },
      {
        title: "Mid-semester capability profile",
        prompt: "Pick one firm of strategic interest to you. Construct a complete capability profile for that firm using the platform's data. Identify three capabilities where the firm leads its cohort, three where it lags, and three where the data is ambiguous.",
        deliverable: "A 1,200-word capability profile with explicit citations to platform data and a one-page summary table.",
      },
      {
        title: "Final research paper",
        prompt: "Write a research paper of approximately 5,000 words addressing a strategic question of your choosing. The question must admit a defensible answer using the platform's data. The paper must include a complete citation export with at least 20 distinct sources, of which at least 10 must be primary sources from the platform's citation system.",
        deliverable: "A 5,000-word research paper plus a complete citation export. Drafts due Week 11. Final due during finals week. Late papers lose one full letter grade per 24 hours.",
      },
    ],
    rubricMarkdown: `# Grading Rubric

| Component | Weight | Notes |
|-----------|--------|-------|
| Weekly responses | 35% | Average of fourteen weekly grades. Lowest two dropped. |
| Mid-semester capability profile | 20% | Quality of decomposition, defensibility of conclusions, citation discipline. |
| Final research paper | 35% | Question selection, engagement with contradictory evidence, falsifiability of final claim, citation completeness. |
| Class participation | 10% | Substantive engagement with peers' arguments. Quality matters more than frequency. |

## Final paper grading dimensions

| Dimension | Weight |
|-----------|--------|
| Question quality | 20% — Is the question narrow enough to answer? Does it matter? |
| Evidence discipline | 25% — Are claims grounded in cited data? Is contradictory evidence engaged? |
| Argument structure | 20% — Does the paper build a position rather than survey a field? |
| Falsifiability | 15% — Could the central claim, in principle, be disproved? |
| Writing | 10% — Is the paper readable? |
| Citation completeness | 10% — Twenty sources minimum; ten primary minimum. |
`,
    datasetExportUrls: [
      { label: "Cross-industry capabilities (CSV)", url: "/api/export/csv?dataset=capabilities" },
      { label: "All companies (CSV)", url: "/api/export/csv?dataset=companies" },
      { label: "All CEI snapshots (CSV)", url: "/api/export/csv?dataset=cei_snapshots" },
      { label: "Citation export (CSV)", url: "/api/export/csv?dataset=citations" },
      { label: "Capability moats (CSV)", url: "/api/export/csv?dataset=moats" },
    ],
    sourceCitations: [
      { title: "Porter — Competitive Strategy (1980)", url: "https://www.hbs.edu/faculty/Pages/profile.aspx?facId=6532" },
      { title: "Barney — Firm Resources and Sustained Competitive Advantage (1991)", url: "https://journals.sagepub.com/doi/10.1177/014920639101700108" },
      { title: "Teece, Pisano, Shuen — Dynamic Capabilities (1997)", url: "https://onlinelibrary.wiley.com/journal/10970266" },
      { title: "Kim and Mauborgne — Blue Ocean Strategy (2005)", url: "https://www.blueoceanstrategy.com/" },
      { title: "Christensen — The Innovator's Dilemma (1997)", url: "https://www.christenseninstitute.org/" },
      { title: "Capability Economics Platform — Primary Source Citations", url: "https://capabilityeconomics.com/citations" },
    ],
  },
];

async function main() {
  console.log(`Seeding ${PACKS.length} curriculum packs...`);

  await db.execute(sql`TRUNCATE curriculum_packs RESTART IDENTITY CASCADE`);

  for (const pack of PACKS) {
    await db.insert(curriculumPacksTable).values(pack);
    console.log(`  inserted: ${pack.slug}`);
  }

  const rows = await db.select({ id: curriculumPacksTable.id }).from(curriculumPacksTable);
  console.log(`Done. ${rows.length} curriculum packs in the database.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
