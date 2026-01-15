# Dockerfile ajustado para Hugging Face Spaces

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

# Configura Timezone
ENV TZ=America/Sao_Paulo
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

# --- MUDANÇA CRÍTICA AQUI ---
# Hugging Face Spaces EXIGE a porta 7860
ENV PORT=7860

ENV NODE_ENV=production
ENV DATABASE_TYPE=sql
ENV NODE_OPTIONS=--max-old-space-size=8192

# Copia arquivos do builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Documentação
COPY src/adapters/http/swagger.yaml ./dist/adapters/http/swagger.yaml
COPY src/adapters/http/asyncapi.yaml ./dist/adapters/http/asyncapi.yaml

# Cria pasta de output e ajusta permissões (importante para SQLite no HF)
RUN mkdir -p simulation_output && chmod 777 simulation_output
RUN mkdir -p src/adapters/database/test && chmod -R 777 src/adapters/database

# --- MUDANÇA CRÍTICA AQUI ---
EXPOSE 7860

CMD ["npm", "run", "serve"]