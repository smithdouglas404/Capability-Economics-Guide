-- Adds api_key + enabled columns to dify_workflow_registry so feature-flag
-- flips and Service API key resolution are DB-driven instead of Railway
-- env-var driven. New workflows registered via scripts/src/dify-workflow-
-- import.ts auto-populate both columns; the wrappers in
-- services/dify/workflows.ts read from here on every invocation (30s cache).
--
-- Also seeds the registry with the 14 apps that exist in Dify as of
-- 2026-05-17 (9 original UUIDs preserved across --update, 5 new apps
-- created during that pass) and backfills their minted Service API keys
-- + enabled=true.
--
-- After this migration runs, the Railway env vars (DIFY_APIKEY_<SLUG> +
-- DIFY_<SLUG>_ENABLED) are no longer load-bearing — DB row drives both.
-- You can leave them set as fallback or remove them; either works.
--
-- Idempotent. ADD COLUMN IF NOT EXISTS + INSERT … ON CONFLICT DO UPDATE.

ALTER TABLE dify_workflow_registry ADD COLUMN IF NOT EXISTS api_key text;
ALTER TABLE dify_workflow_registry ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false;

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash, api_key, enabled) VALUES
  ('onboarding-concierge',        '70dd51fa-a993-4c43-9244-bdcc3a29f46f', 'authored-2026-05-17', 'app-juplUP9v3OkgsOo1s0ndPJvj', true),
  ('tier-selector',               'a60a8d21-94cd-4bdc-8505-21e66b327b95', 'authored-2026-05-17', 'app-nq9ASvBDdKWpGVVpE39uD7ja', true),
  ('marketplace-search-v2',       '93f870c7-54d3-4bdf-8f3e-d6b45f2118d8', 'authored-2026-05-17', 'app-Amd5HxqPrCrj8W5CRYSQ08qa', true),
  ('listing-moderation',          '5f20af15-aeb5-4aa8-ba14-a6311b9ce4d8', 'authored-2026-05-17', 'app-1CsJEG8PTC2i8IOIDUyQ4AnO', true),
  ('kyc-failure-counselor',       'b838fc17-050a-40ab-af14-f77bd6308aaf', 'authored-2026-05-17', 'app-cBzJQ7F1oslLcDulX164Giw8', true),
  ('payment-recovery',            '6e32a52b-0ef8-4fab-ad78-6f160249ac56', 'authored-2026-05-17', 'app-l7n5Kiou5Opgjie113QateXV', true),
  ('capability-review-assist',    '5cd2bf53-a78b-4df2-a93e-f7e334cb94f6', 'authored-2026-05-17', 'app-yCNio5SFQRxS7tGB6Khp0pQg', true),
  ('research-pipeline',           'd6492230-6046-40c6-a228-5ad3daabbb0a', 'authored-2026-05-17', 'app-tGv0PBg6hiLyzhoZuyrIQYm4', true),
  ('synthesis-brief-composer',    'cff58498-79b7-489b-bb29-952c8e8b766b', 'authored-2026-05-17', 'app-GenTmg9NYPimtuLziehDjnrM', true),
  ('admin-config-proposer',       '89baedcd-d229-46e4-8b60-0308298b3926', 'authored-2026-05-17', 'app-m46BXx4ADHEWA4ge5yYb6Oqx', true),
  ('assessment-analyzer',         'c9fc0a37-bbef-485f-8861-429b9dd5aecb', 'authored-2026-05-17', 'app-8IreGwPBq3nSHaWfsoLOBWmF', true),
  ('capability-enrichment-retry', '63accc49-d6ef-4a79-a53a-f95c52dc5e0c', 'authored-2026-05-17', 'app-PrcqUpKsnmrHbpywMmNmb5vS', true),
  ('case-study-generator',        '72209754-4160-4bfc-808a-6f5889f78219', 'authored-2026-05-17', 'app-DxGhPqxhc1IuAhvX2GLopHkv', true),
  ('industry-bootstrap',          '36df5b54-b7c7-4ba6-ae7f-5cae9a32c8a7', 'authored-2026-05-17', 'app-sZnywc1BBcd3ja2A6YnBKoLi', true)
ON CONFLICT (slug) DO UPDATE SET
  dify_app_id = EXCLUDED.dify_app_id,
  api_key = EXCLUDED.api_key,
  enabled = EXCLUDED.enabled,
  imported_at = NOW();
