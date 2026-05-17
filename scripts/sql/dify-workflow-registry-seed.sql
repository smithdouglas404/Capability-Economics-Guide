-- Dify workflow registry seed — applies all 14 slug → Dify app id mappings.
--
-- Apply against the Capability Economics Postgres (the inflexcvi api-server's
-- DATABASE_URL) so resolveAppId() in services/dify/workflows.ts can find each
-- app:
--
--   psql "$PROD_DATABASE_URL" -f scripts/sql/dify-workflow-registry-seed.sql
--
-- Idempotent: ON CONFLICT updates dify_app_id + version_hash + imported_at.
-- The 9 original UUIDs were preserved across the --update import on 2026-05-17;
-- the 5 new slugs (admin-config-proposer, assessment-analyzer,
-- capability-enrichment-retry, case-study-generator, industry-bootstrap) were
-- created in that same import and have the new UUIDs below.

-- ── 9 original apps (UUIDs preserved across --update) ────────────────────
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('onboarding-concierge',     '70dd51fa-a993-4c43-9244-bdcc3a29f46f', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('tier-selector',            'a60a8d21-94cd-4bdc-8505-21e66b327b95', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('marketplace-search-v2',    '93f870c7-54d3-4bdf-8f3e-d6b45f2118d8', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('listing-moderation',       '5f20af15-aeb5-4aa8-ba14-a6311b9ce4d8', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('kyc-failure-counselor',    'b838fc17-050a-40ab-af14-f77bd6308aaf', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('payment-recovery',         '6e32a52b-0ef8-4fab-ad78-6f160249ac56', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('capability-review-assist', '5cd2bf53-a78b-4df2-a93e-f7e334cb94f6', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('research-pipeline',        'd6492230-6046-40c6-a228-5ad3daabbb0a', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('synthesis-brief-composer', 'cff58498-79b7-489b-bb29-952c8e8b766b', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

-- ── 5 new apps (created during the 2026-05-17 --update import) ───────────
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('admin-config-proposer',        '89baedcd-d229-46e4-8b60-0308298b3926', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('assessment-analyzer',          'c9fc0a37-bbef-485f-8861-429b9dd5aecb', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('capability-enrichment-retry',  '63accc49-d6ef-4a79-a53a-f95c52dc5e0c', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('case-study-generator',         '72209754-4160-4bfc-808a-6f5889f78219', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES
  ('industry-bootstrap',           '36df5b54-b7c7-4ba6-ae7f-5cae9a32c8a7', 'authored-2026-05-17')
ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
