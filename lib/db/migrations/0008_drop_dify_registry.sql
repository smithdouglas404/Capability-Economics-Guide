-- Dify integration ripped out 2026-05-18. The two scaffolding tables go.
-- Product data tables (tier_recommendations, kyc_appeals,
-- payment_recovery_log, research_artifacts) stay — they hold real user
-- actions not workflow scaffolding.
--
-- Idempotent. Re-running is a no-op.

DROP TABLE IF EXISTS dify_workflow_registry;
DROP TABLE IF EXISTS dify_callback_log;
