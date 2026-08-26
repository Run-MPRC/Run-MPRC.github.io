#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf '%s\n' 'staging_authority_context_invalid' >&2
  exit 1
}

[[ "${GITHUB_REPOSITORY:-}" == 'Run-MPRC/Run-MPRC.github.io' ]] || fail
[[ "${GITHUB_REPOSITORY_ID:-}" == '718285092' ]] || fail
[[ "${GITHUB_REPOSITORY_OWNER_ID:-}" == '150727922' ]] || fail
[[ "${GITHUB_REF:-}" == 'refs/heads/main' ]] || fail
[[ "${GITHUB_WORKFLOW_REF:-}" == 'Run-MPRC/Run-MPRC.github.io/.github/workflows/verify-staging-authority.yml@refs/heads/main' ]] || fail
[[ "${TARGET_ENVIRONMENT:-}" == 'staging' ]] || fail
[[ "${TARGET_PROJECT_ID:-}" == 'run-mprc-staging' ]] || fail
[[ "${DEPLOY_SERVICE_ACCOUNT:-}" == 'mprc-staging-deploy@run-mprc-staging.iam.gserviceaccount.com' ]] || fail
[[ "${WORKLOAD_IDENTITY_PROVIDER:-}" == 'projects/384996399199/locations/global/workloadIdentityPools/github-actions/providers/run-mprc-staging' ]] || fail

printf '%s\n' 'staging_authority_context_valid'
