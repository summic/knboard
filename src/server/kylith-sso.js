import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";

const STATE_COOKIE = "knbox_kylith_state";
const STATE_TTL_MS = 1000 * 60 * 10;

export function createKylithSso({ publicUrl, sessionSecret }) {
  const credentials = readCredentials();
  const issuer = stripTrailingSlash(process.env.KNBOX_KYLITH_ISSUER || "https://auth0.kylith.com");
  const clientId = process.env.KNBOX_KYLITH_CLIENT_ID || credentials.clientId;
  const clientSecret = process.env.KNBOX_KYLITH_CLIENT_SECRET || credentials.clientSecret;
  const redirectUri =
    process.env.KNBOX_KYLITH_REDIRECT_URI || `${stripTrailingSlash(publicUrl)}/auth/callback`;
  const scope = process.env.KNBOX_KYLITH_SCOPE || "openid profile email";
  const stateSecret = sessionSecret || process.env.KNBOX_SESSION_SECRET || "dev-session-secret-change-me";

  let discoveryPromise = null;
  let jwks = null;

  const configured = Boolean(issuer && clientId && clientSecret);

  return {
    configured,
    issuer,
    clientId,
    redirectUri,

    async authorizationUrl({ returnTo = "/" } = {}) {
      assertConfigured(configured);
      const discovery = await discover();
      const state = crypto.randomBytes(24).toString("base64url");
      const nonce = crypto.randomBytes(24).toString("base64url");
      const url = new URL(discovery.authorization_endpoint);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scope);
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      return {
        url: url.toString(),
        stateCookie: signState({ state, nonce, returnTo: safeReturnTo(returnTo), exp: Date.now() + STATE_TTL_MS }),
      };
    },

    async exchangeCode({ code, nonce }) {
      assertConfigured(configured);
      if (!code) throw new Error("Missing authorization code.");
      const discovery = await discover();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const tokenRes = await fetch(discovery.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      const tokens = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        throw new Error(tokens.error_description || tokens.error || "KYLITH token exchange failed.");
      }
      if (!tokens.id_token) throw new Error("KYLITH token response did not include an id_token.");

      jwks ||= createRemoteJWKSet(new URL(discovery.jwks_uri));
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: discovery.issuer || issuer,
        audience: clientId,
      });
      if (payload.nonce !== nonce) throw new Error("KYLITH nonce verification failed.");

      // The id_token may omit profile claims, so pull name/email/picture from
      // the UserInfo endpoint with the access token and merge them in.
      const profile = await fetchUserInfo(discovery, tokens.access_token);
      return { ...payload, ...profile };
    },

    setStateCookie(req, res, value) {
      res.cookie(STATE_COOKIE, value, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.secure || req.headers["x-forwarded-proto"] === "https",
        maxAge: STATE_TTL_MS,
        path: "/",
      });
    },

    readStateCookie(req) {
      return verifyState(parseCookies(req.headers.cookie || "")[STATE_COOKIE]);
    },

    clearStateCookie(res) {
      res.clearCookie(STATE_COOKIE, { path: "/" });
      res.clearCookie(STATE_COOKIE, { path: "/api/auth/kylith" });
    },
  };

  async function discover() {
    discoveryPromise ||= fetch(`${issuer}/.well-known/openid-configuration`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error_description || body.error || "Failed to load KYLITH discovery document.");
        if (!body.authorization_endpoint || !body.token_endpoint || !body.jwks_uri) {
          throw new Error("KYLITH discovery document is missing required OIDC endpoints.");
        }
        return body;
      })
      .catch((error) => {
        discoveryPromise = null;
        throw new Error(`Failed to load KYLITH discovery document from ${issuer}: ${error.message}`);
      });
    return discoveryPromise;
  }

  // GET {userinfo_endpoint} with the bearer access token → { sub, name, email,
  // picture, ... }. Best-effort: on any failure we fall back to id_token claims.
  async function fetchUserInfo(discovery, accessToken) {
    if (!accessToken) return {};
    const endpoint = discovery.userinfo_endpoint || `${issuer}/userinfo`;
    try {
      const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return {};
      const info = await res.json().catch(() => ({}));
      return info && typeof info === "object" ? info : {};
    } catch {
      return {};
    }
  }

  function signState(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${hmac(body, stateSecret)}`;
  }

  function verifyState(value) {
    if (!value) return null;
    const [body, signature] = value.split(".");
    if (!body || !signature) return null;
    const expected = hmac(body, stateSecret);
    if (signature.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

    try {
      const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!parsed.exp || parsed.exp < Date.now()) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

export function safeReturnTo(value) {
  const returnTo = String(value || "/");
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
  return returnTo;
}

function readCredentials() {
  const file = process.env.KNBOX_KYLITH_CREDENTIALS_FILE;
  if (!file) return {};
  const parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return {
    clientId: parsed.client_id || parsed.clientId,
    clientSecret: parsed.client_secret || parsed.clientSecret,
  };
}

function assertConfigured(configured) {
  if (!configured) {
    throw new Error("KYLITH SSO is not configured. Set KNBOX_KYLITH_CLIENT_ID and KNBOX_KYLITH_CLIENT_SECRET.");
  }
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function hmac(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}
