# VendorPay container image. GIT_SHA is baked in so /version reports the exact commit.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ARG GIT_SHA=unknown
ARG BUILT_AT=unknown
ENV NODE_ENV=production GIT_SHA=$GIT_SHA BUILT_AT=$BUILT_AT PORT=3000 LOG_FILE=/app/logs/app.log
LABEL org.opencontainers.image.revision=$GIT_SHA org.opencontainers.image.title="vendorpay"
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY db ./db
COPY public ./public
RUN mkdir -p /app/logs && chown -R node:node /app/logs
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
# Apply migrations (and demo data when SEED_ON_START=true), then start.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
