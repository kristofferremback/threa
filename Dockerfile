# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build frontend
RUN bun run build:client

# Production stage
FROM oven/bun:1-slim

WORKDIR /app

# Copy package files and install production deps only
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Copy built assets and server code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Run server
CMD ["bun", "run", "src/server/index.ts"]
