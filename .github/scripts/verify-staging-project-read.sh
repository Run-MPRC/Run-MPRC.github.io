#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf '%s\n' 'staging_authority_read_failed' >&2
  exit 1
}

[[ "${TARGET_PROJECT_ID:-}" == 'run-mprc-staging' ]] || fail
[[ -n "${GCP_ACCESS_TOKEN:-}" ]] || fail

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

curl --fail --silent --show-error --request GET \
  --header "Authorization: Bearer ${GCP_ACCESS_TOKEN}" \
  --header 'Accept: application/json' \
  'https://cloudresourcemanager.googleapis.com/v3/projects/run-mprc-staging' \
  --output "$response_file" || fail

jq -e '
  .projectId == "run-mprc-staging"
  and .name == "projects/384996399199"
  and .state == "ACTIVE"
' "$response_file" >/dev/null || fail

printf '%s\n' 'staging_authority_read_verified'
