#!/bin/bash
# Updates a Payroll Workspace that runs by hand on a LiteSpeed (Passenger-style) site - see README, "By hand over SSH".
#   bash update-app.sh <site folder> <zip of payroll-web>
#   e.g. bash update-app.sh ~/domains/example.com ~/payroll-app.zip
# The zip is unpacked next to the running app (app.new), the packages are installed and the app is built there. Only when that worked the new folder takes the place
# of app/ (the old one stays as app.prev), the running process is stopped (LiteSpeed starts the new one with the next request) and the new one has to report
# "application is ready" - otherwise the old folder is put back. The data folder (~/payroll-data) is never touched. Everybody is signed out by the restart.
set -uo pipefail
SITE=${1:?usage: update-app.sh <site folder> <zip of payroll-web>}; ZIP=${2:?usage: update-app.sh <site folder> <zip of payroll-web>}
SITE=$(cd "$SITE" 2>/dev/null && pwd) || { echo "no such site folder: $1"; exit 2; }
export PATH="${NODE_BIN:-/opt/alt/alt-nodejs24/root/bin}:$PATH"
export RAYON_NUM_THREADS=2 TOKIO_WORKER_THREADS=2 UV_THREADPOOL_SIZE=2    # the hosting limits the threads of the account; the bundler panics without this
ENV_FILE=${ENV_FILE:-$HOME/payroll-data/app.env}
say(){ echo "[$(date +%T)] $*"; }
fail(){ say "FAILED: $*"; exit 1; }
stop_app(){ pkill -TERM -u "$(id -un)" -f "lsnode:$SITE/app" 2>/dev/null; sleep 3; }
[ -f "$ZIP" ] || fail "no zip at $ZIP"
[ -d "$SITE/app" ] || fail "no app folder in $SITE"
cd "$SITE" || exit 2

say "unpacking $(basename "$ZIP") ($(du -k "$ZIP" | cut -f1) KB)"
rm -rf app.new && mkdir app.new && unzip -q "$ZIP" -d app.new || fail "cannot unpack the zip"
[ -f app.new/package.json ] && [ -f app.new/deploy/hostinger/server.js ] || fail "the zip is not payroll-web (package.json or deploy/hostinger/server.js is missing)"
say "unpacked: $(find app.new -type f | wc -l) files"

cd app.new || exit 2
node -v | sed 's/^/node /'; echo "npm $(npm -v)"
npm ci --no-audit --no-fund >../update-npm.log 2>&1 || { tail -15 ../update-npm.log; fail "npm ci"; }
say "packages installed"
npm run build >../update-build.log 2>&1 || { tail -25 ../update-build.log; fail "the build"; }
[ -d dist/server ] || { tail -15 ../update-build.log; fail "the build made no dist/server"; }
say "built"
mkdir -p tmp; cd "$SITE" || exit 2

# the swap: app -> app.prev, app.new -> app
rm -rf app.prev app.failed
mv app app.prev && mv app.new app || fail "cannot swap the folders"
say "new app in place (old one kept as app.prev); stopping the running process"
stop_app

ORIGIN=$(sed -n 's/^PUBLIC_ORIGIN=//p' "$ENV_FILE" 2>/dev/null | head -1 | tr -d "\"'")
ready=0
for i in $(seq 1 40); do
  [ -n "$ORIGIN" ] && curl -s -m 30 -o /dev/null "$ORIGIN/__ping"          # the first request starts the new process
  if grep -q 'application is ready' app/console.log 2>/dev/null; then ready=1; break; fi
  if grep -q 'START FAILED' app/stderr.log 2>/dev/null; then break; fi
  sleep 3
done
if [ $ready -ne 1 ]; then
  say "the new app did not report ready - putting the old one back"
  tail -12 app/stderr.log 2>/dev/null; tail -8 app/console.log 2>/dev/null
  mv app app.failed && mv app.prev app
  stop_app; [ -n "$ORIGIN" ] && curl -s -m 30 -o /dev/null "$ORIGIN/__ping"
  fail "update undone (the failed copy is in app.failed)"
fi
say "the new app is running:"; tail -4 app/console.log
[ -n "$ORIGIN" ] && echo "ping: $(curl -s -m 30 "$ORIGIN/__ping")"
say "done. The previous version is in app.prev (delete it when the new one has proved itself)."
