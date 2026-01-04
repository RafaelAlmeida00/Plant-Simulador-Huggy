# Dockerfile para rodar o simulador no Render

# ---- Build stage ----
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Mantém apenas dependências de runtime
RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Set timezone to Brazil (UTC-3)
ENV TZ=America/Sao_Paulo
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

# Render injeta PORT em runtime; default permanece 3000
ENV PORT=3000

# Mantém sqlite fora de src/ (ver DatabaseConfig.ts)
ENV NODE_ENV=production
ENV DATABASE_TYPE=sql

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Garante que os arquivos de documentação estejam disponíveis em produção
COPY src/adapters/http/swagger.yaml ./dist/adapters/http/swagger.yaml
COPY src/adapters/http/asyncapi.yaml ./dist/adapters/http/asyncapi.yaml

RUN mkdir -p simulation_output

EXPOSE 3000

CMD ["node", "dist/index.js"]
