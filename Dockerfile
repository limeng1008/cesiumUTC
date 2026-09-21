FROM node:20-alpine AS web

WORKDIR /opt/cesiumutc/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build


FROM python:3.11-slim-bookworm

WORKDIR /opt/cesiumutc
COPY requirements.txt ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt

COPY . .
COPY deploy/entrypoint.sh /entrypoint.sh
COPY --from=web /opt/cesiumutc/web/dist /opt/cesiumutc/web/dist
COPY deploy/web.conf /etc/nginx/sites-available/cesiumutc.conf
RUN rm -f /etc/nginx/sites-enabled/default \
    && ln -s /etc/nginx/sites-available/cesiumutc.conf /etc/nginx/sites-enabled/cesiumutc.conf

ENV LANG=zh_CN.UTF-8
EXPOSE 80

ENTRYPOINT ["sh", "/entrypoint.sh"]
