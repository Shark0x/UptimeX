# ---------- build ----------
FROM node:20.19-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:20.19-bookworm-slim
ENV NODE_ENV=production TZ=America/Sao_Paulo
# iputils-ping: o motor de monitoramento executa o ping do sistema
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-ping tzdata \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p uploads/empresas && chown -R node:node /app
USER node
EXPOSE 4000
# O schema/roles/RLS vêm do container Postgres (postgres/init/*). O bootstrap espera
# o banco aceitar conexões e semeia o admin inicial (auth_seed_admin); depois sobe a API.
CMD ["sh", "-c", "node dist/db/bootstrap.js || exit 1; unset SEED_ADMIN_PASSWORD; exec node dist/index.js"]
