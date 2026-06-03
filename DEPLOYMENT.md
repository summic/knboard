# KN Box Deployment

Production uses two public hostnames:

- `box.beforeve.com` serves the KN Box app and authenticated API.
- `b.beforeve.com` serves uploaded public files only.

The two hostnames may route to the same container, but `b.beforeve.com` must not
be used for the app UI or API. The server enforces this when
`KNBOX_FILES_PUBLIC_URL` is set.

## Required Environment

Set these values in `/home/ubuntu/knbox/.env` or in the container environment:

```bash
PORT=6789
KNBOX_DATA_DIR=/data
KNBOX_PUBLIC_URL=https://box.beforeve.com
KNBOX_FILES_PUBLIC_URL=https://b.beforeve.com
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

Both hostnames should proxy to the same Node service:

```nginx
server {
  server_name box.beforeve.com;

  location / {
    proxy_pass http://127.0.0.1:6789;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}

server {
  server_name b.beforeve.com;

  location / {
    proxy_pass http://127.0.0.1:6789;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Do not configure KN Box cookies with `Domain=.beforeve.com`. The session cookie
must remain host-only for `box.beforeve.com`, so uploaded pages on
`b.beforeve.com` cannot use the browser session cookie.

## Release Flow

Merging to the `release` branch triggers `.github/workflows/release.yml`.
The workflow:

1. Installs dependencies with `npm ci --ignore-scripts`.
2. Runs type and JavaScript syntax checks.
3. Runs the automated server regression tests.
4. Builds the web bundle.
5. Builds a Docker image.
6. Uploads the image to the production host.
7. Starts the container with:
   - `KNBOX_PUBLIC_URL=https://box.beforeve.com`
   - `KNBOX_FILES_PUBLIC_URL=https://b.beforeve.com`
   - `KNBOX_DATA_DIR=/data`
8. Checks the local container health.
9. Verifies that `b.beforeve.com` host requests cannot access `/api/auth/config`.

After deployment, verify:

```bash
curl -I https://box.beforeve.com/
curl -I https://b.beforeve.com/api/auth/config
```

The second command should return `404`.
