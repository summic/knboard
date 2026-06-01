import { useEffect, useState } from "react";
import { api, type CliToken } from "./api";

export type HelpDocId = "usage" | "cli" | "skills";

const HELP_DOCS: { id: HelpDocId; label: string; title: string; kicker: string }[] = [
  { id: "usage", label: "使用说明", title: "欢迎使用 KN Box", kicker: "KN Box 使用说明" },
  { id: "cli", label: "KnBox CLI", title: "KN Box CLI 使用方式", kicker: "命令行工具" },
  { id: "skills", label: "Skills", title: "给 AI 助手使用 KN Box", kicker: "AI 助手" },
];

export function Help({ doc = "usage" }: { doc?: HelpDocId }) {
  const current = HELP_DOCS.find((item) => item.id === doc) ?? HELP_DOCS[0];

  return (
    <article className="help-doc">
      <header className="help-hero">
        <p className="help-kicker">{current.kicker}</p>
        <h1>{current.title}</h1>
        {doc === "usage" && (
          <p>
            KN Box 是一个文件预览服务。你可以把 Markdown 文档、网页文件和图片上传到这里，
            然后得到一个可以直接访问和分享的链接。
          </p>
        )}
        {doc === "cli" && (
          <p>
            KN Box CLI 是命令行工具。你可以在终端里上传文件、查看目录，并拿到可以直接访问的预览地址。
          </p>
        )}
        {doc === "skills" && (
          <p>
            Skills 是给 AI 助手使用的说明文件。安装后，AI 助手就知道怎样调用 KN Box CLI 上传文件并返回链接。
          </p>
        )}
      </header>

      {doc === "usage" && <UsageDoc />}
      {doc === "cli" && <CliDoc />}
      {doc === "skills" && <SkillsDoc />}
    </article>
  );
}

function UsageDoc() {
  return (
    <>
      <section className="help-notice">
        <h2>使用前请先了解</h2>
        <p>
          KN Box 只供公司内网访问，用于临时预览和分享文件，不承诺存储可靠性，也不作为长期存储使用。
        </p>
        <p>使用时请遵守公司安全制度，不要上传或分享敏感信息。</p>
      </section>

      <section>
        <h2>快速开始</h2>
        <ol>
          <li>登录 KN Box。</li>
          <li>点击右上角“上传”，选择文件或文件夹。</li>
          <li>上传完成后，在“首页”里找到它。</li>
          <li>打开预览，复制链接，发给需要查看的人。</li>
        </ol>
      </section>

      <section>
        <h2>可以上传什么</h2>
        <p>你可以上传 Markdown 文档、网页文件和图片文件。单个文件大小限制是 10 MB。</p>
        <p>Markdown 文件会自动渲染成阅读页面。图片可以直接预览和分享。</p>
        <p>如果上传的是一个完整的小网页，KN Box 会保留目录结构，所以网页里的相对路径仍然可以正常工作。</p>
      </section>

      <section>
        <h2>上传网页项目</h2>
        <p>
          网页项目建议包含入口文件 <code>index.html</code> 或 <code>index.htm</code>。
        </p>
        <pre><code>{`my-page/
  index.html
  style.css
  images/
    cover.png`}</code></pre>
        <p>上传后，你可以通过类似下面的地址访问：</p>
        <pre><code>{`/u/yourname/my-page/index.html`}</code></pre>
        <p>
          如果访问的是目录，KN Box 会优先查找该目录下的 <code>index.html</code>，其次查找 <code>index.htm</code>。
          如果两个入口文件都不存在，会提示不允许浏览目录。
        </p>
      </section>

      <section>
        <h2>文件管理</h2>
        <p>你可以按照自己的习惯创建文件夹。KN Box 会从你的个人根目录开始展示文件和目录。</p>
        <p>如果你正在某个文件夹里上传，文件会进入当前文件夹。上传目录结构会被保留，不会统一打散到根目录。</p>
        <p>左侧的“网页”“图片”“其他”是文件类型筛选，不是固定目录。你的文件实际仍然保存在自己的个人空间里。</p>
      </section>

      <section>
        <h2>预览和分享</h2>
        <p>点击文件可以选中，打开预览后可以复制链接，也可以在新窗口打开。</p>
        <p>Markdown 会用 KN Box 的阅读页面渲染。网页文件会直接输出，图片会直接显示。</p>
      </section>

      <section>
        <h2>回收站</h2>
        <p>删除文件或目录后，它们会先进入回收站。删除目录时，会递归删除该目录下的所有文件。</p>
        <p>为了避免误删，删除前需要在确认窗口里输入要删除的文件名或目录名。</p>
        <p>你可以在左侧“回收站”里查看已删除项目，包括原位置、删除时间和大小，也可以把它们恢复到原来的位置。</p>
      </section>

      <section>
        <h2>使用建议</h2>
        <p>如果你上传网页项目，请尽量保持清晰的目录结构。</p>
        <p>
          文件夹和文件名建议使用英文、数字和短横线，尽量不要使用中文或其他全角符号。
          这类字符会让分享地址不易阅读，在部分聊天软件中还可能被截断。
        </p>
        <p>如果你要分享给别人，建议使用简短、可读的文件夹名称，比如：</p>
        <pre><code>{`team-guide/
product-demo/
event-page/`}</code></pre>
        <p>如果只是写说明文档，Markdown 是最简单的方式。</p>
      </section>
    </>
  );
}

