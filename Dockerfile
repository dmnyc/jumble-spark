# Step 1: Build the application
FROM node:20-alpine AS builder

ARG VITE_PROXY_SERVER
ENV VITE_PROXY_SERVER=${VITE_PROXY_SERVER}

ARG VITE_READ_ALOUD_TTS_URL
ENV VITE_READ_ALOUD_TTS_URL=${VITE_READ_ALOUD_TTS_URL}

WORKDIR /app

# Copy package files first
COPY package*.json ./
RUN npm install

# Copy the source code to prevent invaliding cache whenever there is a change in the code
COPY . .
RUN npm run build

# Step 2: Final container with Nginx and embedded config
FROM nginx:alpine

RUN apk add --no-cache jq

# Copy only the generated static files
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Embed Nginx configuration directly
RUN printf "server {\n\
    listen 80;\n\
    server_name localhost;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    # Detect social media scrapers and other bots\n\
    set \$is_scraper 0;\n\
    if (\$http_user_agent ~* \"facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|WhatsApp|Applebot|Googlebot|bingbot|YandexBot|Baiduspider|Slurp|DuckDuckBot|Baiduspider|YandexBot|Sogou|Exabot|facebot|ia_archiver\") {\n\
        set \$is_scraper 1;\n\
    }\n\
\n\
    location / {\n\
        # For scrapers, serve index.html so they see static og/twitter meta tags (skip if already requesting index.html to avoid redirect loop)\n\
        set \$rewrite_scraper \$is_scraper;\n\
        if (\$uri = /index.html) { set \$rewrite_scraper 0; }\n\
        if (\$rewrite_scraper = 1) { rewrite ^ /index.html last; }\n\
        try_files \$uri \$uri/ /index.html;\n\
    }\n\
\n\
    location ~* \\.(?:js|css|woff2?|ttf|otf|eot|ico|jpg|jpeg|png|gif|svg|webp)\$ {\n\
        expires 30d;\n\
        access_log off;\n\
        add_header Cache-Control \"public\";\n\
    }\n\
\n\
    gzip on;\n\
    gzip_types text/plain application/javascript application/x-javascript text/javascript text/css application/json;\n\
    gzip_proxied any;\n\
    gzip_min_length 1024;\n\
    gzip_comp_level 6;\n\
}\n" > /etc/nginx/conf.d/default.conf

EXPOSE 80

# Entrypoint writes /config.json (e.g. NIP66_MONITOR_NPUB for relay info page) then starts nginx
ENTRYPOINT ["/docker-entrypoint.sh"]
