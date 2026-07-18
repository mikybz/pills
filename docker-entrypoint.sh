#!/bin/sh
set -e
# Apply pending migrations against the mounted SQLite volume, then start Next.
node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
exec node server.js
