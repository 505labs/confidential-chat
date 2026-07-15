#!/usr/bin/env bash
# update-readme-digest.sh — rewrite the auto-managed provenance block in README.md
# with the freshly built image digest. Called by .github/workflows/build.yml.
#
#   update-readme-digest.sh <digest> <git-sha> <build-time> <image-ref>
set -euo pipefail

DIGEST="${1:?digest required}"      # sha256:....
SHA="${2:?git sha required}"
BUILT="${3:?build time required}"
IMAGE="${4:?image ref required}"    # ghcr.io/owner/repo

SHORT_SHA="${SHA:0:7}"
# URL-encode the ':' in the digest so the shields.io badge label renders.
BADGE_DIGEST="${DIGEST/sha256:/sha256%3A}"

README="README.md"
START="<!-- DIGEST:START -->"
END="<!-- DIGEST:END -->"

BLOCK_FILE="$(mktemp)"
trap 'rm -f "$BLOCK_FILE"' EXIT
cat > "$BLOCK_FILE" <<EOF
$START
<div align="center">

[![image digest](https://img.shields.io/badge/image-${BADGE_DIGEST:0:26}...-2ea44f?style=for-the-badge&logo=docker&logoColor=white)](https://github.com/505labs/confidential-chat/pkgs/container/confidential-chat)
[![source commit](https://img.shields.io/badge/commit-${SHORT_SHA}-24292e?style=for-the-badge&logo=github&logoColor=white)](https://github.com/505labs/confidential-chat/commit/${SHA})

**🔒 Currently deployed in the TEE**

\`\`\`
image   ${IMAGE}@${DIGEST}
commit  ${SHA}
built   ${BUILT}  (UTC, by GitHub Actions)
\`\`\`

<sub>Pull this exact image: <code>docker pull ${IMAGE}@${DIGEST}</code> — the digest above is what the running app shows in its footer.</sub>

</div>
$END
EOF

# Splice: on the START marker, emit the block file (which itself contains both
# markers), then skip the old lines through END. index() avoids regex pitfalls.
awk -v s="$START" -v e="$END" -v bf="$BLOCK_FILE" '
  index($0, s) { while ((getline line < bf) > 0) print line; close(bf); skip=1; next }
  index($0, e) { skip=0; next }
  !skip { print }
' "$README" > "$README.tmp" && mv "$README.tmp" "$README"

echo "README updated: ${DIGEST:0:19}... @ $SHORT_SHA"
