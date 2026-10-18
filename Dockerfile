FROM node:24.18.0-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

FROM build AS worker-dependencies
RUN npm prune --omit=dev --workspace=@babel/voice-worker --include-workspace-root=false

FROM node:24.18.0-alpine AS voice-worker
ENV NODE_ENV=production
ENV MEDIA_CONTROL_HOST=0.0.0.0
WORKDIR /app
COPY --from=worker-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/voice-worker/dist ./apps/voice-worker/dist
USER node
EXPOSE 3100
CMD ["node", "apps/voice-worker/dist/index.mjs"]

FROM node:24.18.0-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.output ./.output
COPY --from=build --chown=node:node /app/packages/database/dist/migrate.mjs ./database/migrate.mjs
COPY --from=build --chown=node:node /app/packages/database/migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
