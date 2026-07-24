#!/bin/sh

set -eu
umask 077

validate_name() {
  case "$2" in
    '' | *[!A-Za-z0-9_-]* | [!A-Za-z]* )
      echo "invalid Redis ACL username in $1" >&2
      exit 1
      ;;
    * ) ;;
  esac
}

validate_password() {
  if [ "${#2}" -lt 32 ]; then
    echo "invalid Redis ACL password in $1; use at least 32 URL-safe characters" >&2
    exit 1
  fi
  case "$2" in
    *[!A-Za-z0-9_-]* )
      echo "invalid Redis ACL password in $1; use at least 32 URL-safe characters" >&2
      exit 1
      ;;
  esac
}

require_credential() {
  name_var="$1"
  password_var="$2"
  eval "name=\${$name_var:-}"
  eval "password=\${$password_var:-}"
  if [ -z "$name" ] || [ -z "$password" ]; then
    echo "missing Redis ACL credential: $name_var/$password_var" >&2
    exit 1
  fi
  validate_name "$name_var" "$name"
  validate_password "$password_var" "$password"
}

require_credential REDIS_API_USERNAME REDIS_API_PASSWORD
require_credential REDIS_WORKER_USERNAME REDIS_WORKER_PASSWORD
require_credential REDIS_SOCKET_USERNAME REDIS_SOCKET_PASSWORD
require_credential REDIS_OPS_USERNAME REDIS_OPS_PASSWORD

api_name=$REDIS_API_USERNAME
api_password=$REDIS_API_PASSWORD
worker_name=$REDIS_WORKER_USERNAME
worker_password=$REDIS_WORKER_PASSWORD
socket_name=$REDIS_SOCKET_USERNAME
socket_password=$REDIS_SOCKET_PASSWORD
ops_name=$REDIS_OPS_USERNAME
ops_password=$REDIS_OPS_PASSWORD

acl_file=/usr/local/etc/redis/users.acl
{
  printf '%s\n' 'user default off'
  # BullMQ uses Redis Pub/Sub; ioredis also issues INFO during its ready check.
  # -@dangerous removes INFO, so grant it back explicitly without restoring destructive commands.
  printf 'user %s on >%s ~* &* +@all -@dangerous +INFO -CONFIG -SHUTDOWN -FLUSHALL -FLUSHDB -KEYS\n' "$api_name" "$api_password"
  printf 'user %s on >%s ~* &* +@all -@dangerous +INFO -CONFIG -SHUTDOWN -FLUSHALL -FLUSHDB -KEYS\n' "$worker_name" "$worker_password"
  printf 'user %s on >%s ~* &* +@read +@write +@pubsub +PING +INFO +CLIENT|ID +CLIENT|SETNAME -@dangerous\n' "$socket_name" "$socket_password"
  printf 'user %s on >%s ~* +PING +INFO +SLOWLOG|GET +ACL|WHOAMI\n' "$ops_name" "$ops_password"
} > "$acl_file"

exec "$@"
