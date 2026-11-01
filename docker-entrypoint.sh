#!/bin/sh
# ============= JUKEBOX - DOCKER ENTRYPOINT =============
# Version 1.3.0 - last updated: 29 October 2026
# Changelog:
#   1.3.0 - Startup line also shows the optional YouTube Music source
#           (YOUTUBE_ENABLED, off unless set to true).
#   1.2.0 - Each source is enabled as soon as its credentials are given:
#           NAVIDROME_USER + NAVIDROME_PASS, SOULSEEK_USER + SOULSEEK_PASS
#           (or a mounted sockseek.conf).
#   1.1.0 - Automatic sources: when NAVIDROME_ENABLED / SOULSEEK_ENABLED are
#           not set, each source is enabled only if it is configured
#           (NAVIDROME_URL given, Soulseek account available).
#   1.0.0 - Writes sockseek.conf from SOULSEEK_USER / SOULSEEK_PASS.
#
# Then starts the command given by CMD (the jukebox server).

set -e

CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/sockseek"
CONF_FILE="$CONF_DIR/sockseek.conf"

# ----- Soulseek account -----
# Given as environment variables, written to the bundled sockseek config.
# When not set, an existing sockseek.conf (for example a mounted one) is kept.
if [ -n "$SOULSEEK_USER" ] && [ -n "$SOULSEEK_PASS" ]; then
    mkdir -p "$CONF_DIR"
    printf 'username = %s\npassword = %s\n' "$SOULSEEK_USER" "$SOULSEEK_PASS" > "$CONF_FILE"
    chmod 600 "$CONF_FILE"
fi

# ----- Automatic sources -----
# A source is enabled as soon as its credentials are given.
# An explicit "true" / "false" always wins.
if [ -z "$NAVIDROME_ENABLED" ]; then
    if [ -n "$NAVIDROME_USER" ] && [ -n "$NAVIDROME_PASS" ]; then
        NAVIDROME_ENABLED=true
    else
        NAVIDROME_ENABLED=false
    fi
fi
if [ -z "$SOULSEEK_ENABLED" ]; then
    if [ -f "$CONF_FILE" ]; then SOULSEEK_ENABLED=true; else SOULSEEK_ENABLED=false; fi
fi
export NAVIDROME_ENABLED SOULSEEK_ENABLED

# YouTube Music stays optional: enabled only by YOUTUBE_ENABLED=true
echo "Sources: Navidrome=$NAVIDROME_ENABLED, Soulseek=$SOULSEEK_ENABLED, YouTube Music=${YOUTUBE_ENABLED:-false}"

exec "$@"
