# NIP-66 monitor cron: runs alongside the app, keeps nsec on server only.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.mjs ./

ENV NODE_ENV=production
CMD ["node", "index.mjs"]
