import { useEffect, useState } from "react";
import { api, type CliToken } from "./api";
import { absoluteUrl } from "./url";

export function Help() {
  return (
    <article className="help-doc">
      <header className="help-hero">
        <p className="help-kicker">KN Box 使用说明</p>
        <h1>使用说明</h1>
        <p>
          KN Box 用于在公司内网预览和分享 Markdown、HTML 静态网页和图片。
        </p>
      </header>

      <UsageDoc />
    </article>
  );
}

function UsageDoc() {
  return (
    <>
      <section className="help-notice">
        <h2>安全边界</h2>
        <ul>
          <li>KN Box 仅供公司内网使用。</li>
          <li>不要上传或分享内部敏感信息。</li>
          <li>它适合临时预览和分享，不作为长期存储。</li>
        </ul>
      </section>

      <section>
        <h2>上传文件</h2>
        <ol>
          <li>登录 KN Box。</li>
          <li>点击右上角“上传”。</li>
          <li>选择 Markdown、HTML 静态网页或图片。</li>
          <li>上传完成后打开预览，复制链接。</li>
        </ol>
        <p>单个文件最大 10 MB。删除后的文件会进入回收站，可恢复。</p>
      </section>

      <section>
        <h2>上传网页目录</h2>
        <p>如果上传一个网页目录，目录里需要有入口文件 <code>index.html</code> 或 <code>index.htm</code>。</p>
        <pre><code>{`my-page/
  index.html
  style.css
  images/
    cover.png`}</code></pre>
        <p>KN Box 会保留目录结构。访问目录时，只会打开入口文件；不会展示目录列表。</p>
      </section>

      <section>
        <h2>个人主页</h2>
        <p>每个用户都有自己的个人主页。</p>
        <HomepageAddress />
        <p>没有上传根目录 <code>index.html</code> 或 <code>index.htm</code> 时，KN Box 会使用系统主页，展示你设置为公开的 Markdown 和网页。</p>
        <p>系统主页可以设置主页名称、简介、标题字体和主题。标题字体包括宋体、Georgia、旧体、楷体；主题包括青绿、淡紫、米白、浅蓝、暖粉、中性。</p>
        <p>如果想使用自定义主页，把 <code>index.html</code> 或 <code>index.htm</code> 上传到个人根目录即可。页面中的资源应使用站内路径引用。</p>
      </section>

      <section>
        <h2>什么时候需要 Token</h2>
        <p>
          只有 AI 助手或 CLI 无法打开浏览器登录时，才需要签发 CLI Token。
          Token 必须由你在本页手动签发，AI 助手不能替你创建 Token。
        </p>
        <p>
          签发后，把 Token 配到运行 AI 助手或脚本的环境里。重新签发会立即废止旧 Token。
        </p>
      </section>

      <CliTokenPanel />

      <section>
        <h2>命令行工具</h2>
        <p>需要在终端中手动上传时，可以安装 CLI：</p>
        <pre><code>{`npm install -g github:summic/knbox-cli
knbox auth login
knbox upload ./site --json
knbox open /site/index.html --json`}</code></pre>
      </section>

      <section>
        <h2>给 AI Agent 使用</h2>
        <p>把下面两行复制发给 Codex 或 Claude：</p>
        <pre><code>{`帮我安装 KN Box Skills
npx skills add summic/knbox-skills`}</code></pre>
        <p>完成授权后，可以直接对 AI 助手说：“把 xxx 文件上传到 KN Box。”它会上传文件，并把访问链接发给你。</p>
      </section>
    </>
  );
}

function HomepageAddress() {
  const [homepageUrl, setHomepageUrl] = useState("");

  useEffect(() => {
    let canceled = false;
    api
      .homepageSettings()
      .then((result) => {
        if (!canceled) setHomepageUrl(absoluteUrl(result.homepageUrl));
      })
      .catch(() => {
        if (!canceled) setHomepageUrl("");
      });
    return () => {
      canceled = true;
    };
  }, []);

  if (!homepageUrl) return null;

  return (
    <p>
      当前主页地址：<a href={homepageUrl} target="_blank" rel="noreferrer">{homepageUrl}</a>
    </p>
  );
}

function CliTokenPanel() {
  const [tokens, setTokens] = useState<CliToken[]>([]);
  const [issuedToken, setIssuedToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api.cliTokens()
      .then((result) => setTokens(result.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Token 列表加载失败"));
  };

  useEffect(() => {
    refresh();
  }, []);

  const issue = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const result = await api.issueCliToken("KN Box CLI");
      setIssuedToken(result.token);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Token 签发失败");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!issuedToken) return;
    await navigator.clipboard?.writeText(issuedToken);
    setCopied(true);
  };

  const revoke = async (id: string) => {
    setError(null);
    try {
      await api.revokeCliToken(id);
      setTokens((items) => items.filter((item) => item.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Token 撤销失败");
    }
  };

  return (
    <section className="cli-token-panel">
      <div className="cli-token-head">
        <div>
          <h2>签发 CLI Token</h2>
          <p>
            仅在无法使用浏览器 OAuth 登录时使用。Token 明文只显示一次，请妥善保存。
          </p>
        </div>
        <button className="btn-primary" onClick={issue} disabled={busy}>
          {busy ? "签发中" : tokens.length ? "重新签发 Token" : "签发 Token"}
        </button>
      </div>

      {issuedToken && (
        <div className="cli-token-issued">
          <div>
            <span>新的 Token，旧 Token 已失效</span>
            <code>{issuedToken}</code>
          </div>
          <button onClick={copy}>{copied ? "已复制" : "复制"}</button>
        </div>
      )}

      {error && <div className="cli-token-error">{error}</div>}

      <div className="cli-token-list">
        {tokens.length ? (
          tokens.map((token) => (
            <div className="cli-token-row" key={token.id}>
              <div>
                <strong>{token.name}</strong>
                <span>
                  当前有效，签发于 {formatDate(token.createdAt)}
                  {token.lastUsedAt ? `，最近使用 ${formatDate(token.lastUsedAt)}` : ""}
                </span>
              </div>
              <button onClick={() => revoke(token.id)}>撤销</button>
            </div>
          ))
        ) : (
          <p className="cli-token-empty">还没有签发过 CLI Token。</p>
        )}
      </div>
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}
