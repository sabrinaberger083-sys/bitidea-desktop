#!/bin/bash
# Docker/Podman entrypoint: bootstrap config files into the mounted volume, then run bitidea.
set -e

BITIDEA_HOME="${BITIDEA_HOME:-/opt/data}"
INSTALL_DIR="/opt/bitidea"

# --- Privilege dropping via gosu ---
# When started as root (the default for Docker, or fakeroot in rootless Podman),
# optionally remap the bitidea user/group to match host-side ownership, fix volume
# permissions, then re-exec as bitidea.
if [ "$(id -u)" = "0" ]; then
    if [ -n "$BITIDEA_UID" ] && [ "$BITIDEA_UID" != "$(id -u bitidea)" ]; then
        echo "Changing bitidea UID to $BITIDEA_UID"
        usermod -u "$BITIDEA_UID" bitidea
    fi

    if [ -n "$BITIDEA_GID" ] && [ "$BITIDEA_GID" != "$(id -g bitidea)" ]; then
        echo "Changing bitidea GID to $BITIDEA_GID"
        # -o allows non-unique GID (e.g. macOS GID 20 "staff" may already exist
        # as "dialout" in the Debian-based container image)
        groupmod -o -g "$BITIDEA_GID" hermes 2>/dev/null || true
    fi

    actual_bitidea_uid=$(id -u bitidea)
    if [ "$(stat -c %u "$BITIDEA_HOME" 2>/dev/null)" != "$actual_bitidea_uid" ]; then
        echo "$BITIDEA_HOME is not owned by $actual_bitidea_uid, fixing"
        # In rootless Podman the container's "root" is mapped to an unprivileged
        # host UID — chown will fail.  That's fine: the volume is already owned
        # by the mapped user on the host side.
        chown -R bitidea:bitidea "$BITIDEA_HOME" 2>/dev/null || \
            echo "Warning: chown failed (rootless container?) — continuing anyway"
    fi

    echo "Dropping root privileges"
    exec gosu bitidea "$0" "$@"
fi

# --- Running as bitidea from here ---
source "${INSTALL_DIR}/.venv/bin/activate"

# Create essential directory structure.  Cache and platform directories
# (cache/images, cache/audio, platforms/whatsapp, etc.) are created on
# demand by the application — don't pre-create them here so new installs
# get the consolidated layout from get_bitidea_dir().
# The "home/" subdirectory is a per-profile HOME for subprocesses (git,
# ssh, gh, npm …).  Without it those tools write to /root which is
# ephemeral and shared across profiles.  See issue #4426.
mkdir -p "$BITIDEA_HOME"/{cron,sessions,logs,hooks,memories,skills,skins,plans,workspace,home}

# .env
if [ ! -f "$BITIDEA_HOME/.env" ]; then
    cp "$INSTALL_DIR/.env.example" "$BITIDEA_HOME/.env"
fi

# config.yaml
if [ ! -f "$BITIDEA_HOME/config.yaml" ]; then
    cp "$INSTALL_DIR/cli-config.yaml.example" "$BITIDEA_HOME/config.yaml"
fi

# SOUL.md
if [ ! -f "$BITIDEA_HOME/SOUL.md" ]; then
    cp "$INSTALL_DIR/docker/SOUL.md" "$BITIDEA_HOME/SOUL.md"
fi

# Sync bundled skills (manifest-based so user edits are preserved)
if [ -d "$INSTALL_DIR/skills" ]; then
    python3 "$INSTALL_DIR/tools/skills_sync.py"
fi

exec bitidea "$@"
