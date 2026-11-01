# ============= JUKEBOX - DOCKER IMAGE =============
# Version 2.1.0 - last updated: 29 October 2026
# Changelog:
#   2.1.0 - yt-dlp built in for the optional YouTube Music source
#           (YOUTUBE_ENABLED=true). Base image moved to Node.js 22: yt-dlp
#           needs Node.js 20+ as JavaScript runtime for YouTube.
#   2.0.0 - sockseek (Soulseek fallback) is now built into the image.
#           Base image moved from Alpine to Debian slim: sockseek is a glibc
#           binary and needs libicu. Soulseek credentials come from
#           SOULSEEK_USER / SOULSEEK_PASS (see docker-entrypoint.sh).
#   1.0.0 - Node.js server only, Navidrome as the single built-in source.
#
# Build: docker build -t tontonjo/jukebox:latest .
# Multi-arch: docker buildx build --platform linux/amd64,linux/arm/v7 -t tontonjo/jukebox:latest --push .
# Run:   docker run -d -p 3000:3000 --env-file .env tontonjo/jukebox:latest

FROM node:22-bookworm-slim

# sockseek release to bundle (https://github.com/fiso64/sockseek/releases)
ARG SOCKSEEK_VERSION=3.0.6
# yt-dlp release to bundle (https://github.com/yt-dlp/yt-dlp/releases).
# YouTube changes often: rebuild the image to get a recent yt-dlp.
ARG YTDLP_VERSION=latest
# Set by buildx; defaults to amd64 for a plain "docker build"
ARG TARGETARCH=amd64

# System packages: curl (health check, download), libicu (needed by sockseek)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tzdata libicu72 \
    && rm -rf /var/lib/apt/lists/*

# sockseek only publishes linux-x64 and linux-arm (32-bit) builds. On other
# architectures the image still builds, with Navidrome as the only source.
RUN case "$TARGETARCH" in \
        amd64) SK_ARCH=linux-x64 ;; \
        arm)   SK_ARCH=linux-arm ;; \
        *)     SK_ARCH="" ;; \
    esac \
    && if [ -n "$SK_ARCH" ]; then \
        curl -fsSL "https://github.com/fiso64/sockseek/releases/download/v${SOCKSEEK_VERSION}/sockseek_${SOCKSEEK_VERSION}_${SK_ARCH}.tar.gz" \
          | tar -xz -C /usr/local/bin sockseek \
        && chmod +x /usr/local/bin/sockseek \
        && sockseek --version; \
    else \
        echo "sockseek: no build for $TARGETARCH, Soulseek fallback not included"; \
    fi

# yt-dlp standalone build (Python and its YouTube helpers included).
# Used only when YOUTUBE_ENABLED=true.
RUN case "$TARGETARCH" in \
        amd64) YT_FILE=yt-dlp_linux ;; \
        arm64) YT_FILE=yt-dlp_linux_aarch64 ;; \
        arm)   YT_FILE=yt-dlp_linux_armv7l ;; \
        *)     YT_FILE="" ;; \
    esac \
    && if [ -n "$YT_FILE" ]; then \
        if [ "$YTDLP_VERSION" = "latest" ]; then YT_PATH=latest/download; else YT_PATH="download/$YTDLP_VERSION"; fi \
        && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/$YT_PATH/$YT_FILE" -o /usr/local/bin/yt-dlp \
        && chmod +x /usr/local/bin/yt-dlp \
        && yt-dlp --version; \
    else \
        echo "yt-dlp: no build for $TARGETARCH, YouTube Music source not included"; \
    fi

WORKDIR /app

# Dependencies first: this layer is reused while package.json is unchanged
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application code. qrcode.js is required by the server (guest page QR code).
COPY jukebox-server.js qrcode.js ./
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip Windows line endings in case the repo was checked out on Windows
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/data

# Container defaults: the bundled sockseek daemon is started by the server,
# and persistent files (background music settings, Soulseek cache) go to
# /app/data, meant to be mounted as a volume.
ENV NODE_ENV=production \
    PORT=3000 \
    SOCKSEEK_PATH=sockseek \
    SOCKSEEK_REMOTE=http://127.0.0.1:5030 \
    SOCKSEEK_AUTOSTART=true \
    YTDLP_PATH=yt-dlp \
    FALLBACK_STORE=/app/data/fallback.json \
    SOULSEEK_CACHE_DIR=/app/data/cache

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/api/config || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "jukebox-server.js"]
