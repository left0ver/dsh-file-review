#!/bin/sh

set -eu

dsh_version=${1:-}
plugin_branch=${2:-}
sidebar_version=${3:-}

if [ -z "$dsh_version" ] || [ -z "$plugin_branch" ] || [ -z "$sidebar_version" ]; then
  echo 'Usage: ./adapter_script/start-dsh.sh <dsh-version> <plugin-branch> <better-sidebar-version> [dsh web options]' >&2
  exit 2
fi
shift 3

repository=https://github.com/left0ver/dsh-file-review.git
github_mirror=${GITHUB_MIRROR-https://gh-proxy.org/}
download_repository=${github_mirror%/}/$repository

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
root=$(dirname "$script_dir")
home_key=$(printf '%s-%s-%s' "$dsh_version" "$plugin_branch" "$sidebar_version" | tr -c 'a-zA-Z0-9._-' '-')
DSH_HOME=${DSH_HOME:-"$root/.e2e/dsh-home-$home_key"}
export DSH_HOME
profile_modules=$DSH_HOME/profiles/web/node_modules
workspace_file=$DSH_HOME/profiles/web/pnpm-workspace.yaml

allow_build() {
  key=$1
  grep -Fq "  '$key': true" "$workspace_file" 2>/dev/null && return
  grep -Fq "  $key: true" "$workspace_file" 2>/dev/null && return

  temporary_file=$workspace_file.tmp.$$
  if grep -q '^allowBuilds:[[:space:]]*$' "$workspace_file"; then
    awk -v entry="  '$key': true" '
      { print }
      !added && /^allowBuilds:[[:space:]]*$/ { print entry; added = 1 }
    ' "$workspace_file" >"$temporary_file"
  else
    awk -v entry="  '$key': true" '
      { print }
      END { print ""; print "allowBuilds:"; print entry }
    ' "$workspace_file" >"$temporary_file"
  fi
  mv "$temporary_file" "$workspace_file"
}

cd "$root"
echo "DSH $dsh_version; dsh-file-review $plugin_branch; dsh-better-sidebar $sidebar_version"
echo "DSH_HOME=$DSH_HOME"

if [ -f "$profile_modules/dsh-better-sidebar/package.json" ]; then
  echo 'dsh-better-sidebar is already installed; skipping.'
else
  npx --yes --package="@deepseek-ai/dsh@$dsh_version" dsh plugin --profile web add \
    --allow-build=node-pty "dsh-better-sidebar@$sidebar_version"
fi

allow_build node-pty
allow_build "dsh-file-review@git+$download_repository"

if [ -f "$profile_modules/dsh-file-review/package.json" ]; then
  echo 'dsh-file-review is already installed; skipping.'
else
  ref=$(git ls-remote --exit-code "$download_repository" "refs/heads/$plugin_branch") || {
    echo "GitHub branch does not exist or the mirror is unavailable: $plugin_branch" >&2
    exit 1
  }
  commit=${ref%%[[:space:]]*}
  echo "Installing dsh-file-review $plugin_branch@$(printf '%.7s' "$commit") via $github_mirror"
  npx --yes --package="@deepseek-ai/dsh@$dsh_version" dsh plugin --profile web add \
    "git+$download_repository#$commit"
fi

exec npx --yes --package="@deepseek-ai/dsh@$dsh_version" dsh web "$@"
