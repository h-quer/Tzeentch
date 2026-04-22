# Build stage
FROM node:22-slim AS builder

# Install build tools just in case for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:22-slim

# better-sqlite3 might need dependencies to run or re-build if prebuilds are missing
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# Make sure to cleanly install production dependencies
RUN npm ci --omit=dev

# Copy build artifacts and server components
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/tsconfig.json ./
# Copy entire src just in case there are missing module dependencies (like db.ts, types.ts)
COPY --from=builder /app/src ./src

# Create data directory for persistence
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
