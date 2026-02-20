# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
RUN yarn build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install production dependencies only
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

# Copy built files from builder
COPY --from=builder /app/api/dist ./api/dist

# Copy ABIs directory (needed at runtime for smart contract interactions)
COPY abis ./abis

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Run the server
CMD ["node", "api/dist/index.js"]
