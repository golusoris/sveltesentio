#!/usr/bin/env bash
# Runs .semgrep.yml from the digest-pinned semgrep image over every tracked
# JavaScript and TypeScript file; scripts/semgrep-report.mjs judges the report.
# --test replays .config/semgrep/testdata/ instead: each `ruleid:` line must be
# reported and each `ok:` line must not.
#
# Usage: scripts/semgrep-scan.sh [--test]
set -euo pipefail

readonly SEMGREP_VERSION=1.180.0
readonly SEMGREP_IMAGE_DIGEST=sha256:529ee8a277ec8adc5b534d7c74eea0a47e9de21d62852b6ba7ac6ba9566845c3
# busybox xargs in the image splits a longer list, which makes the JSON report invalid.
readonly max_files=2048

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly root
# mirror.gcr.io serves Docker Hub's digests; hosted runners hit the anonymous Hub pull limit.
readonly image="${SCAN_IMAGE_REGISTRY:-mirror.gcr.io}/semgrep/semgrep:${SEMGREP_VERSION}@${SEMGREP_IMAGE_DIGEST}"
readonly docker_bin="${DOCKER_BIN:-docker}"
readonly flags='--metrics=off --disable-version-check'

if (($# > 1)) || { (($# == 1)) && [[ "$1" != --test ]]; }; then
	printf 'usage: %s [--test]\n' "${0##*/}" >&2
	exit 2
fi

if (($# == 1)); then
	# semgrep --test pairs a rule file with test files of the same base name.
	exec "$docker_bin" run --rm -v "$root:/src:ro" --entrypoint sh "$image" -ec "
		mkdir /t
		cp /src/.semgrep.yml /t/rules.yaml
		cp /src/.config/semgrep/testdata/rules.* /t/
		cd /t
		semgrep scan --test $flags ."
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$root" ls-files -z -- '*.ts' '*.js' '*.mjs' '*.cjs' \
	':!:.config/hiss/testdata/**' ':!:.config/semgrep/testdata/**' ':!:tools/figures/player/**' >"$work/files"
count="$(tr -cd '\0' <"$work/files" | wc -c)"
if ((count == 0 || count > max_files)); then
	printf 'semgrep: %d files selected, expected 1..%d\n' "$count" "$max_files" >&2
	exit 1
fi

# Findings and errors go into the report, so semgrep exits 0 on any scan that ran.
"$docker_bin" run --rm -i -v "$root:/src:ro" -w /src --entrypoint sh "$image" -ec \
	"xargs -0 semgrep scan --config .semgrep.yml --json --oss-only --no-git-ignore $flags" \
	<"$work/files" >"$work/report.json"
node "$root/scripts/semgrep-report.mjs" "$work/report.json" "$work/files"
