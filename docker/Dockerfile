FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm ci --no-audit --no-fund && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    RESEARCH_SCOPE_DATA_DIR=/app/data
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY server.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "dist/index.js"]
# Containers must bind all interfaces to be reachable through -p; the CLI default is loopback.
CMD ["--http", "--port", "3001", "--host", "0.0.0.0"]
