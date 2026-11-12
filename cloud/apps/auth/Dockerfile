FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
WORKDIR /app
ENV PATH="/opt/pnpm/node_modules/.bin:$PATH"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
RUN npm install --prefix /opt/pnpm --ignore-scripts --no-audit --no-fund "$(node -p 'require("./package.json").packageManager.split("+")[0]')" \
  && npm audit signatures --prefix /opt/pnpm
COPY packages/postgres-schema/package.json packages/postgres-schema/package.json
COPY packages/cloud-database/package.json packages/cloud-database/package.json
COPY apps/auth/package.json apps/auth/package.json
RUN pnpm install --frozen-lockfile
COPY packages/postgres-schema packages/postgres-schema
COPY packages/cloud-database packages/cloud-database
COPY apps/auth apps/auth
RUN pnpm --filter @orca-cloud/postgres-schema build && pnpm --filter @orca-cloud/cloud-database build \
  && pnpm --filter @orca-cloud/auth build

FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
# Pull Alpine security fixes published after the base image was built.
RUN apk upgrade --no-cache
COPY --from=build /opt/pnpm /opt/pnpm
ENV PATH="/opt/pnpm/node_modules/.bin:$PATH"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/postgres-schema/package.json packages/postgres-schema/package.json
COPY packages/cloud-database/package.json packages/cloud-database/package.json
COPY apps/auth/package.json apps/auth/package.json
COPY --from=build /app/packages/postgres-schema/dist packages/postgres-schema/dist
COPY --from=build /app/packages/cloud-database/dist packages/cloud-database/dist
COPY --from=build /app/apps/auth/dist apps/auth/dist
RUN pnpm install --prod --frozen-lockfile --filter @orca-cloud/auth... \
  && rm -rf /opt/pnpm /usr/local/lib/node_modules /usr/local/share/.cache/yarn /root/.cache /root/.local \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
# The signing key and the session secret live here; mount a volume so a restart keeps the relay's
# cached JWKS valid.
RUN mkdir -p /data/auth && chown -R node:node /data
ENV ORCA_AUTH_DATA_DIR=/data/auth
VOLUME ["/data"]
USER node
EXPOSE 8080
CMD ["node", "apps/auth/dist/index.js"]
