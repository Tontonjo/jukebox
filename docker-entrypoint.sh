#!/bin/sh
# ============= JUKEBOX - DOCKER ENTRYPOINT =============
# Version 1.0.0 - last updated: 22 October 2026
#
# Writes the sockseek config file from SOULSEEK_USER / SOULSEEK_PASS, so the
# Soulseek account can be given as plain environment variables. When they are
# not set, an existing sockseek.conf (for example a mounted one) is left as is.
# Then starts the command given by CMD (the jukebox server).

set -e

CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/sockseek"
CONF_FILE="$CONF_DIR/sockseek.conf"

if [ -n "$SOULSEEK_USER" ] && [ -n "$SOULSEEK_PASS" ]; then
    mkdir -p "$CONF_DIR"
    printf 'username = %s\npassword = %s\n' "$SOULSEEK_USER" "$SOULSEEK_PASS" > "$CONF_FILE"
    chmod 600 "$CONF_FILE"
    echo "sockseek: Soulseek account '$SOULSEEK_USER' configured"
elif [ "$SOULSEEK_ENABLED" != "false" ] && [ ! -f "$CONF_FILE" ]; then
    echo "sockseek: no Soulseek account (set SOULSEEK_USER and SOULSEEK_PASS, or SOULSEEK_ENABLED=false)"
fi

exec "$@"
