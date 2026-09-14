# A throwaway Ubuntu 22.04 machine with systemd as PID 1, for testing SPATT's background modes on
# Linux (`node scripts/test-linux-background.mjs`). The SPATT .deb is installed at test time.
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        systemd systemd-sysv dbus dbus-x11 curl ca-certificates xvfb xauth sudo \
        libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-common \
    && rm -rf /var/lib/apt/lists/* \
    # No getty or other consoles in a container.
    && systemctl mask getty@tty1.service console-getty.service systemd-logind.service \
    && useradd --create-home --shell /bin/bash tester

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