function CliDoc() {
  return (
    <>
      <CliTokenPanel />

      <section>
          <h2>登录</h2>
          <p>
            第一次使用 CLI 时先登录。默认连接 <code>box.beforeve.com</code>。命令会打开浏览器，
            完成登录后，CLI 会在本机保存凭证。
        </p>
        <pre><code>{`knbox auth login
knbox auth whoami`}</code></pre>
        <p>如果不能打开浏览器登录，也可以在本页签发 Token，然后设置 <code>KNBOX_TOKEN</code>。</p>
      </section>

      <section>
          <h2>单独安装 CLI</h2>
          <p>
          如果你只需要命令行工具，可以单独安装 CLI，不需要安装完整的 KN Box 服务端。
        </p>
        <pre><code>{`npm install -g github:summic/knbox-cli
knbox auth login`}</code></pre>
      </section>

      <section>
        <h2>浏览文件</h2>
        <p>
          <code>ls</code> 用于列出目录，<code>cd</code> 会记住远程目录，之后的上传和打开命令会以这个目录为默认位置。
        </p>
        <pre><code>{`knbox ls
knbox cd /team-guide
knbox ls`}</code></pre>
      </section>

      <section>
        <h2>打开文件或目录</h2>
        <p>
          打开文件时，CLI 会输出最终可访问的预览地址。打开目录时，CLI 会列出目录内容。
        </p>
        <pre><code>{`knbox open /team-guide/index.html
knbox open /team-guide --json`}</code></pre>
      </section>

      <section>
        <h2>上传文件</h2>
        <p>
          上传文件或目录后，CLI 会返回每个文件的地址。如果目录里有 <code>index.html</code> 或 <code>index.htm</code>，
          还会返回目录入口地址。
        </p>
        <pre><code>{`knbox upload ./site --to /demo --json
knbox upload ./note.md --rename --json`}</code></pre>
        <p>
          默认遇到同名文件会报错。需要自动改名时使用 <code>--rename</code>，需要覆盖时使用 <code>--overwrite</code>。
        </p>
      </section>

      <section>
        <h2>给自动化工具使用</h2>
        <p>
          如果你把 CLI 交给自动化工具使用，建议加上 <code>--json</code>。这样工具可以稳定读取上传结果和链接。
        </p>
        <pre><code>{`knbox commands --json
knbox upload ./site --json
knbox open /demo/site/index.html --json`}</code></pre>
        <p>
          如果只需要原始数据，可以使用 <code>--json --quiet</code>。
        </p>
      </section>
    </>
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
            Token 可以让 CLI 在不打开浏览器的情况下访问你的 KN Box。每个账号只能保留一个 CLI Token；
            签发新的 Token 会让旧 Token 立即失效。Token 明文只会在签发后显示一次。
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

function SkillsDoc() {
  return (
    <>
      <section>
        <h2>什么是 Skills</h2>
        <p>
          Skills 是给 AI 助手看的使用说明。它不会替代 KN Box，也不会保存你的文件；
          它只是告诉 AI 助手应该怎样调用 <code>knbox</code> 命令。
        </p>
        <p>
          安装后，你可以让 AI 助手把生成的网页、Markdown 或图片上传到 KN Box，然后把预览地址发给你。
        </p>
      </section>

      <section>
        <h2>安装前准备</h2>
        <p>先确认本机已经可以使用 KN Box CLI：</p>
        <pre><code>{`knbox auth whoami --json`}</code></pre>
        <p>
          如果还没有登录，可以运行 <code>knbox auth login</code>。如果是在无法打开浏览器的环境里，
          可以在 KN Box 的 CLI 页面签发 Token，并设置 <code>KNBOX_TOKEN</code>。
          服务地址默认已经是 <code>https://box.beforeve.com</code>，通常不需要设置 <code>KNBOX_URL</code>。
        </p>
      </section>

      <section>
        <h2>安装 CLI</h2>
        <p>如果还没有安装命令行工具，可以从 GitHub 安装：</p>
        <pre><code>{`npm install -g github:summic/knbox-cli`}</code></pre>
        <p>安装后验证：</p>
        <pre><code>{`knbox --help
knbox commands --json`}</code></pre>
      </section>

      <section>
        <h2>使用 Token</h2>
        <p>
          如果你希望 AI 助手在后台使用 KN Box，可以在 CLI 页面签发一个 Token。
          每次重新签发都会覆盖旧 Token。默认服务地址已经写好，只需要配置 Token。
        </p>
        <pre><code>{`export KNBOX_TOKEN=knbox_xxx
knbox auth whoami --json`}</code></pre>
      </section>

      <section>
        <h2>安装 Skill</h2>
        <p>
          用 skills installer 安装 KN Box Skill：
        </p>
        <pre><code>{`npx skills add summic/knbox-skills`}</code></pre>
        <p>如果你使用的 AI 工具需要指定类型，可以这样写：</p>
        <pre><code>{`npx skills add summic/knbox-skills -a codex
npx skills add summic/knbox-skills -a claude-code`}</code></pre>
        <p>安装后可以查看列表确认：</p>
        <pre><code>{`npx skills list
# 应该能看到 knbox`}</code></pre>
      </section>

      <section>
        <h2>验证上传</h2>
        <p>
          安装完成后，可以用一个小目录试一下上传流程：
        </p>
        <pre><code>{`knbox upload ./output-site --to /agent-output --json
knbox open /agent-output/output-site --json`}</code></pre>
        <p>
          上传成功后，返回结果里会包含可以访问的 URL。
        </p>
      </section>

      <section>
        <h2>Skill 会做什么</h2>
        <ul>
          <li>需要上传文件时，它会调用 <code>knbox upload</code>。</li>
          <li>需要查看目录时，它会调用 <code>knbox ls</code>。</li>
          <li>需要打开文件时，它会调用 <code>knbox open</code> 并读取返回的链接。</li>
          <li>如果命令失败，它应该把错误原因告诉你，而不是假装上传成功。</li>
        </ul>
      </section>

      <section>
        <h2>手动安装</h2>
        <p>如果 skills installer 不可用，也可以手动安装：</p>
        <pre><code>{`git clone https://github.com/summic/knbox-skills ~/.knbox-skills
mkdir -p ~/.codex/skills
ln -sfn ~/.knbox-skills/skills/knbox ~/.codex/skills/knbox`}</code></pre>
        <p>
          更新时进入 <code>~/.knbox-skills</code> 执行 <code>git pull</code>。软链接会直接使用最新内容。
        </p>
      </section>
    </>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}
