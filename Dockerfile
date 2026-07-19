# Build stage
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy URL so prisma/next don't complain at build time; real one comes from env.
ENV DATABASE_URL="file:./data/pills.db"
RUN npm run build

# Prisma CLI stage — `migrate deploy` needs the CLI's full dependency tree,
# which the Next standalone output does not include.
FROM node:24-alpine AS prisma-cli
WORKDIR /opt/prisma
RUN npm install --ignore-scripts prisma@6.19.3

# Runtime stage
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache curl
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=prisma-cli /opt/prisma/node_modules /opt/prisma/node_modules
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/data
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
