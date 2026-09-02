#!/bin/sh

set -eu

dsh_version=${1:-}
sidebar_version=${2:-}

if [ -z "$dsh_version" ] || [ -z "$sidebar_version" ]; then
  echo 'Usage: ./scripts/run-e2e.sh <dsh-version> <better-sidebar-version> [Playwright options]' >&2
  exit 2
fi
shift 2

cd "$(dirname "$0")/.."
E2E_BETTER_SIDEBAR_SPEC="dsh-better-sidebar@$sidebar_version"
export E2E_BETTER_SIDEBAR_SPEC

npx --yes --package="@deepseek-ai/dsh@$dsh_version" \
  npm run test:e2e -- "$@"
