# Proxy Server Setup for Production

## Problem
The proxy server isn't working because `VITE_PROXY_SERVER` is being set to `http://localhost:8090` during the Docker build, which won't work from the browser on a remote server.

## Solution

When building and deploying on the remote server, you need to build the Docker image with the correct build argument.

### For Manual Docker Run Commands

**IMPORTANT:** `VITE_PROXY_SERVER` must be set during Docker BUILD (as a build argument), NOT at runtime. It gets baked into the JavaScript bundle.

Rebuild the Jumble image with the correct proxy URL:

```bash
# Build with the correct proxy URL (baked into the JS bundle)
# 
# IMPORTANT: Since users access via HTTPS (https://jumble.imwald.eu), 
# the proxy URL MUST also use HTTPS or browsers will block it (mixed content).
#
# You have two options:
#
# Option 1: Configure HTTPS for port 8090 (requires SSL certificate)
# docker build --build-arg VITE_PROXY_SERVER=https://jumble.imwald.eu:8090 ...
#
# Option 2: Route proxy through your reverse proxy (recommended if you have nginx/Apache)
# Configure reverse proxy to route /proxy/* to http://localhost:8090/
# The code constructs: ${proxyServer}/sites/${encodeURIComponent(url)}
# So /proxy/sites/... is forwarded to http://localhost:8090/sites/...
# Then use: https://jumble.imwald.eu/proxy
#
# Using Option 2 (recommended - route through Apache reverse proxy):
docker build \
  --build-arg VITE_PROXY_SERVER=https://jumble.imwald.eu/proxy \
  -t silberengel/imwald-jumble:12 \
  .

# Then push to Docker Hub
docker push silberengel/imwald-jumble:12

# Then on the remote server, pull and restart:
docker stop imwald-jumble
docker rm imwald-jumble
docker pull silberengel/imwald-jumble:12

# Run with the same command (NO env vars needed for proxy - it's already in the bundle)
docker run -d \
  --name imwald-jumble \
  --network jumble-network \
  -p 0.0.0.0:32768:80 \
  --restart unless-stopped \
  silberengel/imwald-jumble:12
```

**Note on Docker Network:**

You only need to create the network once (it persists). Check if it exists first:

```bash
# Check if network exists
docker network ls | grep jumble-network

# If it doesn't exist, create it (only needed once)
docker network create jumble-network
```

### For Docker Compose

### 1. Set Environment Variables Before Building

```bash
# Use the reverse proxy route if you've configured Apache/nginx
export JUMBLE_PROXY_SERVER_URL="https://jumble.imwald.eu/proxy"
export JUMBLE_SOCIAL_URL="https://jumble.imwald.eu"
```

### 2. Rebuild the Docker Image

```bash
docker-compose build --no-cache
```

### 3. Restart the Containers

```bash
docker-compose down
docker-compose up -d
```

## How to Check if it's Working

1. After deploying, open the browser console on `https://jumble.imwald.eu`
2. Navigate to a page with a URL that should show OpenGraph data
3. Look for `[WebService]` log messages that will show:
   - Whether the proxy server is configured
   - What URL is being used to fetch metadata
   - Any errors (CORS, network, etc.)

## Read-aloud / Piper TTS (same-origin `/api/piper-tts`)

The client uses **`POST /api/piper-tts`** on the **same host** as the app (default build: `VITE_READ_ALOUD_TTS_URL=/api/piper-tts`) so the browser does not need cross-origin CORS to aitherboard.

Add these **before** the catch-all `ProxyPass /` to the Jumble static container (same ordering as `/sites/`):

```apache
ProxyPass        /api/piper-tts http://127.0.0.1:9876/api/piper-tts
ProxyPassReverse /api/piper-tts http://127.0.0.1:9876/api/piper-tts
```

Use the port where **aitherboard** listens (example: `9876`). Reload Apache, then test:

