#!/usr/bin/env bash
# Session-start preflight — surfaces deploy-state truth so we don't chase
# downstream symptoms when the real cause is sitting in `git status`.
# Output: terse, "[preflight]"-prefixed lines on stdout. Never blocks.
set +e

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" 2>/dev/null

echo "[preflight] $(date +%H:%M:%S)"

# git state — the #1 cause of "Railway didn't deploy" is unpushed local commits.
if git rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git branch --show-current 2>/dev/null)
  git fetch --quiet origin "$branch" 2>/dev/null
  ahead=$(git rev-list --count "origin/${branch}..HEAD" 2>/dev/null || echo "?")
  behind=$(git rev-list --count "HEAD..origin/${branch}" 2>/dev/null || echo "?")
  dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "[preflight] git: ${branch} ahead=${ahead} behind=${behind} dirty=${dirty}"
  if [ "${ahead}" != "0" ] && [ "${ahead}" != "?" ]; then
    git log --oneline "origin/${branch}..HEAD" 2>/dev/null | head -5 | sed 's/^/[preflight]   unpushed: /'
  fi
fi

# gh CLI auth — needed for git push when origin uses HTTPS+credential helper.
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    echo "[preflight] gh: ok"
  else
    echo "[preflight] gh: needs auth (run 'gh auth login' in a Shell tab)"
  fi
fi

# Railway CLI auth — needed for redeploys + log fetching.
if command -v railway >/dev/null 2>&1; then
  if railway whoami >/dev/null 2>&1; then
    echo "[preflight] railway: ok"
  else
    echo "[preflight] railway: needs auth ('railway login --browserless' in Shell tab)"
  fi
fi

# Prod liveness — if this is non-2xx the api-server is dead and every
# downstream service probe will report misleading symptoms.
code=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" \
  https://capabilityeconomics-staging.up.railway.app/api/health/services 2>/dev/null)
echo "[preflight] prod /api/health/services: HTTP ${code:-ERR}"
