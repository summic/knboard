import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { homeWidgetMarkup } from "./home-widget.js";

export function renderMarkdownDocument(markdown, { title = "Markdown", theme = "theme-6", homeWidget = null } = {}) {
  const body = renderToStaticMarkup(
    React.createElement(
      "article",
      { className: "doc-read prose" },
      markdown.trim()
        ? React.createElement(ReactMarkdown, {
            remarkPlugins: [remarkGfm],
            rehypePlugins: [rehypeHighlight],
            children: markdown,
          })
        : React.createElement("p", { className: "prose-empty" }, "（空文档）")
    )
  );

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${pageStyles()}</style>
</head>
${bodyShell(body, { theme, homeWidget })}
</html>`;
}

export function renderNotFoundDocument({ title = "页面不存在", path: requestedPath = "" } = {}) {
  const body = `
    <article class="doc-read not-found">
      <p class="not-found-kicker">404</p>
      <h1>页面不存在</h1>
      <p>你访问的网页不存在，可能已被删除、移动，或链接拼写有误。</p>
      ${requestedPath ? `<p class="not-found-path">${escapeHtml(requestedPath)}</p>` : ""}
      <div class="not-found-actions">
        <button type="button" onclick="history.length > 1 ? history.back() : location.assign('/')">后退</button>
        <a href="/">返回首页</a>
      </div>
    </article>
  `;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${pageStyles()}</style>
</head>
${bodyShell(body)}
  </html>`;
}

