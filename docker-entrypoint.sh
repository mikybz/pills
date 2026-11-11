#!/bin/sh
set -e
# Snapshot the SQLite DB before migrating (keeps the 5 most recent copies in the volume).
DB_FILE="${DATABASE_URL#file:}"
if [ -f "$DB_FILE" ]; then
  BACKUP_DIR="$(dirname "$DB_FILE")/backups"
  mkdir -p "$BACKUP_DIR"
  cp "$DB_FILE" "$BACKUP_DIR/pills-$(date +%Y%m%d-%H%M%S).db"
  ls -1t "$BACKUP_DIR"/pills-*.db 2>/dev/null | tail -n +6 | xargs -r rm -f
fi
# Apply pending migrations against the mounted SQLite volume, then start Next.
node /opt/prisma/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
exec node server.js
