FROM node:24.18.0-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace=@babel/web

FROM node:24.18.0-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