export function renderForbiddenDocument({
  title = "禁止访问",
  path: requestedPath = "",
  message = "不允许访问这个地址。",
} = {}) {
  const body = `
    <article class="doc-read not-found">
      <p class="not-found-kicker">403</p>
      <h1>禁止访问</h1>
      <p>${escapeHtml(message)}</p>
      ${requestedPath ? `<p class="not-found-path">${escapeHtml(requestedPath)}</p>` : ""}
      <div class="not-found-actions">
        <button type="button" onclick="history.length > 1 ? history.back() : location.assign('/')">后退</button>
        <a href="/">返回首页</a>
      </div>
    </article>
  `;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${pageStyles()}</style>
</head>
${bodyShell(body)}
</html>`;
}

function bodyShell(body, { theme = "theme-6", homeWidget = null } = {}) {
  return `<body class="${themeClass(theme)}">
  ${body}
  ${homeWidgetMarkup(homeWidget)}
</body>`;
}

function pageStyles() {
  return `
    :root {
      --oklch-theme-1: 0.9802 0.0074 151.89;
      --oklch-theme-2: 0.9822 0.0118 313.22;
      --oklch-theme-3: 0.9856 0.0084 56.32;
      --oklch-theme-4: 0.9808 0.0091 258.34;
      --oklch-theme-5: 0.9727 0.0119 17.36;
      --oklch-theme-6: 0.9731 0 0;
      --page: oklch(var(--oklch-theme-6));
      --sheet: #ffffff;
      --ink: #27241f;
      --ink-soft: #7b7568;
      --line: #e4dfd3;
      --accent: oklch(0.5687 0.1602 254.1);
      --font-sans: Inter, "Noto Sans CJK SC", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-serif: "Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", Georgia, serif;
      --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      --shadow: 0 14px 40px rgba(36, 31, 23, 0.08);
      --prose-size: 17px;
      --h1-size: 34px;
      --h2-size: 27px;
      --h3-size: 22px;
    }
    body.homepage-theme-1 { --page: oklch(var(--oklch-theme-1)); }
    body.homepage-theme-2 { --page: oklch(var(--oklch-theme-2)); }
    body.homepage-theme-3 { --page: oklch(var(--oklch-theme-3)); }
    body.homepage-theme-4 { --page: oklch(var(--oklch-theme-4)); }
    body.homepage-theme-5 { --page: oklch(var(--oklch-theme-5)); }
    body.homepage-theme-6 { --page: oklch(var(--oklch-theme-6)); }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--page);
      color: var(--ink);
      font-family: var(--font-sans);
    }
    .doc-read {
      width: min(1080px, calc(100% - 40px));
      margin: 32px auto;
      padding: 52px 64px 68px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--sheet);
      box-shadow: var(--shadow);
    }
    .prose { color: var(--ink); font-size: var(--prose-size); line-height: 1.76; }
    .prose-empty { color: var(--ink-soft); }
    .prose > :first-child { margin-top: 0; }
    .prose h1, .prose h2, .prose h3 { font-family: var(--font-serif); }
    .prose h1 { font-size: var(--h1-size); font-weight: 700; letter-spacing: 0; margin: 1.35em 0 0.55em; }
    .prose h2 { font-size: var(--h2-size); font-weight: 700; letter-spacing: 0; margin: 1.3em 0 0.5em; padding-bottom: 0.2em; border-bottom: 1px solid var(--line); }
    .prose h3 { font-size: var(--h3-size); font-weight: 700; letter-spacing: 0; margin: 1.2em 0 0.4em; }
    .prose p { margin: 0.7em 0; }
    .prose ul, .prose ol { margin: 0.7em 0; padding-left: 1.5em; }
    .prose li { margin: 0.25em 0; }
    .prose li input[type="checkbox"] { margin-right: 0.5em; }
    .prose a { color: var(--accent); text-decoration: none; }
    .prose a:hover { text-decoration: none; color: oklch(0.5083 0.1809 257.7); }
    .prose code { background: #f1f0ea; border-radius: 5px; padding: 1px 6px; font-size: 0.88em; font-family: var(--font-mono); }
    .prose pre { background: #2b2a27; color: #f5f3ee; border-radius: 10px; padding: 14px 16px; overflow-x: auto; line-height: 1.55; }
    .prose pre code { background: transparent; padding: 0; color: inherit; }
    .prose .hljs-comment, .prose .hljs-quote { color: #8a857b; font-style: italic; }
    .prose .hljs-keyword, .prose .hljs-selector-tag, .prose .hljs-literal, .prose .hljs-doctag { color: #e29ec0; }
    .prose .hljs-string, .prose .hljs-meta-string, .prose .hljs-regexp { color: #a8c98a; }
    .prose .hljs-number, .prose .hljs-bullet { color: #e0b07a; }
    .prose .hljs-title, .prose .hljs-title.function_, .prose .hljs-section { color: #8cc2ee; }
    .prose .hljs-built_in, .prose .hljs-type, .prose .hljs-class .hljs-title { color: #7fd0c0; }
    .prose .hljs-attr, .prose .hljs-attribute, .prose .hljs-property, .prose .hljs-variable { color: #e0b07a; }
    .prose .hljs-tag, .prose .hljs-name, .prose .hljs-selector-id, .prose .hljs-selector-class { color: #e29ec0; }
    .prose .hljs-symbol, .prose .hljs-link { color: #7fd0c0; }
    .prose .hljs-meta { color: #8a857b; }
    .prose .hljs-emphasis { font-style: italic; }
    .prose .hljs-strong { font-weight: 700; }
    .prose .hljs-addition { color: #a8c98a; }
    .prose .hljs-deletion { color: #e08a86; }
    .prose blockquote { margin: 0.9em 0; padding: 2px 16px; border-left: 3px solid var(--line); color: var(--ink-soft); }
    .prose table { border-collapse: collapse; margin: 0.9em 0; display: block; overflow-x: auto; }
    .prose th, .prose td { border: 1px solid var(--line); padding: 7px 12px; text-align: left; }
    .prose th { background: #faf9f5; font-weight: 700; }
    .prose img { max-width: 100%; border-radius: 8px; }
    .prose hr { border: none; border-top: 1px solid var(--line); margin: 1.4em 0; }
    .not-found {
      min-height: 420px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .not-found-kicker {
      margin: 0 0 12px;
      color: var(--accent);
      font: 800 13px/1 var(--font-sans);
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .not-found h1 {
      margin: 0 0 14px;
      color: var(--ink);
      font: 700 38px/1.18 var(--font-serif);
      letter-spacing: 0;
    }
    .not-found p {
      max-width: 560px;
      margin: 0;
      color: var(--ink-soft);
      font-size: 17px;
      line-height: 1.75;
    }
    .not-found-path {
      margin-top: 22px !important;
      padding: 11px 13px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #faf9f5;
      color: var(--ink);
      font-family: var(--font-mono);
      font-size: 13px !important;
      word-break: break-all;
    }
    .not-found-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 28px;
    }
    .not-found-actions button,
    .not-found-actions a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font: 600 14px/1 var(--font-sans);
      text-decoration: none;
      padding: 0 14px;
      cursor: pointer;
    }
    .not-found-actions button:hover,
    .not-found-actions a:hover {
      background: #f1f0ea;
    }
    @media (max-width: 720px) {
      .doc-read {
        width: 100%;
        min-height: 100vh;
        margin: 0;
        border: none;
        border-radius: 0;
        padding: 28px 20px 44px;
      }
      :root {
        --prose-size: 16px;
        --h1-size: 30px;
        --h2-size: 24px;
        --h3-size: 20px;
      }
      .not-found h1 { font-size: 32px; }
    }
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function themeClass(theme) {
  const value = String(theme || "").trim().toLowerCase();
  return /^theme-[1-6]$/.test(value) ? `homepage-${value}` : "homepage-theme-6";
}
