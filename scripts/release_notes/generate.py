#!/usr/bin/env python3
"""Collect release candidates, invoke OpenCode, and validate a concise draft."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT_DIR = Path(".release-notes")
TAG_PATTERN = re.compile(r"^v?\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$")
MARKER_PATTERN = re.compile(r"<!--\s*release-entry:([a-z]+:[^>\s]+)\s*-->")
MARKER_COMMENT_PATTERN = re.compile(r"<!--\s*release-entry:[^>]*-->")
MARKER_LINE_PATTERN = re.compile(r"^  <!--\s*release-entry:([a-z]+:[^>\s]+)\s*-->$")
H2_PATTERN = re.compile(r"^##\s+.+$", re.MULTILINE)
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+.+$", re.MULTILINE)
ENTRY_TITLE_PATTERN = re.compile(r"^- \*\*(?P<title>[^*\n]+)\*\*(?:：(?P<description>\S.*))?$")
ATTRIBUTION_PATTERN = re.compile(r"^  - 作者：(?P<authors>.+) · 提交：(?P<commits>.+)$")
COMMIT_LINK_PATTERN = re.compile(r"\[`(?P<short_sha>[0-9A-Fa-f]+)`\]\((?P<url>[^)\s]+)\)")
PLACEHOLDER_PATTERN = re.compile(r"<[^>\n]+>")
CONVENTIONAL_COMMIT_PATTERN = re.compile(
    r"^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)]+\))?!?:\s*",
    re.IGNORECASE,
)
ALLOWED_SECTION_HEADINGS = ("## ✨ Features", "## 🐛 Bug Fixes")
GITHUB_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


@dataclass(frozen=True)
class ValidationResult:
    extra: tuple[str, ...]
    duplicated: tuple[str, ...]
    disallowed_sections: tuple[str, ...]
    format_errors: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not (self.extra or self.duplicated or self.disallowed_sections or self.format_errors)


def _validate_repository(repository: str) -> str:
    if not GITHUB_REPOSITORY_PATTERN.fullmatch(repository):
        raise ValueError(f"Invalid GitHub repository name: {repository!r}")
    return repository


def _git(repo_root: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), *args],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}") from error
    return result.stdout


def commit_shas_for_release(repo_root: Path, previous_ref: str | None, target_ref: str) -> list[str]:
    """Return release commits in chronological order, including the root for initial releases."""
    _git(repo_root, "rev-parse", "--verify", f"{target_ref}^{{commit}}")
    if previous_ref is None:
        revision = target_ref
    else:
        _git(repo_root, "rev-parse", "--verify", f"{previous_ref}^{{commit}}")
        ancestor = subprocess.run(
            ["git", "-C", str(repo_root), "merge-base", "--is-ancestor", previous_ref, target_ref],
            check=False,
            capture_output=True,
            text=True,
        )
        if ancestor.returncode != 0:
            raise ValueError(f"Previous ref {previous_ref!r} is not an ancestor of {target_ref!r}")
        revision = f"{previous_ref}..{target_ref}"
    output = _git(repo_root, "rev-list", "--reverse", revision, "--")
    return [sha for sha in output.splitlines() if sha]


def _status_name(code: str) -> str:
    return {"A": "added", "D": "removed", "M": "modified", "T": "modified"}.get(
        code[:1],
        "modified",
    )


def _changed_files(repo_root: Path, sha: str) -> list[dict[str, object]]:
    statuses: dict[str, str] = {}
    status_output = _git(
        repo_root,
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--name-status",
        "--no-renames",
        "-r",
        sha,
        "--",
    )
    for line in status_output.splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2:
            statuses[parts[1]] = _status_name(parts[0])

    stats: dict[str, tuple[int, int]] = {}
    stat_output = _git(
        repo_root,
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--numstat",
        "--no-renames",
        "-r",
        sha,
        "--",
    )
    for line in stat_output.splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        additions = int(parts[0]) if parts[0].isdigit() else 0
        deletions = int(parts[1]) if parts[1].isdigit() else 0
        stats[parts[2]] = (additions, deletions)

    files = []
    for filename in sorted(set(statuses) | set(stats)):
        additions, deletions = stats.get(filename, (0, 0))
        files.append(
            {
                "filename": filename,
                "status": statuses.get(filename, "modified"),
                "additions": additions,
                "deletions": deletions,
            }
        )
    return files


def _doc_diffs(repo_root: Path, sha: str, files: list[dict[str, object]]) -> list[dict[str, str]]:
    result = []
    for file in files:
        filename = str(file["filename"])
        if not filename.lower().endswith((".md", ".mdx")):
            continue
        patch = _git(repo_root, "show", "--format=", "--no-ext-diff", "--unified=3", sha, "--", filename)
        result.append({"filename": filename, "status": str(file["status"]), "patch": patch})
    return result


def _github_login(author_email: str) -> str | None:
    match = re.fullmatch(r"(?:\d+\+)?([^@]+)@users\.noreply\.github\.com", author_email)
    return match.group(1) if match else None


def fetch_commit_entry(repo_root: Path, repository: str, sha: str) -> dict[str, Any]:
    metadata = _git(repo_root, "show", "-s", "--format=%H%x00%s%x00%b%x00%an%x00%ae%x00%cI", sha)
    parts = metadata.rstrip("\n").split("\x00")
    if len(parts) != 6:
        raise RuntimeError(f"Unexpected git metadata format for commit {sha}")
    full_sha, title, body, author_name, author_email, committed_at = parts
    author_login = _github_login(author_email)
    files = _changed_files(repo_root, full_sha)
    return {
        "id": f"commit:{full_sha}",
        "kind": "commit",
        "sha": full_sha,
        "short_sha": full_sha[:7],
        "title": title.strip() or full_sha[:7],
        "body": body.strip(),
        "author": author_login or author_name or "unknown",
        "author_is_github_user": author_login is not None,
        "committed_at": committed_at.strip(),
        "url": f"https://github.com/{_validate_repository(repository)}/commit/{full_sha}",
        "changed_files": files,
        "doc_diffs": _doc_diffs(repo_root, full_sha, files),
    }


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def collect_entries(
    repository: str,
    previous_ref: str | None,
    target_ref: str,
    target_tag: str,
    output_dir: Path,
    repo_root: Path = Path("."),
) -> list[dict[str, Any]]:
    """Collect every candidate commit in the release range and cache it as JSON."""
    _validate_repository(repository)
    shas = commit_shas_for_release(repo_root, previous_ref, target_ref)
    if not shas:
        description = target_ref if previous_ref is None else f"{previous_ref}..{target_ref}"
        raise RuntimeError(f"No commits found in release range {description}")

    entries: list[dict[str, Any]] = []
    tasks: dict[object, str] = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        for sha in shas:
            future = executor.submit(fetch_commit_entry, repo_root, repository, sha)
            tasks[future] = sha

        for future in as_completed(tasks):
            sha = tasks[future]
            try:
                entries.append(future.result())
            except Exception as error:
                raise RuntimeError(f"Failed to fetch commit {sha}: {error}") from error

    commit_order = {sha: index for index, sha in enumerate(shas)}
    entries.sort(key=lambda entry: commit_order[str(entry["sha"])])
    tmp_dir = output_dir / "tmp"
    # The manifest is authoritative, so stale cache files can be ignored safely.
    # Avoid recursively deleting a caller-controlled output path.
    tmp_dir.mkdir(parents=True, exist_ok=True)

    manifest_entries = []
    for entry in entries:
        filename = f"commit_{str(entry['sha'])[:12]}.json"
        path = tmp_dir / filename
        _write_json(path, entry)
        manifest_entries.append({"id": entry["id"], "kind": entry["kind"], "file": str(path)})

    manifest = {
        "repository": repository,
        "previous_ref": previous_ref,
        "target_ref": target_ref,
        "target_tag": target_tag,
        "generated_at": datetime.now(UTC).isoformat(),
        "count": len(manifest_entries),
        "entries": manifest_entries,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(output_dir / "manifest.json", manifest)
    return entries


def load_candidate_entries(output_dir: Path) -> dict[str, dict[str, Any]]:
    manifest_path = output_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    candidates: dict[str, dict[str, Any]] = {}
    for manifest_entry in manifest["entries"]:
        identifier = str(manifest_entry["id"])
        if identifier in candidates:
            raise RuntimeError(f"Duplicate candidate ID in manifest: {identifier}")

        candidate_path = Path(str(manifest_entry["file"]))
        if not candidate_path.is_absolute() and not candidate_path.is_file():
            candidate_path = output_dir / candidate_path
        if not candidate_path.is_file():
            raise FileNotFoundError(f"Cached candidate not found: {candidate_path}")

        candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
        if str(candidate.get("id")) != identifier:
            raise RuntimeError(f"Cached candidate ID does not match manifest: {candidate_path}")
        candidates[identifier] = candidate
    return candidates


def _display_author(candidate: dict[str, Any]) -> str:
    author = str(candidate.get("author") or "unknown")
    return f"@{author}" if candidate.get("author_is_github_user") is True else author


def _validate_release_entry(
    lines: list[str],
    candidates: dict[str, dict[str, Any]],
    entry_number: int,
) -> list[str]:
    errors: list[str] = []
    label = f"entry {entry_number}"
    if not lines:
        return [f"{label} is empty"]

    title_match = ENTRY_TITLE_PATTERN.fullmatch(lines[0])
    if not title_match:
        errors.append(f"{label} title must use '- **<agent-written title>**' with an optional Chinese-colon summary")
        title = ""
    else:
        title = title_match.group("title").strip()
        if CONVENTIONAL_COMMIT_PATTERN.match(title):
            errors.append(f"{label} title must not keep a Conventional Commit prefix")

    attribution_matches = [
        (index, match)
        for index, line in enumerate(lines)
        if (match := ATTRIBUTION_PATTERN.fullmatch(line)) is not None
    ]
    if len(attribution_matches) != 1:
        errors.append(f"{label} must contain exactly one author and commit attribution line")
        attribution_match = None
    else:
        _, attribution_match = attribution_matches[0]

    marker_ids = [
        match.group(1)
        for line in lines
        if (match := MARKER_LINE_PATTERN.fullmatch(line)) is not None
    ]
    if not marker_ids:
        errors.append(f"{label} must contain at least one indented release-entry marker")

    recognized_lines = {0}
    recognized_lines.update(index for index, _ in attribution_matches)
    recognized_lines.update(index for index, line in enumerate(lines) if MARKER_LINE_PATTERN.fullmatch(line))
    if any(line.strip() and index not in recognized_lines for index, line in enumerate(lines)):
        errors.append(f"{label} contains content outside its title, attribution, and markers")

    linked_commits: list[tuple[str, str]] = []
    actual_authors: list[str] = []
    if attribution_match is not None:
        authors_text = attribution_match.group("authors")
        commits_text = attribution_match.group("commits")
        actual_authors = authors_text.split("、")
        if any(not author.strip() for author in actual_authors) or len(actual_authors) != len(set(actual_authors)):
            errors.append(f"{label} authors must be non-empty and deduplicated")

        link_matches = list(COMMIT_LINK_PATTERN.finditer(commits_text))
        linked_commits = [(match.group("short_sha"), match.group("url")) for match in link_matches]
        normalized_links = "、".join(match.group(0) for match in link_matches)
        if not linked_commits or normalized_links != commits_text:
            errors.append(f"{label} commits must be a Chinese-comma-separated list of cached short-SHA links")

    if len(linked_commits) != len(marker_ids):
        errors.append(f"{label} must contain one commit link and one marker for each adopted commit")

    expected_authors: list[str] = []
    linked_candidates: list[dict[str, Any]] = []
    for index, identifier in enumerate(marker_ids):
        candidate = candidates.get(identifier)
        if candidate is None:
            continue
        linked_candidates.append(candidate)
        author = _display_author(candidate)
        if author not in expected_authors:
            expected_authors.append(author)

        if index >= len(linked_commits):
            continue
        short_sha, url = linked_commits[index]
        if short_sha != str(candidate.get("short_sha")) or url != str(candidate.get("url")):
            errors.append(f"{label} commit links must match marker order and cached short SHA/URL values")

    if attribution_match is not None and actual_authors != expected_authors:
        errors.append(f"{label} authors must match adopted commits in first-appearance order")

    raw_titles = {str(candidate.get("title", "")).strip().casefold() for candidate in linked_candidates}
    if title and title.casefold() in raw_titles:
        errors.append(f"{label} title must be rewritten for users instead of copying a commit title")

    return errors


def validate_notes(output_dir: Path, target_tag: str) -> ValidationResult:
    candidates = load_candidate_entries(output_dir)
    candidate_ids = set(candidates)
    notes_path = output_dir / f"RELEASE_NOTES_{target_tag}.md"
    if not notes_path.is_file() or notes_path.stat().st_size == 0:
        return ValidationResult((), (), (), ("release notes file is missing or empty",))

    content = notes_path.read_text(encoding="utf-8")
    markers = Counter(MARKER_PATTERN.findall(content))
    found = set(markers)
    section_headings = H2_PATTERN.findall(content)
    section_counts = Counter(section_headings)
    disallowed_sections = tuple(
        dict.fromkeys(heading for heading in section_headings if heading not in ALLOWED_SECTION_HEADINGS)
    )

    format_errors: list[str] = []
    lines = content.splitlines()
    expected_title_prefix = f"# {target_tag} "
    if not lines or not lines[0].startswith(expected_title_prefix) or not lines[0][len(expected_title_prefix) :].strip():
        format_errors.append(f"title must start with {expected_title_prefix!r} and include a release theme")

    malformed_marker_count = len(MARKER_COMMENT_PATTERN.findall(content)) - sum(markers.values())
    if malformed_marker_count:
        format_errors.append("one or more release-entry markers are malformed")

    content_without_markers = MARKER_COMMENT_PATTERN.sub("", content)
    if PLACEHOLDER_PATTERN.search(content_without_markers):
        format_errors.append("release notes must not contain placeholders or unsupported HTML")

    for heading, count in section_counts.items():
        if heading in ALLOWED_SECTION_HEADINGS and count > 1:
            format_errors.append(f"section appears more than once: {heading}")

    allowed_positions = [
        ALLOWED_SECTION_HEADINGS.index(heading)
        for heading in section_headings
        if heading in ALLOWED_SECTION_HEADINGS
    ]
    if allowed_positions != sorted(allowed_positions):
        format_errors.append("Features must appear before Bug Fixes")

    headings = HEADING_PATTERN.findall(content)
    if any(len(prefix) != 2 for prefix in headings[1:]):
        format_errors.append("only the H1 title and allowed H2 section headings may be used")

    section_matches = list(H2_PATTERN.finditer(content))
    title_end = content.find("\n")
    content_after_title = "" if title_end == -1 else content[title_end + 1 :]
    if section_matches:
        preamble_start = title_end + 1 if title_end != -1 else len(content)
        if content[preamble_start : section_matches[0].start()].strip():
            format_errors.append("content must not appear before the first allowed section")
    elif content_after_title.strip():
        format_errors.append("content must be inside an allowed section")

    current_section: str | None = None
    for line in lines[1:]:
        if H2_PATTERN.fullmatch(line):
            current_section = line
            continue
        if MARKER_PATTERN.search(line) and current_section not in ALLOWED_SECTION_HEADINGS:
            format_errors.append("release-entry marker appears outside an allowed section")

    for index, match in enumerate(section_matches):
        heading = match.group(0)
        section_end = section_matches[index + 1].start() if index + 1 < len(section_matches) else len(content)
        section_body = content[match.end() : section_end]
        if heading in ALLOWED_SECTION_HEADINGS and not MARKER_PATTERN.search(section_body):
            format_errors.append(f"section has no attributed commit: {heading}")
        if heading not in ALLOWED_SECTION_HEADINGS:
            continue

        section_lines = section_body.splitlines()
        entry_starts = [line_index for line_index, line in enumerate(section_lines) if line.startswith("- ")]
        if not entry_starts:
            if section_body.strip():
                format_errors.append(f"section contains no valid release entries: {heading}")
            continue
        if any(line.strip() for line in section_lines[: entry_starts[0]]):
            format_errors.append(f"section contains content before its first release entry: {heading}")

        for entry_index, entry_start in enumerate(entry_starts):
            entry_end = entry_starts[entry_index + 1] if entry_index + 1 < len(entry_starts) else len(section_lines)
            entry_lines = section_lines[entry_start:entry_end]
            while entry_lines and not entry_lines[-1].strip():
                entry_lines.pop()
            format_errors.extend(
                _validate_release_entry(entry_lines, candidates, entry_number=entry_index + 1)
            )

    return ValidationResult(
        extra=tuple(sorted(found - candidate_ids)),
        duplicated=tuple(sorted(identifier for identifier, count in markers.items() if count > 1)),
        disallowed_sections=disallowed_sections,
        format_errors=tuple(dict.fromkeys(format_errors)),
    )


def check_opencode_model(opencode: str, model: str) -> None:
    result = subprocess.run(
        [opencode, "models", "--refresh"],
        check=True,
        capture_output=True,
        text=True,
    )
    available = {line.strip() for line in result.stdout.splitlines() if line.strip()}
    if model not in available:
        preview = ", ".join(sorted(available)[:10])
        raise RuntimeError(
            f"RELEASE_NOTES_MODEL={model!r} is unavailable. Use the full provider/model name. "
            f"First available models: {preview}"
        )


def run_skill(
    skill_name: str,
    output_dir: Path,
    target_tag: str,
    validation: ValidationResult | None = None,
) -> None:
    opencode = shutil.which("opencode")
    if not opencode:
        raise RuntimeError("The opencode executable is not available on PATH")
    model = os.environ.get("RELEASE_NOTES_MODEL", "").strip()
    command = [opencode]
    if model:
        command.extend(["--model", model])

    notes_path = output_dir / f"RELEASE_NOTES_{target_tag}.md"
    if validation is None:
        prompt = (
            f"Run the {skill_name} skill. The output directory is {output_dir}. "
            f"Generate concise release notes for {target_tag} from the candidate commits listed in "
            f"{output_dir / 'manifest.json'}. Write them to {notes_path}."
        )
    else:
        prompt = (
            f"Run the {skill_name} skill. Follow "
            f".opencode/skills/dsh-release-notes/VALIDATE.md to repair {notes_path} using "
            f"{output_dir / 'manifest.json'}. Extra IDs: {list(validation.extra)}. "
            f"Duplicated IDs: {list(validation.duplicated)}. "
            f"Disallowed sections: {list(validation.disallowed_sections)}. "
            f"Format errors: {list(validation.format_errors)}."
        )
    command.extend(["run", prompt])
    child_env = os.environ.copy()
    # Release creation credentials are unrelated to note generation. Keep them
    # out of the agent subprocess even on a compromised prompt.
    child_env.pop("GITHUB_TOKEN_RELEASE_NOTES", None)
    child_env.pop("GITHUB_TOKEN", None)
    completed = subprocess.run(command, check=False, env=child_env)
    if completed.returncode != 0:
        raise RuntimeError(f"OpenCode exited with status {completed.returncode}")


def print_validation(result: ValidationResult) -> None:
    print(
        json.dumps(
            {
                "extra": list(result.extra),
                "duplicated": list(result.duplicated),
                "disallowed_sections": list(result.disallowed_sections),
                "format_errors": list(result.format_errors),
                "ok": result.ok,
            },
            ensure_ascii=False,
        )
    )


def generate(args: argparse.Namespace) -> int:
    target_tag = args.target_tag
    if not TAG_PATTERN.fullmatch(target_tag):
        raise ValueError(f"Target tag must be semver-like (for example v0.6.0): {target_tag!r}")
    output_dir = Path(args.output_dir)
    repo_root = Path(args.repo_root).resolve()
    target_ref = args.target_ref or ("HEAD" if args.initial else target_tag)
    previous_ref = None if args.initial else args.previous_ref

    entries = collect_entries(
        args.repository,
        previous_ref,
        target_ref,
        target_tag,
        output_dir,
        repo_root,
    )
    print(f"Collected {len(entries)} release candidate commits")
    if args.collect_only:
        print(f"Wrote release manifest: {output_dir / 'manifest.json'}")
        return 0

    model = os.environ.get("RELEASE_NOTES_MODEL", "").strip()
    opencode = shutil.which("opencode")
    if not opencode:
        raise RuntimeError("The opencode executable is not available on PATH")
    if model:
        check_opencode_model(opencode, model)

    notes_path = output_dir / f"RELEASE_NOTES_{target_tag}.md"
    notes_path.unlink(missing_ok=True)
    run_skill("dsh-release-notes", output_dir, target_tag)

    for iteration in range(1, args.max_iterations + 1):
        result = validate_notes(output_dir, target_tag)
        print(f"Validation {iteration}/{args.max_iterations}:")
        print_validation(result)
        if result.ok:
            print(f"Validated concise release notes: {notes_path}")
            return 0
        if iteration < args.max_iterations:
            run_skill("dsh-release-notes", output_dir, target_tag, result)

    raise RuntimeError("Release notes still fail concise-content validation after repair attempts")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    release_range = parser.add_mutually_exclusive_group()
    release_range.add_argument("--previous-ref")
    release_range.add_argument(
        "--initial",
        action="store_true",
        help="include every commit reachable from --target-ref; no previous tag required",
    )
    parser.add_argument(
        "--target-ref",
        help="git ref to read commits from (default: HEAD for --initial, otherwise --target-tag)",
    )
    parser.add_argument("--target-tag", required=True)
    parser.add_argument("--repo-root", default=".", help="local git checkout to inspect (default: current directory)")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--max-iterations", type=int, default=3)
    parser.add_argument(
        "--collect-only",
        action="store_true",
        help="write the commit manifest without invoking OpenCode",
    )
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    if not args.validate_only:
        if not args.repository:
            parser.error("--repository or GITHUB_REPOSITORY is required")
        if not args.initial and not args.previous_ref:
            parser.error("one of --initial or --previous-ref is required")
    return args


def main() -> int:
    args = parse_args()
    try:
        if args.validate_only:
            result = validate_notes(Path(args.output_dir), args.target_tag)
            print_validation(result)
            return 0 if result.ok else 1
        return generate(args)
    except (FileNotFoundError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
