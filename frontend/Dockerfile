# ---------- build ----------
FROM node:20.19-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# API e socket via proxy do nginx (mesma origem): sem CORS e uma porta única
ENV VITE_API_URL=/api VITE_SOCKET_URL=/
RUN npm run build

# ---------- runtime ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
