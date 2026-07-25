# =============================================================================
# Build Stage
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Install build dependencies
COPY package*.json tsconfig*.json nest-cli.json ./
RUN npm ci

# Copy source code and build production bundle
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies for production image
RUN npm prune --production

# =============================================================================
# Production Stage
# =============================================================================
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

# Set production environment
ENV NODE_ENV=production

# Security: Run application as non-root user
USER node

# Copy built assets and production node_modules from builder stage
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=builder /usr/src/app/dist ./dist

# Expose HTTP port
EXPOSE 3000

# Health check probe
HEALTHCHECK --interval=15s --timeout=10s --start-period=30s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start production server
CMD ["node", "dist/main.js"]
