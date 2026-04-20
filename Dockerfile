FROM node:22-slim

WORKDIR /app

# Install pnpm — on the official node image, global packages land in /usr/local/bin (already on PATH)
RUN npm install -g pnpm@10.26.1

# Copy everything
COPY . .

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile

# Build-time variables (Vite bakes these into the bundle)
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PROXY_URL=$VITE_CLERK_PROXY_URL

# Build frontend (capability-economics) then API server
RUN pnpm run build:deploy

ENV PORT=8080
EXPOSE 8080

# Push schema, seed core data + marketplace catalog (all idempotent), then start server
CMD ["sh", "-c", "pnpm --filter @workspace/db run push && pnpm --filter @workspace/scripts run seed && pnpm --filter @workspace/scripts run seed:marketplace && pnpm run start"]
