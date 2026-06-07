import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const THUMBNAIL_CONTENT_EXTENSIONS = new Set([".html", ".htm", ".md", ".markdown", ".mdx"]);
const pendingJobs = new Set();

export function isWebPagePath(rel) {
  return THUMBNAIL_CONTENT_EXTENSIONS.has(path.extname(String(rel || "")).toLowerCase());
}

export function webThumbnailRelativePath(rel) {
  const clean = String(rel || "").replace(/\\/g, "/");
  const dir = path.posix.dirname(clean);
  const name = path.posix.basename(clean);
  const hidden = `.${name}.png`;
  return dir && dir !== "." ? `${dir}/${hidden}` : hidden;
}

export async function webThumbnailInfo({ filesDir, rel, sourceStat, thumbnailBasePath }) {
  if (!isWebPagePath(rel) || !thumbnailBasePath) return null;
  const root = path.resolve(filesDir);
  const thumbRel = webThumbnailRelativePath(rel);
  const thumbAbs = path.resolve(root, thumbRel);
  assertInside(root, thumbAbs);
  const thumbStat = await fs.stat(thumbAbs).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const ready = Boolean(thumbStat?.isFile() && (!sourceStat || thumbStat.mtimeMs >= sourceStat.mtimeMs));
  const url = `${thumbnailBasePath}${thumbnailBasePath.includes("?") ? "&" : "?"}path=${encodeURIComponent(rel)}`;
  return {
    status: ready ? "ready" : "pending",
    url,
    updatedAt: ready ? thumbStat.mtime.toISOString() : null,
  };
}

export async function readWebThumbnail({ filesDir, rel }) {
  if (!isWebPagePath(rel)) return null;
  const root = path.resolve(filesDir);
  const sourceAbs = path.resolve(root, rel);
  const thumbAbs = path.resolve(root, webThumbnailRelativePath(rel));
  assertInside(root, sourceAbs);
  assertInside(root, thumbAbs);
  const [sourceStat, thumbStat] = await Promise.all([
    fs.stat(sourceAbs).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }),
    fs.stat(thumbAbs).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }),
  ]);
  if (!sourceStat?.isFile() || !thumbStat?.isFile() || thumbStat.mtimeMs < sourceStat.mtimeMs) return null;
  return { path: thumbAbs, stat: thumbStat };
}

export async function removeWebThumbnail({ filesDir, rel }) {
  if (!isWebPagePath(rel)) return false;
  const root = path.resolve(filesDir);
  const thumbAbs = path.resolve(root, webThumbnailRelativePath(rel));
  assertInside(root, thumbAbs);
  await fs.rm(thumbAbs, { force: true });
  return true;
}

export function queueWebThumbnail({ filesDir, rel, pageUrl, allowedPathPrefix }) {
  if (!isWebPagePath(rel) || !pageUrl) return false;
  const root = path.resolve(filesDir);
  const key = `${root}\0${rel}`;
  if (pendingJobs.has(key)) return true;
  pendingJobs.add(key);
  setTimeout(() => {
    generateWebThumbnail({ filesDir: root, rel, pageUrl, allowedPathPrefix })
      .catch((error) => {
        console.warn("Failed to generate web thumbnail", error?.message || error);
      })
      .finally(() => pendingJobs.delete(key));
  }, 10);
  return true;
}

export async function generateWebThumbnail({ filesDir, rel, pageUrl, allowedPathPrefix }) {
  if (process.env.KNBOX_DISABLE_WEB_THUMBNAILS === "1") return false;
  if (!isWebPagePath(rel)) return false;
  const root = path.resolve(filesDir);
  const sourceAbs = path.resolve(root, rel);
  const thumbAbs = path.resolve(root, webThumbnailRelativePath(rel));
  assertInside(root, sourceAbs);
  assertInside(root, thumbAbs);
  const sourceStat = await fs.stat(sourceAbs).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!sourceStat?.isFile()) return false;

  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    return false;
  }
  const executablePath = await findBrowserExecutable();
  if (!executablePath) return false;

  await fs.mkdir(path.dirname(thumbAbs), { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await restrictThumbnailRequests(page, { pageUrl, allowedPathPrefix });
    await page.goto(pageUrl || pathToFileURL(sourceAbs).href, { waitUntil: "domcontentloaded", timeout: 12000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: thumbAbs, type: "png", fullPage: false });
    return true;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function findBrowserExecutable() {
  const candidates = [
    process.env.KNBOX_THUMBNAIL_BROWSER_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await fs.stat(candidate).then((stat) => stat.isFile()).catch(() => false)) return candidate;
  }
  return null;
}

async function restrictThumbnailRequests(page, { pageUrl, allowedPathPrefix }) {
  const base = new URL(pageUrl);
  const allowedPrefix = allowedPathPrefix || base.pathname.replace(/\/[^/]*$/, "/");
  await page.route("**/*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.protocol === "data:" || requestUrl.protocol === "blob:") return route.continue();
    if (requestUrl.origin === base.origin && requestUrl.pathname.startsWith(allowedPrefix)) {
      return route.continue();
    }
    return route.abort();
  });
}

function assertInside(root, target) {
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Invalid file path.");
}
