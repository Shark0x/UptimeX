FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /migration
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY migrate.mjs ./
USER node
CMD ["node", "migrate.mjs"]
