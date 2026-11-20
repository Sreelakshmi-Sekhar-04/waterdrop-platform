# WtrDrop API container. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t wtrdrop-api .
# Before each release, run the migrations once with the same image:
#   docker run --rm -e DATABASE_URL=… wtrdrop-api node dist/db/migrate.js
# Then start (or replace) the API containers. Configuration comes only from environment variables
# (see apps/api/.env.example); the process refuses to start with missing or weak secrets.

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @wtrdrop/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @wtrdrop/api build \
 && pnpm --filter @wtrdrop/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/src/db/migrations ./src/db/migrations
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
