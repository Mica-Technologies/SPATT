#!/usr/bin/env bash
# Runs inside the linux-build container with the repository mounted at /src.
#
# The build happens in a copy under /work, not in /src: node_modules and target/ from a Windows
# checkout hold Windows binaries, and building in place would overwrite them.
set -euo pipefail

mkdir -p /work/spatt
tar -C /src --exclude=./node_modules --exclude=./target --exclude=./dist --exclude=./release-assets \
    --exclude=./.git -cf - . | tar -C /work/spatt -xf -
cd /work/spatt

npm ci
npx tauri build --target x86_64-unknown-linux-gnu --bundles "${SPATT_BUNDLES:-deb,rpm,appimage}"
cargo build --release -p spatt-server --target x86_64-unknown-linux-gnu
node scripts/collect-release-assets.mjs --target x86_64-unknown-linux-gnu \
  --version "$(node -p "require('./package.json').version")"

mkdir -p /src/release-assets
cp release-assets/* /src/release-assets/
ls -l /src/release-assets
