#!/bin/sh
# Fly's private network is IPv6, so Redis listens on IPv6 as well as IPv4. The
# app has no public service, and a password is still required: any app in the
# org shares the private network. The password goes into a config file, never
# onto the command line (where any process listing would show it).
set -eu
: "${REDIS_PASSWORD:?REDIS_PASSWORD must be set as a Fly secret}"
umask 077
cat > /tmp/redis.conf <<CONF
bind * -::*
port 6379
requirepass $REDIS_PASSWORD
save ""
appendonly no
maxmemory 200mb
maxmemory-policy noeviction
CONF
exec redis-server /tmp/redis.conf
