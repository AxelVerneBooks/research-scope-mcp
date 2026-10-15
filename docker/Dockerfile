FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm ci --no-audit --no-fund && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY server.json ./
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3001
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--http", "--port", "3001"]
