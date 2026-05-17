-- Backfill api_key + enabled into dify_workflow_registry for the 14
-- workflows minted on 2026-05-17. Apply once after the new schema
-- columns (api_key, enabled) land on prod via drizzle-kit push:
--
--   psql "$PROD_DATABASE_URL" -f scripts/sql/dify-workflow-registry-keys-backfill.sql
--
-- After this runs, the env vars in Railway (DIFY_APIKEY_<SLUG> +
-- DIFY_<SLUG>_ENABLED) are no longer load-bearing — the DB row drives
-- both decisions. You can leave the env vars in place as a fallback or
-- remove them; either works.

UPDATE dify_workflow_registry SET api_key = 'app-juplUP9v3OkgsOo1s0ndPJvj',   enabled = true WHERE slug = 'onboarding-concierge';
UPDATE dify_workflow_registry SET api_key = 'app-nq9ASvBDdKWpGVVpE39uD7ja',   enabled = true WHERE slug = 'tier-selector';
UPDATE dify_workflow_registry SET api_key = 'app-Amd5HxqPrCrj8W5CRYSQ08qa',   enabled = true WHERE slug = 'marketplace-search-v2';
UPDATE dify_workflow_registry SET api_key = 'app-1CsJEG8PTC2i8IOIDUyQ4AnO',   enabled = true WHERE slug = 'listing-moderation';
UPDATE dify_workflow_registry SET api_key = 'app-cBzJQ7F1oslLcDulX164Giw8',   enabled = true WHERE slug = 'kyc-failure-counselor';
UPDATE dify_workflow_registry SET api_key = 'app-l7n5Kiou5Opgjie113QateXV',   enabled = true WHERE slug = 'payment-recovery';
UPDATE dify_workflow_registry SET api_key = 'app-yCNio5SFQRxS7tGB6Khp0pQg',   enabled = true WHERE slug = 'capability-review-assist';
UPDATE dify_workflow_registry SET api_key = 'app-tGv0PBg6hiLyzhoZuyrIQYm4',   enabled = true WHERE slug = 'research-pipeline';
UPDATE dify_workflow_registry SET api_key = 'app-GenTmg9NYPimtuLziehDjnrM',   enabled = true WHERE slug = 'synthesis-brief-composer';
UPDATE dify_workflow_registry SET api_key = 'app-m46BXx4ADHEWA4ge5yYb6Oqx',   enabled = true WHERE slug = 'admin-config-proposer';
UPDATE dify_workflow_registry SET api_key = 'app-8IreGwPBq3nSHaWfsoLOBWmF',   enabled = true WHERE slug = 'assessment-analyzer';
UPDATE dify_workflow_registry SET api_key = 'app-PrcqUpKsnmrHbpywMmNmb5vS',   enabled = true WHERE slug = 'capability-enrichment-retry';
UPDATE dify_workflow_registry SET api_key = 'app-DxGhPqxhc1IuAhvX2GLopHkv',   enabled = true WHERE slug = 'case-study-generator';
UPDATE dify_workflow_registry SET api_key = 'app-sZnywc1BBcd3ja2A6YnBKoLi',   enabled = true WHERE slug = 'industry-bootstrap';
