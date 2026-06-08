# KN Box Deployment

Production uses separated public origins:

- `box.kn.run` serves the KN Box app and authenticated API.
- `*.box.kn.run` serves uploaded public files on per-user subdomains.

The hosts may route to the same container, but user subdomains must not be used
for the app UI or API. The server enforces this when `KNBOX_FILES_PUBLIC_URL`
is set to a wildcard URL.

## Required Environment

Set these values in `/home/ubuntu/knbox/.env` or in the container environment:

```bash
PORT=6789
KNBOX_DATA_DIR=/data
KNBOX_PUBLIC_URL=https://box.kn.run
KNBOX_FILES_PUBLIC_URL=https://*.box.kn.run
KNBOX_USER_QUOTA_BYTES=1073741824
KNBOX_SESSION_SECRET=<strong-random-secret>
KNBOX_KYLITH_ISSUER=<issuer>
KNBOX_KYLITH_CREDENTIALS_FILE=<credentials-json-path>
```

`KNBOX_USER_QUOTA_BYTES` defaults to 1 GB if it is not set.

KN Box does not support password login and does not seed a default admin user.
After the first super admin signs in through KYLITH once, promote that account
on the production host:

```bash
cd /home/ubuntu/knbox
docker exec knbox node scripts/set-super-admin.mjs user@example.com
```

If running the script outside the container, point it at the same persisted data
directory used by the container.

## Reverse Proxy

Both the app hostname and wildcard user hostnames should proxy to the same Node
service:

```nginx
server {
  server_name box.kn.run;

  location / {
    proxy_pass http://127.0.0.1:6789;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}

server {
  server_name *.box.kn.run;

  location / {
    proxy_pass http://127.0.0.1:6789;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Do not configure KN Box cookies with `Domain=.box.kn.run`. The session cookie
must remain host-only for `box.kn.run`, so uploaded pages on user subdomains
cannot use the browser session cookie.

Old public paths such as `https://b.beforeve.com/u/allen/readme.md` redirect to
the canonical user-domain form `https://allen.box.kn.run/readme.md`.

## Release Flow

Merging to the `release` branch triggers `.github/workflows/release.yml`.
The workflow:

1. Installs dependencies with `npm ci --ignore-scripts`.
2. Rebuilds the native `better-sqlite3` binding.
3. Runs type and JavaScript syntax checks.
4. Runs the automated server regression tests.
5. Builds the web bundle.
6. Builds a Docker image.
7. Uploads the image to the production host.
8. Starts the container with:
   - `KNBOX_PUBLIC_URL=https://box.kn.run`
   - `KNBOX_FILES_PUBLIC_URL=https://*.box.kn.run`
   - `KNBOX_DATA_DIR=/data`
9. Checks the local container health.
10. Verifies that user-domain host requests cannot access `/api/auth/config`.

After deployment, verify:

```bash
curl -I https://box.kn.run/
curl -I https://allen.box.kn.run/api/auth/config
```

The second command should return `404`.
