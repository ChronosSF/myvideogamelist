# syntax=docker/dockerfile:1
#
# The SSR server image. Build context is this directory:
#
#   docker build -t mvgl-ssr:local myvideogamelist.client
#
# Two stages: a full `node:24` to build, and `node:24-slim` to run. Nothing environment-specific
# is baked in: API_BASE_URL, SITE_URL and SITE_INDEXABLE come from the task definition (ADR 0036,
# 0043). The build needs no .NET SDK and no dev certificate, because vite.config.ts does its
# certificate work only when Vite's command is `serve`.

FROM node:24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY package.json package-lock.json ./
# @react-router/dev sits under dependencies, so this still installs the build toolchain; moving
# it to devDependencies is a clean-up of its own and does not change what runs.
RUN npm ci --omit=dev
# Vite has already copied public/ into build/client, so build/ is all the runtime needs.
COPY --from=build /app/build ./build
USER node
EXPOSE 3000
# The server directly, not through `npm start`: npm swallows SIGTERM, react-router-serve handles
# it and closes the listener, which is what lets ECS stop a task promptly on a deploy.
CMD ["./node_modules/.bin/react-router-serve", "./build/server/index.js"]
