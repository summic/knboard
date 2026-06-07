# KN Box — self-hosted webpage upload service.
#
#   docker build -t knbox .
#   docker run --rm -p 6789:6789 -v "$PWD/data:/data" knbox
#
# Then open http://localhost:6789
FROM node:20-alpine
WORKDIR /app

# Install + build the bundled web app at image-build time.
COPY package*.json ./
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto-cjk font-noto-cjk-extra \
  && fc-cache -f \
  && apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --ignore-scripts \
  && npm rebuild better-sqlite3 \
  && apk del .build-deps
COPY . .
RUN npm run build

ENV KNBOX_DATA_DIR=/data
ENV KNBOX_THUMBNAIL_BROWSER_PATH=/usr/bin/chromium-browser
ENV PORT=6789
EXPOSE 6789
VOLUME ["/data"]
CMD ["node", "bin/knbox.js", "serve"]
