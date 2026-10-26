# Build from the repository root: docker build -f frontend/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend --include-workspace-root=false
COPY frontend frontend
# Empty VITE_API_URL: the browser calls /api on the same origin and nginx proxies it.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npx -w frontend vite build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
