/**
 * Seeds the single-row `reference_org_selection_rule` table with the
 * default criterion the Perplexity-driven org populator
 * (`seed-reference-orgs.ts`) applies per industry.
 *
 * The rule itself is the thing you defend to a customer: "this is how we
 * pick the orgs that anchor your peer benchmark." Editable later via admin
 * UI without redeploy (the populator reads the latest value every run).
 *
 * Idempotent: inserts if no row exists; never overwrites an existing rule
 * (use the admin UI to update, so the version bump is tracked and the next
 * populator run picks up the change).
 *
 * Skip with SKIP_REFERENCE_ORG_RULE_SEED=1.
 */
import { db, referenceOrgSelectionRuleTable } from "@workspace/db";

const DEFAULT_RULE_TEXT =
  `Per industry, the top 10 companies globally by trailing-12-month revenue, ` +
  `mixing public + largest known private, including at least 2 non-US companies ` +
  `and at least 1 disruptor or SMB where one materially exists in the industry. ` +
  `Each entry must have a source URL (annual report, regulatory filing, or ` +
  `recognized industry-revenue tracker — Bloomberg, Forbes, S&P, IDC, Gartner, ` +
  `or the company's own audited financials).`;

async function main(): Promise<void> {
  if (process.env.SKIP_REFERENCE_ORG_RULE_SEED === "1") {
    console.log("[seed:reference-org-rule] SKIP_REFERENCE_ORG_RULE_SEED=1 — skipping");
    return;
  }

  const existing = await db.select().from(referenceOrgSelectionRuleTable).limit(1);
  if (existing.length > 0) {
    console.log(`[seed:reference-org-rule] rule already seeded (version ${existing[0]!.ruleVersion}, last applied ${existing[0]!.lastAppliedAt ?? "never"}) — skipping`);
    return;
  }

  await db.insert(referenceOrgSelectionRuleTable).values({
    ruleText: DEFAULT_RULE_TEXT,
    ruleVersion: 1,
    perplexityModel: "sonar",
    refreshIntervalDays: 90,
  });
  console.log("[seed:reference-org-rule] inserted default rule (version 1)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed:reference-org-rule] failed:", err);
    process.exit(1);
  });
