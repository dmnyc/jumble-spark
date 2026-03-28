#!/usr/bin/env bash
# Build main app and NIP-66 monitor images locally; push to silberengel/imwald-jumble and silberengel/imwald-jumble-nip66-monitor as :latest and :<version from package.json>.
# Then create git tag v<version> and push it.
# Run from repo root. Requires: docker, docker login, git.
#
# Optional env:
#   JUMBLE_PROXY_SERVER_URL — build-arg VITE_PROXY_SERVER (default https://jumble.imwald.eu).
#     Must match the public origin where Apache serves the app; Apache proxies /sites/ → :8090, not this container.
#   READ_ALOUD_TTS_URL — build-arg VITE_READ_ALOUD_TTS_URL (default /api/piper-tts).
#     Same-origin: Apache proxies /api/piper-tts → aitherboard (e.g. :9876). Override only if you use CORS on another host.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
GIT_TAG="v${VERSION}"
IMAGE_APP="silberengel/imwald-jumble"
IMAGE_MONITOR="silberengel/imwald-jumble-nip66-monitor"

# OG / link-preview HTML: VITE_PROXY_SERVER is baked into the client bundle at image build time (not runtime).
# Use public origin only (no /proxy path): web.service builds <origin>/sites/?url=…
# Override: JUMBLE_PROXY_SERVER_URL=https://other.example ./scripts/build-and-push-prod.sh
JUMBLE_PROXY_SERVER_URL="${JUMBLE_PROXY_SERVER_URL:-https://jumble.imwald.eu}"
READ_ALOUD_TTS_URL="${READ_ALOUD_TTS_URL:-/api/piper-tts}"

echo "Building main app (version: $VERSION, VITE_PROXY_SERVER=$JUMBLE_PROXY_SERVER_URL, VITE_READ_ALOUD_TTS_URL=$READ_ALOUD_TTS_URL)"
docker build \
  --build-arg "VITE_PROXY_SERVER=$JUMBLE_PROXY_SERVER_URL" \
  --build-arg "VITE_READ_ALOUD_TTS_URL=$READ_ALOUD_TTS_URL" \
  -t "$IMAGE_APP:latest" -t "$IMAGE_APP:$VERSION" .

echo "Building NIP-66 monitor (version: $VERSION)"
docker build -t "$IMAGE_MONITOR:latest" -t "$IMAGE_MONITOR:$VERSION" ./nip66-cron

echo "Pushing $IMAGE_APP and $IMAGE_MONITOR"
docker push "$IMAGE_APP:latest"
docker push "$IMAGE_APP:$VERSION"
docker push "$IMAGE_MONITOR:latest"
docker push "$IMAGE_MONITOR:$VERSION"

# --- Git tag (matches package.json version) ---
if git rev-parse "$GIT_TAG" >/dev/null 2>&1; then
  echo "Tag $GIT_TAG already exists locally. Bump version in package.json or delete the tag." >&2
  exit 1
fi

if git ls-remote origin "refs/tags/$GIT_TAG" | grep -q .; then
  echo "Tag $GIT_TAG already exists on origin. Bump version in package.json or delete the remote tag." >&2
  exit 1
fi

echo "Creating annotated tag $GIT_TAG at HEAD"
git tag -a "$GIT_TAG" -m "Release $GIT_TAG"

echo "Pushing tag $GIT_TAG to origin"
git push origin "$GIT_TAG"

echo "Done. On the server: docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d"
