#!/usr/bin/env bash
# Build main app and NIP-66 monitor images locally; push to silberengel/imwald-jumble and silberengel/imwald-jumble-nip66-monitor as :latest and :<version from package.json>.
# Run from repo root. Requires: docker, docker login. On the server you then pull and run docker-compose.prod.yml.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
IMAGE_APP="silberengel/imwald-jumble"
IMAGE_MONITOR="silberengel/imwald-jumble-nip66-monitor"

echo "Building main app (version: $VERSION)"
docker build -t "$IMAGE_APP:latest" -t "$IMAGE_APP:$VERSION" .

echo "Building NIP-66 monitor (version: $VERSION)"
docker build -t "$IMAGE_MONITOR:latest" -t "$IMAGE_MONITOR:$VERSION" ./nip66-cron

echo "Pushing $IMAGE_APP and $IMAGE_MONITOR"
docker push "$IMAGE_APP:latest"
docker push "$IMAGE_APP:$VERSION"
docker push "$IMAGE_MONITOR:latest"
docker push "$IMAGE_MONITOR:$VERSION"

echo "Done. On the server: docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d"
