# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if test -f /run/secrets/proxy_ca; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --strict-ssl=true; \
    else \
      npm ci --strict-ssl=true; \
    fi
COPY . .
RUN DATABASE_URL=postgres://build:build@127.0.0.1/build \
    SESSION_SECRET=build-only-placeholder-32-characters-long \
    DATA_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA \
    npm run build

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["sh", "-c", "node --import tsx scripts/migrate.ts && node --import tsx scripts/seed.ts && npm run start"]
