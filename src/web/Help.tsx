import { useEffect, useState } from "react";
import { api, type CliToken } from "./api";

export type HelpDocId = "usage" | "cli" | "skills";

const HELP_DOCS: { id: HelpDocId; label: string; title: string; kicker: string }[] = [
  { id: "usage", label: "使用说明", title: "欢迎使用 KN Box", kicker: "KN Box 使用说明" },
  { id: "cli", label: "KnBox CLI", title: "KN Box CLI 使用方式", kicker: "命令行工具" },
  { id: "skills", label: "Skills", title: "给 AI 助手使用 KN Box", kicker: "AI 助手" },
];

const CLI_AGENT_BRIEF = `请帮我配置 KN Box CLI，并按这个顺序操作：
1. 先安装 CLI：npm install -g github:summic/knbox-cli
2. 打开 KN Box 的“KnBox CLI”页面，让我点击“签发 Token”。
3. 我把 Token 复制给你后，请把它配置给客户端：
   export KNBOX_URL=https://box.beforeve.com
   export KNBOX_TOKEN=<我复制给你的 Token>
4. 验证登录：knbox auth whoami --json
5. 以后我说“把 README.md 上传到 TeamBox”，请用 knbox upload ./README.md --json 上传，并把返回链接发给我。`;

const CLI_TOKEN_ENV = `export KNBOX_URL=https://box.beforeve.com
export KNBOX_TOKEN=<粘贴刚签发的 Token>
knbox auth whoami --json`;

const CLI_AGENT_EXAMPLES = `把 README.md 上传到 TeamBox，并把链接发给我。
把 dist 目录上传到 TeamBox 的 /demo 目录，并返回入口链接。`;

const SKILLS_AGENT_BRIEF = `请帮我安装 KN Box Skill：
1. 确认 KN Box CLI 已安装；如果我自己在电脑上使用，先运行 knbox auth login 完成网页登录。
2. 如果是 Agent 登录或后台脚本使用，请让我在 KN Box 的“KnBox CLI”页面签发 Token，并把 KNBOX_TOKEN 配到客户端。
3. 安装 Skill：npx skills add summic/knbox-skills
4. 验证：knbox commands --json
5. 安装完以后，我说“把 README.md 上传到 TeamBox”，你就用 KN Box CLI 上传，并把链接发给我。`;

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

function CopySnippet({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    let didCopy = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        didCopy = true;
      }
    } catch {
      didCopy = false;
    }
    if (!didCopy) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      didCopy = document.execCommand("copy");
      textarea.remove();
    }
    if (!didCopy) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="help-copy">
      <div className="help-copy-head">
        <strong>{title}</strong>
        <button type="button" onClick={copy}>{copied ? "已复制" : "复制"}</button>
      </div>
      <pre><code>{text}</code></pre>
    </div>
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
        <p>点击文件会打开预览。需要选择删除时，请勾选文件或文件夹右上角的选择框。</p>
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
      <section className="help-notice">
        <h2>太长不看</h2>
        <p>
          把下面这段贴给你的 AI Agent，例如 Codex、Claude.md、OpenCode。它会替你按顺序完成安装、
          让你签发 Token，并把 Token 配给客户端。
        </p>
        <CopySnippet title="复制给 AI Agent" text={CLI_AGENT_BRIEF} />
      </section>

      <section>
        <h2>1. 安装 CLI</h2>
        <p>
          如果你只需要命令行工具，可以单独安装 CLI，不需要安装完整的 KN Box 服务端。
        </p>
        <pre><code>{`npm install -g github:summic/knbox-cli
knbox --help`}</code></pre>
      </section>

      <section>
        <h2>2. 登录方式：网页登录或 Agent Token</h2>
        <p>
          如果是你自己在电脑上使用，运行 <code>knbox auth login</code>。它会打开网页登录，
          完成后 CLI 会在本机保存凭证。
        </p>
        <pre><code>{`knbox auth login
knbox auth whoami --json`}</code></pre>
        <p>
          如果是 Agent 登录、脚本或无法打开浏览器的环境，才需要在下一步签发 Token，
          然后把 <code>KNBOX_TOKEN</code> 给客户端使用。
        </p>
      </section>

      <CliTokenPanel />

      <section>
        <h2>4. 把 Token 给客户端</h2>
        <p>
          Token 只会显示一次。复制后，把下面两行交给 AI Agent 或写到运行脚本的环境变量里。
        </p>
        <CopySnippet title="复制客户端配置" text={CLI_TOKEN_ENV} />
      </section>

      <section>
        <h2>5. 浏览文件</h2>
        <p>
          <code>ls</code> 用于列出目录，<code>cd</code> 会记住远程目录，之后的上传和打开命令会以这个目录为默认位置。
        </p>
        <pre><code>{`knbox ls
knbox cd /team-guide
knbox ls`}</code></pre>
      </section>

      <section>
        <h2>6. 打开文件或目录</h2>
        <p>
          打开文件时，CLI 会输出最终可访问的预览地址。打开目录时，CLI 会列出目录内容。
        </p>
        <pre><code>{`knbox open /team-guide/index.html
knbox open /team-guide --json`}</code></pre>
      </section>

      <section>
        <h2>7. 上传文件</h2>
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
        <h2>8. 给 AI Agent 使用</h2>
        <p>
          如果你把 CLI 交给自动化工具使用，建议加上 <code>--json</code>。这样工具可以稳定读取上传结果和链接。
        </p>
        <pre><code>{`knbox commands --json
knbox upload ./site --json
knbox open /demo/site/index.html --json`}</code></pre>
        <p>
          如果只需要原始数据，可以使用 <code>--json --quiet</code>。
        </p>
        <CopySnippet title="可以直接这样对 Agent 说" text={CLI_AGENT_EXAMPLES} />
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
          <h2>3. 签发 Token</h2>
          <p>
            Token 是给 AI Agent、脚本或无法打开浏览器的环境使用的。你自己在电脑上使用时，
            优先用上面的 <code>knbox auth login</code> 网页登录。每个账号只能保留一个 CLI Token；
            重新签发会让旧 Token 立即失效。
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
      <section className="help-notice">
        <h2>太长不看</h2>
        <p>把下面这段交给 AI Agent 就可以了。</p>
        <CopySnippet title="复制给 AI Agent" text={SKILLS_AGENT_BRIEF} />
      </section>

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
        <h2>1. 先安装 CLI</h2>
        <p>如果还没有安装命令行工具，先从 GitHub 安装：</p>
        <pre><code>{`npm install -g github:summic/knbox-cli
knbox --help`}</code></pre>
      </section>

      <section>
        <h2>2. 登录方式：网页登录或 Agent Token</h2>
        <p>
          你自己在电脑上使用时，运行 <code>knbox auth login</code> 完成网页登录：
        </p>
        <pre><code>{`knbox auth login
knbox auth whoami --json`}</code></pre>
        <p>
          如果是 Agent 登录或无法打开浏览器的环境，让 Agent 打开“KnBox CLI”页面，引导你签发 Token，
          然后把 <code>KNBOX_TOKEN</code> 配给客户端。
        </p>
      </section>

      <section>
        <h2>3. 安装 Skill</h2>
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
        <h2>4. 安装后怎么用</h2>
        <p>
          安装完成后，你只要把任务交给 AI Agent，例如：
        </p>
        <CopySnippet title="复制这句话试用" text="把 README.md 上传到 TeamBox，并把链接发给我。" />
      </section>

      <section>
        <h2>5. 验证上传</h2>
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
