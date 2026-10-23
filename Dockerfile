FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm ci --no-audit --no-fund && npm run build

FROM node:22-alpine
# Lets the official MCP Registry verify ownership if this image is ever listed
# as an `oci` package in server.json.
LABEL io.modelcontextprotocol.server.name="io.github.AxelVerneBooks/research-scope-mcp"
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    RESEARCH_SCOPE_DATA_DIR=/app/data
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY server.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3001
# Streamable HTTP on $PORT (Smithery and other hosts inject their own PORT).
# For stdio instead: docker run --rm -i <image> --stdio
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--http"]