```bash
curl -sS -o /tmp/t.wav -w "%{http_code}\n" -H "Content-Type: application/json" \
  -d '{"text":"test","speed":1}' "https://jumble.imwald.eu/api/piper-tts"
```

Expect **200** and a WAV file. **Local dev:** `npm run dev` proxies `/api/piper-tts` → `http://127.0.0.1:9876` in `vite.config.ts`.

Rebuild the Jumble image after changing `VITE_READ_ALOUD_TTS_URL`; `Dockerfile` passes `ARG`/`ENV` `VITE_READ_ALOUD_TTS_URL` into `npm run build`.

## Update Proxy Server's ALLOW_ORIGIN

Since users access via `https://jumble.imwald.eu`, you need to update the proxy server's `ALLOW_ORIGIN`:

```bash
# Stop the proxy container
docker stop imwald-jumble-proxy
docker rm imwald-jumble-proxy

# Restart with correct ALLOW_ORIGIN (must match how users access the frontend)
docker run -d \
  --name imwald-jumble-proxy \
  --network jumble-network \
  -p 0.0.0.0:8090:8080 \
  -e ALLOW_ORIGIN=https://jumble.imwald.eu \
  -e ENABLE_PPROF=true \
  --restart unless-stopped \
  ghcr.io/danvergara/jumble-proxy-server:latest
```

## HTTPS Certificate Setup for Port 8090

Since users access via `https://jumble.imwald.eu`, you need HTTPS for the proxy to avoid mixed content errors.

**Option A: SSL Certificate for Port 8090**

If you want to access the proxy directly on port 8090 with HTTPS, you'll need an SSL certificate:

```bash
# Using Let's Encrypt with certbot
certbot certonly --standalone -d jumble.imwald.eu --expand

# Then configure your reverse proxy or the proxy server itself to use the certificate
# The exact steps depend on your setup (nginx, Apache, or direct in the proxy container)
```

**Option B: Route Through Reverse Proxy (Recommended)**

If you already have a reverse proxy (nginx/Apache) handling HTTPS for `jumble.imwald.eu`, route the proxy through it:

### Apache Reverse Proxy Setup

1. **Enable required Apache modules:**
```bash
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod rewrite
sudo a2enmod headers
sudo systemctl restart apache2
```

2. **Add reverse proxy configuration to your Apache virtual host** (typically in `/etc/apache2/sites-available/jumble.imwald.eu-le-ssl.conf` or similar):

```apache
<IfModule mod_ssl.c>
<VirtualHost 217.154.126.125:443>
    ServerName jumble.imwald.eu
    ServerAlias www.jumble.imwald.eu
    
    # Reverse Proxy Configuration
    
    # Proxy for the jumble-proxy-server (must come BEFORE the catch-all / rule)
    # The code constructs: ${proxyServer}/sites/${encodeURIComponent(url)}
    # So /proxy/sites/... needs to be forwarded to http://127.0.0.1:8090/sites/...
    # IMPORTANT: Use Location block to scope headers properly for /proxy/ path only
    <Location /proxy/>
        ProxyPreserveHost Off
        ProxyPass http://127.0.0.1:8090/
        ProxyPassReverse http://127.0.0.1:8090/
        # Unset forwarded headers that might make the proxy server use Host header instead of URL path
        RequestHeader unset X-Forwarded-Host
        RequestHeader unset X-Forwarded-Server
        RequestHeader set Host "127.0.0.1:8090"
    </Location>
    
    # Reverse Proxy for the main Jumble app (needs Host header preserved)
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:32768/
    ProxyPassReverse / http://127.0.0.1:32768/
    
    # Headers for proper proxying
    Header always set X-Forwarded-Proto https
    Header always set X-Forwarded-Port 443

Include /etc/letsencrypt/options-ssl-apache.conf
SSLCertificateFile /etc/letsencrypt/live/jumble.imwald.eu/fullchain.pem
SSLCertificateKeyFile /etc/letsencrypt/live/jumble.imwald.eu/privkey.pem
</VirtualHost>
</IfModule>
```

