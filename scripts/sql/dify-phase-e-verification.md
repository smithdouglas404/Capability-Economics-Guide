# Dify Phase E — verification curls

Run after the importer has populated `dify_workflow_registry` and per-workflow
Service API keys are set on the api-server. `$INFLEX` should resolve to the
production base URL (`https://capabilityeconomics-staging.up.railway.app`).

## 0. Registry + health sanity

```bash
# All 14 workflows registered with a Dify app id
psql "$PROD_DATABASE_URL" -c "SELECT slug, dify_app_id, version_hash FROM dify_workflow_registry ORDER BY slug;"
# Expect: 14 rows

# Dify still healthy
curl -s $INFLEX/api/health/services | jq '.services[] | select(.service=="dify")'
# Expect: status: "ok"
```

## 1. HMAC callback round-trip (Phase B re-verification)

```bash
# Unsigned should reject
curl -s -i -X POST $INFLEX/api/dify/callback/seed-board \
  -H 'Content-Type: application/json' \
  -d '{"clientRequestId":"test-1","clerkUserId":"u_xxx","boardSeed":{}}' | head -1
# Expect: HTTP/1.1 401 (or 403)

# Signed should accept (replay protection: re-running returns 200 idempotent)
BODY='{"clientRequestId":"e2e-test-001","clerkUserId":"user_2xxxxxxxxxxxxxxxxx","boardSeed":{"boardName":"Smoke test","cards":[]}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$DIFY_CALLBACK_KEY" -hex | awk '{print $2}')
curl -s -X POST $INFLEX/api/dify/callback/seed-board \
  -H "Content-Type: application/json" \
  -H "X-Dify-Callback-Signature: $SIG" \
  -d "$BODY"
# Expect: { "ok": true } and a new row in dify_callback_log + workbench_boards
```

## 2. Per-workflow smoke tests (after each Service API key is set)

```bash
# onboarding-concierge — already wired into routes/onboarding.ts (POST /onboarding/start)
curl -s -X POST $INFLEX/api/onboarding/start \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" -H "Content-Type: application/json" \
  -d '{"industryId": 1}'
# Expect: returns first card body. If DIFY_ONBOARDING_CONCIERGE_ENABLED=1, log line shows source=dify.

# tier-selector
curl -s -X POST $INFLEX/api/me/membership/concierge \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "I track 3 industries weekly with my team"}'
# Expect: 200 with {answer, conversationId, recommendedTier?: "briefing"}

# marketplace-search-v2 — gated under DIFY_MARKETPLACE_SEARCH_V2_ENABLED=1
curl -s "$INFLEX/api/marketplace/listings/search?q=cybersecurity%20risk%20assessment"
# Expect: source: "dify-v2" when v2 returned ids, else falls back to "dify"/"keyword_fallback"

# listing-moderation — fires async on listing submit
curl -s -X POST $INFLEX/api/marketplace/listings/$LISTING_ID/submit \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN"
# Verify side-effect:
psql "$PROD_DATABASE_URL" -c "SELECT moderation_hints FROM marketplace_listings WHERE id=$LISTING_ID;"
# Expect: jsonb populated within ~10s of submit

# kyc-failure-counselor — only available on declined verifications
curl -s -X POST $INFLEX/api/kyc/$VERIFICATION_ID/counselor \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "I just moved last month so my address didnt match"}'
# Expect: 200 with chat answer; 409 if verification is not in declined state

# payment-recovery — only available on past_due / unpaid subscriptions
curl -s -X POST $INFLEX/api/me/payment-recovery \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "Help me update my card"}'
# Expect: 200 with chat answer; 409 if subscription is not past_due

# capability-review-assist — fires async on review reject-with-comment
curl -s -X POST $INFLEX/api/review/$CAPABILITY_ID/reject \
  -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"comment": "Narrative is too generic — needs specific dollar figures"}'
# Verify:
psql "$PROD_DATABASE_URL" -c "SELECT kind, payload FROM research_artifacts WHERE capability_id=$CAPABILITY_ID AND kind='revision_prompts' ORDER BY id DESC LIMIT 1;"

# research-pipeline — exercised indirectly via /admin/backfill-ai-narratives (when DIFY_RESEARCH_PIPELINE_ENABLED=1)

# synthesis-brief-composer — fires on cron, manual trigger:
# (no direct API — observe logs for "[Agent] Synthesis agent (source=dify)")

# assessment-analyzer — embedded in /api/assess/start + /api/assess/analyze
curl -s -X POST $INFLEX/api/assess/start \
  -H "Content-Type: application/json" \
  -d '{"companyName":"TestCo","industry":"Healthcare","opportunity":"Reduce time-to-answer for case escalations"}'
# Expect: { sessionId, questions[], source: "dify" } when enabled

# industry-bootstrap — exercised via POST /api/industries (admin)
curl -s -X POST $INFLEX/api/industries \
  -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"name": "Test Industry XYZ"}'
# Expect: 201 with industry seed; check capabilities count

# case-study-generator — admin trigger
curl -s -X POST $INFLEX/api/admin/case-studies/$CASE_STUDY_ID/regenerate-economics-breakdown \
  -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"companyName": "Acme Corp"}'
# Expect: { ok: true, breakdown: {...}, source: "dify" } when enabled

# capability-enrichment-retry — new admin endpoint
curl -s -X POST $INFLEX/api/admin/capability-enrichment-retry/$CAPABILITY_ID \
  -H "x-admin-key: $ADMIN_API_KEY"
# Expect: { status: "ok"|"degraded", payload: {...} }

# admin-config-proposer — new admin endpoint
curl -s -X POST $INFLEX/api/admin/config-propose \
  -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "configArea": "economic_rules",
    "currentValues": {"cvi_floor": 35, "evar_alarm_bp": 250},
    "recentOutcomes": {"cvi_under_floor_count_30d": 4, "evar_breaches_30d": 1}
  }'
# Expect: { status: "proposals_queued"|"no_proposals", payload: {proposals:[...], abstentions:[...]} }
# Then verify in the existing UI at /admin/agent/proposals
```

## 3. LangSmith trace verification (optional — only if LangSmith env vars set)

After running any of the above, navigate to https://smith.langchain.com → your
project → recent runs. Expect ONE trace per workflow invocation, with the
HTTP-Request callback step nested inside it.

## 4. Failure-mode checks

```bash
# Workflow disabled → null → legacy path runs
curl -s -X POST $INFLEX/api/me/membership/concierge \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "test"}'
# With DIFY_TIER_SELECTOR_ENABLED unset: expect 503 (workflow unavailable). Frontend should fall back to static tier cards.

# Wrong HMAC on callback → 401, no DB write
WRONG_SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "wrong-key" -hex | awk '{print $2}')
curl -s -i -X POST $INFLEX/api/dify/callback/seed-board \
  -H "Content-Type: application/json" -H "X-Dify-Callback-Signature: $WRONG_SIG" \
  -d "$BODY" | head -1
# Expect: HTTP/1.1 401, no row in dify_callback_log
```
