#!/usr/bin/env bash
# Opens, updates, or closes a tracking issue for a workflow run based on STATUS.
#
# Callers:
# - .github/workflows/scorecard.yml (threshold job)
# - .github/workflows/refresh-upstream-docs.yml (report job)
#
# Inputs via env:
# - TITLE: issue title
# - LABEL: label name
# - LABEL_COLOR: hex color for label
# - LABEL_DESCRIPTION: description for label
# - STATUS: workflow status (success|failure)
# - RUN: URL of workflow run
# - FAIL_BODY: body text when opening new issue
# - REPEAT_COMMENT: body text when commenting on existing open issue
# - PASS_COMMENT: body text when closing issue on success
#
# The three texts may contain the literal $RUN, which is replaced with the run URL.

set -euo pipefail

if [[ "${STATUS:-}" != "success" && "${STATUS:-}" != "failure" ]]; then
	echo "STATUS must be 'success' or 'failure', got: '${STATUS:-}'" >&2
	exit 1
fi

FAIL_BODY="${FAIL_BODY//\$RUN/$RUN}"
REPEAT_COMMENT="${REPEAT_COMMENT//\$RUN/$RUN}"
PASS_COMMENT="${PASS_COMMENT//\$RUN/$RUN}"

export TITLE

gh label create "$LABEL" --repo "$GITHUB_REPOSITORY" --color "$LABEL_COLOR" --force \
	--description "$LABEL_DESCRIPTION"

number="$(gh issue list --repo "$GITHUB_REPOSITORY" --label "$LABEL" --state open --json number,title \
	--jq 'map(select(.title == env.TITLE)) | .[0].number // empty')"

if [[ "$STATUS" == success ]]; then
	if [[ -n "$number" ]]; then
		gh issue close "$number" --repo "$GITHUB_REPOSITORY" --comment "$PASS_COMMENT"
	fi
elif [[ -n "$number" ]]; then
	gh issue comment "$number" --repo "$GITHUB_REPOSITORY" --body "$REPEAT_COMMENT"
else
	gh issue create --repo "$GITHUB_REPOSITORY" --title "$TITLE" --label "$LABEL" \
		--body "$FAIL_BODY"
fi