**Important:** The code constructs URLs like `https://jumble.imwald.eu/proxy/sites/https%3A%2F%2Fexample.com`. Apache receives `/proxy/sites/https%3A%2F%2Fexample.com` and forwards it to `http://127.0.0.1:8090/sites/https%3A%2F%2Fexample.com` (strips `/proxy` prefix).

3. **Enable the site (if not already enabled):**
```bash
sudo a2ensite jumble.imwald.eu-le-ssl.conf
```

4. **Reload Apache:**
```bash
sudo apache2ctl configtest  # Check for errors first
sudo systemctl reload apache2
```

5. **Test the proxy route:**
```bash
# Test with a real URL - the code constructs /proxy/sites/{encoded-url}
curl https://jumble.imwald.eu/proxy/sites/https%3A%2F%2Fexample.com
# Should return example.com's HTML, NOT jumble.imwald.eu's HTML
# If you see Jumble HTML, the proxy server is using the Host header instead of the URL path
```

**If the test returns Jumble HTML instead of the requested site's HTML:**

The proxy server is using the `Host` header (`jumble.imwald.eu`) to determine what to fetch. Update your Apache config to use `ProxyPreserveHost Off` for the `/proxy/` path:

```apache
# In your Apache config, change from:
ProxyPreserveHost On
ProxyPass /proxy/ http://127.0.0.1:8090/

# To:
ProxyPreserveHost Off
ProxyPass /proxy/ http://127.0.0.1:8090/
ProxyPassReverse /proxy/ http://127.0.0.1:8090/

# Then set it back to On for the main app:
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:32768/
```

Then reload Apache and test again.

6. **Build with the proxy URL:**
```bash
docker build \
  --build-arg VITE_PROXY_SERVER=https://jumble.imwald.eu/proxy \
  -t silberengel/imwald-jumble:12 \
  .
```

**Note:** The proxy URL in `VITE_PROXY_SERVER` should be `https://jumble.imwald.eu/proxy` (without trailing slash), and the code will append `/sites/...` automatically.

## Important Notes

- The `VITE_PROXY_SERVER` value is baked into the JavaScript bundle during build time
- You MUST rebuild the Docker image if you change `VITE_PROXY_SERVER`
- The proxy server's `ALLOW_ORIGIN` must match the frontend URL users access (`https://jumble.imwald.eu`)
- Mixed content: HTTPS pages cannot load HTTP resources - both must use HTTPS
- If using direct port access (8090), you need an SSL certificate for that port

## Troubleshooting

### If Proxy Returns Jumble HTML Instead of Requested Site

If you've set `ProxyPreserveHost Off` but still get Jumble HTML, test the proxy server directly:

**1. Test the proxy server directly (bypassing Apache):**
```bash
# Test direct connection to proxy on port 8090
curl http://127.0.0.1:8090/sites/https%3A%2F%2Fexample.com
# Should return example.com's HTML, NOT jumble.imwald.eu's HTML
```

**2. Check proxy server logs:**
```bash
docker logs imwald-jumble-proxy --tail 50
# Look for what URL the proxy is trying to fetch
# This will show if the proxy server is receiving the correct path or if it's using Host header
```

**2b. Check what request the proxy server is actually receiving:**
```bash
# Enable verbose logging in Apache to see what it's forwarding
# Or check what the proxy receives by making a test request and watching logs:
docker logs -f imwald-jumble-proxy &
# Then in another terminal:
curl -v https://jumble.imwald.eu/proxy/sites/https%3A%2F%2Fexample.com
# Look at the proxy logs to see what URL it tried to fetch
```

**3. Check if Apache is receiving `/proxy/` requests:**
```bash
# Watch Apache access log to see if /proxy/ requests reach Apache
sudo tail -f /var/log/apache2/access.log | grep proxy
# Then in another terminal, make a request:
curl https://jumble.imwald.eu/proxy/sites/https%3A%2F%2Fexample.com
# Check if the request appears in Apache logs
```

