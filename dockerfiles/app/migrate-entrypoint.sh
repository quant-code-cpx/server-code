#!/bin/sh
# Apply schema migrations and re-encrypt legacy model-provider secrets before
# any new application container can start. The re-encryption script is a safe
# no-op on installations without encrypted model credentials.

set -eu

node node_modules/prisma/build/index.js migrate deploy
exec node -r ts-node/register -r tsconfig-paths/register scripts/migrate-agent-model-encryption-key.ts
