#!/bin/bash

set -e

mkdir -p /run/dbus
dbus-daemon --system --fork
avahi-daemon --daemonize

exec "$@"
