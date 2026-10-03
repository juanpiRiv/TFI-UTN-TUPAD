# Dockerfile del frontend (React + Vite -> estatico servido por nginx).
#
# El contexto de build es la RAIZ del monorepo (mismo motivo que el backend):
#
#   docker build -f frontend/Dockerfile -t tfi-frontend .
#
# Variables de build (Vite las baja a codigo en el bundle):
#
#   docker build -f frontend/Dockerfile \
#     --build-arg VITE_API_URL=https://api.ejemplo.com \
#     -t tfi-frontend .
#
# Para una build de desarrollo con MSW: --build-arg VITE_USE_MOCKS=true

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --filter frontend --frozen-lockfile

COPY frontend ./frontend
ARG VITE_API_URL
ARG VITE_USE_MOCKS
ENV VITE_API_URL=${VITE_API_URL} VITE_USE_MOCKS=${VITE_USE_MOCKS}
RUN pnpm --filter frontend build

FROM nginx:1.29-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
