# Linux build environment for SPATT: the same distribution and packages the release workflow
# uses on ubuntu-22.04, so a local `npm run build:linux` reproduces a CI Linux build.
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=24

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl wget file git pkg-config \
        libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
        xdg-utils \
    && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
# The AppImage bundler runs linuxdeploy, itself an AppImage; containers have no FUSE to mount it.
ENV APPIMAGE_EXTRACT_AND_RUN=1
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable

WORKDIR /work
COPY build.sh /usr/local/bin/spatt-linux-build
RUN chmod +x /usr/local/bin/spatt-linux-build
ENTRYPOINT ["bash", "/usr/local/bin/spatt-linux-build"]
