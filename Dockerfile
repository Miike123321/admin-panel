FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/server.mjs ./server.mjs
COPY --from=builder /app/dist ./dist

USER node

CMD ["node", "server.mjs"]
