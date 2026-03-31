FROM node:20-slim AS builder

WORKDIR /app

# Build dependencies (includes TypeScript + @types from devDependencies)
COPY package.json ./
COPY prisma ./prisma
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm install
RUN npx prisma generate --schema ./prisma/schema.prisma

# Copy source and compile
COPY . .
RUN npm run build

# Keep only runtime deps for final image
RUN npm prune --omit=dev


FROM node:20-slim

WORKDIR /app

# Chromium runtime (let apt resolve exact dependency package names per distro)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts

CMD ["npm", "start"]
