# Vectorize Image — Magenta Background (versi statis, 100% di browser)
# Tahap 1: build frontend → /app/dist
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Tahap 2: sajikan file statis dengan nginx (tanpa Node.js di runtime)
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
