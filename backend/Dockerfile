# ---------- build ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:20-bookworm-slim
ENV NODE_ENV=production TZ=America/Sao_Paulo
# iputils-ping: o motor de monitoramento executa o ping do sistema
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-ping tzdata \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p uploads/empresas
EXPOSE 4000
# Migra o banco (cria tabelas/admin) com retry até o MySQL aceitar conexões, depois sobe a API
CMD ["sh", "-c", "for i in $(seq 1 30); do node dist/db/migrate.js && break || (echo 'aguardando MySQL...' && sleep 2); done && node dist/index.js"]
