FROM node:22-slim

WORKDIR /app

# Install pnpm — on the official node image, global packages land in /usr/local/bin (already on PATH)
RUN npm install -g pnpm@10.26.1

# Copy everything
COPY . .

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile

# Build frontend (capability-economics) then API server
RUN pnpm run build:deploy

EXPOSE 8080

# Push database schema then start the API server
CMD ["sh", "-c", "pnpm --filter @workspace/db run push && pnpm run start"]