**3b. Check what Apache is forwarding:**
```bash
# Check Apache error log for proxy-related entries
sudo tail -f /var/log/apache2/error.log
# Then make a request and see what Apache is doing
```

**3c. Verify Apache config is being used:**
```bash
# Check that your Location block syntax is correct:
sudo apache2ctl -S | grep jumble.imwald.eu
# Make sure the site is enabled and config syntax is correct:
sudo apache2ctl configtest
```

**4. Possible Issues:**

**IMPORTANT: If you see `Server: nginx` in response headers, nginx is in front of Apache!**

If you see `Server: nginx/1.29.3` or `X-Powered-By: PleskLin` in the response headers, nginx reverse proxy is handling requests before Apache. You need to configure nginx directly (bypassing Plesk interface) to pass `/proxy/` to Apache, or route it directly to the proxy server.

**If nginx is in front of Apache (bypassing Plesk interface):**

Since nginx is handling requests before Apache, configure nginx directly by editing nginx config files.

**Option A: Configure nginx to pass `/proxy/` through to Apache:**

1. Find nginx config for your domain:
```bash
# Plesk usually stores configs here:
/etc/nginx/conf.d/vhost.conf
# or
/etc/nginx/conf.d/jumble.imwald.eu.conf
# or check Plesk's nginx vhosts:
/etc/nginx/plesk.conf.d/vhosts/jumble.imwald.eu.conf
```

2. Edit the nginx config file for `jumble.imwald.eu`

3. Add this location block BEFORE any catch-all location:
```nginx
location /proxy/ {
    # Forward to Apache (check what port Apache is listening on)
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

**Note:** Replace `8080` with the port Apache is actually listening on. Check with:
```bash
sudo netstat -tlnp | grep apache
# or
sudo ss -tlnp | grep apache
```

4. Test nginx config: `sudo nginx -t`
5. Reload nginx: `sudo systemctl reload nginx`

**Then Apache will handle it with your existing Apache config.**

**Option B: Configure nginx to route `/proxy/` directly to the proxy server (simpler):**

1. Edit nginx config for `jumble.imwald.eu` (same location as above)
2. Add this location block BEFORE any catch-all location:
```nginx
location /proxy/ {
    proxy_pass http://127.0.0.1:8090/;
    proxy_set_header Host 127.0.0.1:8090;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # Don't send X-Forwarded-Host which might confuse the proxy
    proxy_set_header X-Forwarded-Host "";
}
```

3. Test nginx config: `sudo nginx -t`
4. Reload nginx: `sudo systemctl reload nginx`

This bypasses Apache entirely for `/proxy/` requests and goes directly to the proxy server.

**Other possible issues:**
- The proxy server might be using the `X-Forwarded-Host` header instead of the URL path
- The proxy server might need a specific Host header value
- The proxy server might not be correctly parsing `/sites/...` path

**5. Unset forwarded headers that might confuse the proxy server:**
```apache
# The proxy server might be using X-Forwarded-Host instead of the URL path
# Unset or modify these headers for the /proxy/ path:
ProxyPass /proxy/ http://127.0.0.1:8090/
ProxyPassReverse /proxy/ http://127.0.0.1:8090/
ProxyPreserveHost Off
# Unset forwarded headers that might interfere
RequestHeader unset X-Forwarded-Host
RequestHeader unset X-Forwarded-Server
RequestHeader set Host "127.0.0.1:8090"
```

### Other Console Errors

If you see errors in the console:
- `[WebService] No proxy server configured` - `VITE_PROXY_SERVER` is undefined or empty
- `[WebService] CORS/Network error` - The proxy URL might be wrong, or CORS isn't configured
- `[WebService] Failed to fetch metadata` - The proxy server might not be running or accessible

