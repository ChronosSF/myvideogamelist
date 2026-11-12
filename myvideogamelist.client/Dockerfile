# syntax=docker/dockerfile:1
#
# The SSR server image. Build context is this directory:
#
#   docker build -t mvgl-ssr:local \
#     --build-arg GIT_SHA=$(git rev-parse HEAD) --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
#     myvideogamelist.client
#
# Two stages: a full `node:24` to build, and `node:24-slim` to run. Nothing environment-specific
# is baked in: API_BASE_URL, SITE_URL and SITE_INDEXABLE come from the task definition (ADR 0036,
# 0044), and so does BALANCER_IDLE_TIMEOUT_SECONDS, which has no default here on purpose: without it
# the server does not start (ADR 0093). The build needs no .NET SDK and no dev certificate, because
# vite.config.ts does its certificate work only when Vite's command is `serve`.

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
# Vite has already copied public/ into build/client, so build/ and the server that serves it are all
# the runtime needs. The server is TypeScript that Node runs as it is (ADR 0093).
COPY --from=build /app/build ./build
COPY --from=build /app/server ./server
# Which commit this is and when it was built, for /version (ADR 0059). The deploy workflow passes
# both; a build without them says "unknown". Declared here, after every RUN, because a build
# argument that changes misses the cache for every RUN after its declaration, and these change on
# every commit: anywhere earlier, each build would reinstall the packages above.
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV BUILD_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME
LABEL org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.created=$BUILD_TIME
USER node
EXPOSE 3000
# The server directly, not through `npm start`: npm swallows SIGTERM, the server handles it and
# closes the listener and its connections, which is what lets ECS stop a task promptly on a deploy.
# Not react-router-serve, whose keep-alive is Node's five seconds and ends idle connections before
# the balancer does, which a viewer sees as a 502 (ADR 0093).
CMD ["node", "server/index.ts"]
