#!/bin/sh
# Runtime config for the SPA. NIP-66 monitor runs in a separate cron container; nsec is never sent to the client.
# Optional: NIP66_MONITOR_NPUB (npub of the monitor) can be exposed so the relay info page shows who runs the monitor.
if [ -n "$NIP66_MONITOR_NPUB" ]; then
  jq -n --arg npub "$NIP66_MONITOR_NPUB" '{NIP66_MONITOR_NPUB: $npub}' > /usr/share/nginx/html/config.json
else
  echo '{}' > /usr/share/nginx/html/config.json
fi
exec nginx -g "daemon off;"
