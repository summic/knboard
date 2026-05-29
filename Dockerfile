# knboard — serve a mounted docs directory.
#
#   docker build -t knboard .
#   docker run --rm -p 6789:6789 -v "$PWD/docs:/data" knboard
#
# Then open http://localhost:6789
FROM node:20-alpine
WORKDIR /app

# Install + build the bundled web app at image-build time.
COPY package*.json ./
RUN npm install --ignore-scripts
COPY . .
RUN npm run build

ENV KNBOARD_DIR=/data
ENV PORT=6789
EXPOSE 6789
VOLUME ["/data"]
# --yes: non-interactive, so create the docs structure if the mount is empty.
CMD ["node", "bin/knboard.js", "serve", "--yes"]
