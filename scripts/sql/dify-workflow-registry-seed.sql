-- Generated 2026-05-17 from a successful Dify Console import of all 9
-- workflow YAMLs at dify-workflows/*.yml against the inflexcvi-dify
-- Railway project. Apply against the Capability Economics Postgres
-- (the api-server's DATABASE_URL) to populate dify_workflow_registry so
-- resolveAppId() in services/dify/workflows.ts can find the apps.
--
--   psql "$PROD_DATABASE_URL" -f scripts/sql/dify-workflow-registry-seed.sql
--
-- Idempotent — ON CONFLICT updates dify_app_id + version_hash + imported_at.

INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES ('capability-review-assist', '5cd2bf53-a78b-4df2-a93e-f7e334cb94f6', 'bee3d3bcf2747b6224591e8ca6f619fbef5bb6cb6a9a812934a07c997db47add') ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES ('kyc-failure-counselor', 'b838fc17-050a-40ab-af14-f77bd6308aaf', '67d4e8c296375e09dae589ae7745ae679c625783c273c84e553cdd1047dcbc6a') ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES ('listing-moderation', '5f20af15-aeb5-4aa8-ba14-a6311b9ce4d8', '8328b055d0775289918f1a78e495adfe623bcb6004e96e155d999e7fa783acee') ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES ('marketplace-search-v2', '93f870c7-54d3-4bdf-8f3e-d6b45f2118d8', '15182bc83f7378ebdf1068297d371eecb34a40313a027b5406d2d5a37e5e9e7f') ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES ('onboarding-concierge', '70dd51fa-a993-4c43-9244-bdcc3a29f46f', '501c706a278f94ddd2499b3a531c22ca3c4cb1474d2fc30e808b01f9d6a11b04') ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES ('payment-recovery', '6e32a52b-0ef8-4fab-ad78-6f160249ac56', 'c14bef35909fd2a2f0cd9daa415d228522e400a0114b2f92378855ee72aea5ec') ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES ('research-pipeline', 'd6492230-6046-40c6-a228-5ad3daabbb0a', '2d312e1dc963b824b6718e51c2416172fa4cda8424ff1be067a512e19fd160de') ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES ('synthesis-brief-composer', 'cff58498-79b7-489b-bb29-952c8e8b766b', '219080736c27abece15ca31bfdc818817e160d543caf408bd5c90a5b140418f9') ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
INSERT INTO dify_workflow_registry (slug, dify_app_id, version_hash) VALUES ('tier-selector', 'a60a8d21-94cd-4bdc-8505-21e66b327b95', '9d7efb628560887487b810fe7cf48a4cbbeae9f143922683ee5b6e7c4d0d1885') ON CONFLICT (slug) DO UPDATE SET dify_app_id = EXCLUDED.dify_app_id, version_hash = EXCLUDED.version_hash, imported_at = NOW();
