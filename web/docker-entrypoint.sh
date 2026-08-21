#!/bin/sh
set -e

PRISMA="node /app/node_modules/prisma/build/index.js"

echo "[family-hub] Waiting for database..."
RETRIES=30
# Probe the DB by attempting a harmless prisma command. We only care that the
# connection succeeds -- swallow stdout but keep stderr visible on the final
# attempt so real errors aren't hidden by the retry loop.
until $PRISMA db push --skip-generate >/dev/null 2>&1; do
  RETRIES=$((RETRIES-1))
  if [ $RETRIES -le 0 ]; then
    echo "[family-hub] Database never became ready. Final attempt output:"
    $PRISMA db push --skip-generate || true
    exit 1
  fi
  echo "[family-hub] Database not ready yet, retrying... ($RETRIES)"
  sleep 2
done

echo "[family-hub] Schema applied successfully."

echo "[family-hub] Seeding bootstrap parent if needed..."
node /app/prisma/seed.cjs || echo "[family-hub] Seed skipped (users already exist or seed failed non-fatally)"

echo "[family-hub] Starting Next.js..."
exec "$@"
