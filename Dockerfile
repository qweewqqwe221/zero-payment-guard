# MCP server over stdio (same tools as the hosted endpoint). Build: docker build -t zero-payment-guard .
FROM node:22-slim
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/stdio.ts"]
