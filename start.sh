#!/bin/sh
set -e

PASSWORD="${OD_BASIC_AUTH_PASSWORD:-$(openssl rand -base64 12)}"
USERNAME="${OD_BASIC_AUTH_USERNAME:-admin}"

htpasswd -b -c /etc/nginx/.htpasswd "${USERNAME}" "${PASSWORD}"

echo ""
echo "==================== BASIC AUTH ===================="
echo "  URL:      https://open-design-deploy-v2.zeabur.app"
echo "  Username: ${USERNAME}"
echo "  Password: ${PASSWORD}"
echo "  (Change via OD_BASIC_AUTH_USERNAME / OD_BASIC_AUTH_PASSWORD env vars)"
echo "===================================================="
echo ""

export OD_PORT=7457

nginx -g "daemon off;" &

exec node apps/daemon/dist/cli.js --no-open
