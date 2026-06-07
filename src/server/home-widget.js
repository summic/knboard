import { homepageFontStack } from "./homepage-settings.js";

export function homeWidgetScript() {
  return `(() => {
  const config = window.__KNBOX_HOME_WIDGET__;
  if (!config || config.enabled === false || document.querySelector("knbox-home-widget")) return;
  const host = document.createElement("knbox-home-widget");
  const root = host.attachShadow({ mode: "closed" });
  const link = document.createElement("a");
  link.className = "wrap";
  link.href = config.homeUrl || "/";
  const label = config.title || config.name || "返回主页";
  link.title = label;
  link.setAttribute("aria-label", label);
  const avatar = document.createElement("span");
  avatar.className = "avatar";
  if (config.avatarUrl) {
    const img = document.createElement("img");
    img.src = config.avatarUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    avatar.appendChild(img);
  } else {
    avatar.textContent = String(config.initial || "H").slice(0, 1).toUpperCase();
  }
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = label;
  if (config.font) text.style.fontFamily = config.font;
  link.append(avatar, text);
  const style = document.createElement("style");
  style.textContent = \`
    :host { position: fixed; left: 18px; bottom: 18px; z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { display: inline-flex; align-items: center; max-width: 300px; padding: 5px; overflow: hidden; border: 1px solid rgba(18, 22, 28, .14); border-radius: 999px; background: rgba(255, 255, 255, .94); color: #171717; text-decoration: none; box-shadow: 0 6px 18px rgba(18, 22, 28, .14); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); transition: border-color .18s ease, background .18s ease, box-shadow .18s ease; }
    .wrap:hover, .wrap:focus-visible { background: #fff; border-color: rgba(36, 88, 211, .32); box-shadow: 0 10px 26px rgba(18, 22, 28, .18); }
    .avatar { display: inline-grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto; border-radius: 50%; overflow: hidden; background: #2458d3; color: #fff; font-size: 13px; font-weight: 700; }
    .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .text { display: inline-block; max-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: 0; margin-left: 0; font-family: "Songti SC", "Noto Serif SC", "SimSun", Georgia, serif; font-size: 14px; font-weight: 600; letter-spacing: 0; transition: max-width .22s cubic-bezier(.2, 0, 0, 1), opacity .16s ease, margin-left .22s cubic-bezier(.2, 0, 0, 1); }
    .wrap:hover .text, .wrap:focus-visible .text { max-width: 210px; margin-left: 9px; padding-right: 4px; opacity: 1; }
    @media (max-width: 560px) { :host { left: 12px; bottom: 12px; } .avatar { width: 30px; height: 30px; } .wrap:hover .text, .wrap:focus-visible .text { max-width: 160px; } }
  \`;
  root.append(style, link);
  document.body.appendChild(host);
})();`;
}

export function homeWidgetMarkup(config) {
  if (!config?.enabled) return "";
  return `<script>window.__KNBOX_HOME_WIDGET__=${safeJson(config)};</script><script src="/knbox/home-widget.js" defer></script>`;
}

export function injectHomeWidget(html, config) {
  const markup = homeWidgetMarkup(config);
  if (!markup) return html;
  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(html)) return html.replace(bodyClose, `${markup}</body>`);
  return `${html}${markup}`;
}

export function homeWidgetConfig({ user, storageName, settings }) {
  if (!user || settings?.showHomeLink === false) return null;
  const name = user.name || user.username || "Home";
  return {
    enabled: true,
    name,
    title: settings?.displayName || name,
    font: homepageFontStack(settings?.titleFont),
    initial: name.slice(0, 1).toUpperCase(),
    avatarUrl: user.avatarUrl || null,
    homeUrl: `/u/${encodeURIComponent(storageName || user.username)}`,
  };
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    if (char === "<") return "\\u003c";
    if (char === ">") return "\\u003e";
    if (char === "&") return "\\u0026";
    if (char === "\u2028") return "\\u2028";
    return "\\u2029";
  });
}
