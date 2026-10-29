# Fly.io (and any Docker host): builds the Scurry Live game server from the scurry-live/ folder.
FROM node:22-slim
WORKDIR /app
COPY scurry-live/package.json scurry-live/package-lock.json ./
RUN npm ci --omit=dev
COPY scurry-live/server.js ./
COPY scurry-live/public ./public
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
