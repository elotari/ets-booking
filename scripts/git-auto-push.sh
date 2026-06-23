#!/bin/sh
# Simple auto-commit + push script (POSIX)
set -e
if [ -z "$(git status --porcelain)" ]; then
  echo "No changes to commit."
  exit 0
fi
git add -A
msg="Auto update $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
git commit -m "$msg" || true
git push origin HEAD
