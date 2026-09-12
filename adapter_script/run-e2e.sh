#!/bin/sh

set -eu

dsh_version=${1:-}

if [ -z "$dsh_version" ]; then
  echo 'Usage: ./adapter_script/run-e2e.sh <dsh-version> [Playwright options]' >&2
  exit 2
fi
shift 1

cd "$(dirname "$0")/.."

npx --yes --package="@deepseek-ai/dsh@$dsh_version" \
  npm run test:e2e -- "$@"
