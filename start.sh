#!/bin/sh
set -e

# Print credentials to deploy log (first time or env-var override)
echo ""
echo "============================================"
echo "  Open Design — Auth Service"
echo "  Username: ${OD_AUTH_USERNAME:-admin}"
echo "  Password: ${OD_AUTH_PASSWORD:-auto-generated}"
echo "  (Set OD_AUTH_USERNAME / OD_AUTH_PASSWORD env vars to control)"
echo "============================================"
echo ""

# ── Start auth service (background) ──
node /auth-server.js &
AUTH_PID=$!
echo "Auth service started (PID $AUTH_PID)"

# ── Start nginx (background) ──
nginx -g "daemon off;" &
NGINX_PID=$!
echo "Nginx started (PID $NGINX_PID)"

# Give services a moment to initialize
sleep 2

# ── Start Open Design daemon on internal port 7457 ──
export OD_PORT=7457
echo "Starting Open Design daemon on port 7457..."
exec node apps/daemon/dist/cli.js --no-open
