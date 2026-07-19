#!/bin/sh
set -e
# Apply pending migrations against the mounted SQLite volume, then start Next.
node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
exec node server.js
