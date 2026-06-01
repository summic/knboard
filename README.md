# KN Box

KN Box 是一个面向公司内部使用的文档和静态网页托管服务。用户登录后可以上传 Markdown、HTML 网页、图片以及相关静态资源，系统会生成可访问的预览链接，用于在内网中快速分享和浏览。

它不再定位为可被其他项目引用的模块，而是一个可以独立部署的服务：后端、网页界面、SQLite 数据库、上传文件存储和命令行工具都围绕这个服务展开。

## 主要能力

- 提供 Express 服务端和 React 网页界面
- 通过 KYLITH SSO 登录，使用 HTTP-only Cookie 保存登录态
- 登录会话写入 SQLite，服务重启后不会踢掉已登录用户
- 每个用户拥有独立的个人目录，存储目录按用户 ID 隔离，访问路径为 `/u/user-<id>/<path>`
- 支持上传 Markdown、网页文件和图片文件，单文件最大 10 MB
- 默认用户容量配额为 1 GB，并限制上传目录深度、单批文件数和单批总大小
- 上传文件夹时保留目录结构，自动忽略隐藏文件、隐藏目录和 `.DS_Store`
- HTML 文件直接输出，Markdown 文件由 KN Box 渲染为阅读页
- 目录访问时，如果目录下有 `index.html` 或 `index.htm`，会直接渲染该首页
- 支持软删除和回收站，删除目录会递归删除目录下的内容，回收站项目可以恢复到原位置
- 提供 CLI Token，用于命令行工具和 Agent 集成
- 提供 `knbox` 命令行工具，便于从终端上传文件并获取链接

## 快速开始

```bash
npm install
npm run dev
```

开发模式会启动 Vite 和 Node 服务。默认访问地址：

```text
http://localhost:5173
```

如果只启动服务端：

```bash
node bin/knbox.js serve --port 6789
```

访问：

```text
http://localhost:6789
```

## 生产部署

先构建前端资源：

```bash
npm install
npm run build
```

再启动服务：

```bash
KNBOX_DATA_DIR=/var/lib/knbox npm start
```

生产环境必须把数据目录放在应用代码目录之外。发布代码时不要覆盖远程的数据目录，尤其不要用本地开发环境的 `data/` 覆盖生产环境的 SQLite 和用户上传文件。

仓库已经忽略本地运行数据：

```text
data/
```

生产环境通常需要配置：

```bash
export PORT=6789
export KNBOX_DATA_DIR=/var/lib/knbox
export KNBOX_SESSION_SECRET='change-this-session-secret'
export KNBOX_PUBLIC_URL='https://box.beforeve.com'
export KNBOX_FILES_PUBLIC_URL='https://b.beforeve.com'
export KNBOX_USER_QUOTA_BYTES=1073741824
```

生产环境使用两个域名：`box.beforeve.com` 用于应用和登录，`b.beforeve.com` 只用于公开上传文件。详细部署说明见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 数据目录

KN Box 的运行数据默认放在 `KNBOX_DATA_DIR` 下：

```text
data/
  knbox.sqlite
  knbox.sqlite-wal
  knbox.sqlite-shm
  tmp/
    uploads/
  users/
    user-1/
      index.html
      guide.md
      assets/
        hero.svg
```

其中：

- `knbox.sqlite` 保存用户、会话、CLI Token、文件记录、软删除状态等信息
- `users/user-<id>/` 保存用户上传的真实文件，避免同名账号或邮箱前缀撞目录
- `tmp/uploads/` 用于上传过程中的临时文件

## KYLITH SSO

KN Box 使用 KYLITH 作为 OIDC 登录入口。应用自己的会话、CLI Token、文件归属和存储统计仍然保存在 KN Box 内。

推荐使用 KYLITH Web Client 凭据文件：

```bash
export KNBOX_KYLITH_ISSUER=https://id.kylith.com
export KNBOX_KYLITH_CREDENTIALS_FILE=/path/to/Web-credentials.json
export KNBOX_PUBLIC_URL=http://localhost:6789
```

也可以直接配置 Client ID 和 Client Secret：

```bash
export KNBOX_KYLITH_CLIENT_ID='...'
export KNBOX_KYLITH_CLIENT_SECRET='...'
```

KYLITH 后台登记的回调地址必须和服务地址完全一致：

```text
<KNBOX_PUBLIC_URL>/auth/callback
```

例如：

```text
http://localhost:6789/auth/callback
```

服务端需要能够访问 `KNBOX_KYLITH_ISSUER`，以便加载 OIDC discovery document 和 JWKS。

## 命令行工具

KN Box 提供 `knbox` CLI。默认服务地址是：

```text
https://box.beforeve.com
```

常用命令：

```text
knbox login                         登录 KN Box
knbox logout                        退出登录
knbox whoami --json                 查看当前用户
knbox ls [path] --json              列出远程目录
knbox cd <path>                     切换默认远程目录
knbox open [path]                   输出文件访问链接
knbox upload <file-or-dir>          上传文件或目录
knbox upload <file-or-dir> --to dir 上传到指定目录
```

CLI 本地状态默认保存在：

```text
~/.config/knbox/config.json
```

Agent 或脚本中可以使用网页端签发的 Token：

```bash
export KNBOX_TOKEN='...'
```

只有连接非默认服务时才需要额外指定：

```bash
export KNBOX_URL='https://your-knbox.example.com'
```

所有面向 Agent 的命令都支持 `--json`，便于脚本读取结构化结果。

CLI 上传目录时会跳过符号链接、隐藏文件和隐藏目录；只会上传支持的 Markdown、网页和图片文件，并在本地限制目录深度、文件数量、单文件大小和单批总大小。

## Docker

```bash
docker build -t knbox .
docker run --rm \
  -p 6789:6789 \
  -v "$PWD/data:/data" \
  -e KNBOX_DATA_DIR=/data \
  -e KNBOX_SESSION_SECRET='change-this-session-secret' \
  -e KNBOX_PUBLIC_URL='http://localhost:6789' \
  -e KNBOX_FILES_PUBLIC_URL='http://localhost:6789' \
  knbox
```

打开：

```text
http://localhost:6789
```

实际生产部署时，建议使用稳定的宿主机目录或持久化卷挂载到 `/data`。

## 开发命令

```bash
npm install
npm run dev
npm run check
npm run build
```

服务端入口：

```text
src/server/index.js
```

网页入口：

```text
src/web/main.tsx
```

CLI 入口：

```text
src/cli/index.js
```

## 安全与存储说明

KN Box 是文件预览服务，主要用于公司内网中的临时分享和查看。它不是长期归档系统，也不承诺上传文件的长期可靠存储。

请遵守公司安全制度，不要上传或分享敏感信息。文件名建议使用英文、数字、短横线和下划线，尽量避免中文、空格和全角符号，以免分享链接在聊天软件中变得不易读或被截断。

## License

MIT
