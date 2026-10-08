# syntax=docker/dockerfile:1
# Fitron WhatsApp Connector. One image serves both the api and the worker (RUN_MODE picks the role).

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY src/database/prisma ./src/database/prisma
# postinstall runs `prisma generate`; the client is generated into src/generated/prisma
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
 && mkdir -p dist/generated \
 && cp -r src/generated/prisma dist/generated/prisma \
 && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl tini \
 && addgroup -S app && adduser -S app -G app \
 && mkdir -p /data/whatsapp-sessions /data/media && chown -R app:app /data
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/src/database/prisma ./src/database/prisma
COPY --chown=app:app package.json ./
COPY --chown=app:app docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh
USER app
VOLUME ["/data/whatsapp-sessions", "/data/media"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--", "./docker/entrypoint.sh"]
CMD ["node", "dist/server/server.js"]
