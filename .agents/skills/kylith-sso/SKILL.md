---
name: kylith-sso
description: 帮助开发者快速接入 Kylith SSO 单点登录。用于：(1) 生成 OAuth 登录按钮组件 (2) 配置任意框架的 SSO 集成 (3) 处理 OAuth 回调和 Token 管理。当用户需要"接入SSO"、"添加Kylith登录"、"集成OAuth"、"添加第三方登录"、"接入单点登录"时触发此skill。
metadata:
  author: kylith
  version: "1.0.0"
---
# Kylith SSO 接入助手

帮助开发者将 Kylith SSO 单点登录快速集成到任意应用中。

## 前置条件

在开始前，确认用户已准备好：

1. **client_id** - 在 Kylith 开发者控制台创建的客户端 ID
2. **client_secret** - 客户端密钥（单页面应用 SPA 和移动端应用不需要，使用 PKCE 代替）。Kylith 创建的客户端默认使用 `client_secret_post` 认证方式
3. **redirect_uri** - 已在控制台注册的回调地址

如用户未提供，提示其先到开发者控制台 [console.kylith.com](https://console.kylith.com) 创建 OAuth 应用。

**重要**：在开始接入前，请与用户确认是否已在控制台创建了对应的 OAuth 应用配置信息。

## Discovery 自动发现

**只需 `client_id`，即可通过 Discovery 端点自动获取所有端点配置，无需手动硬编码任何 URL。**

Discovery 端点：

```
GET https://auth0.kylith.com/.well-known/openid-configuration
```

该端点无需认证，公开可访问，返回完整的 OIDC Provider 元数据：

```json
{
  "issuer": "https://auth0.kylith.com",
  "authorization_endpoint": "https://auth0.kylith.com/oauth2/auth",
  "token_endpoint": "https://auth0.kylith.com/oauth2/token",
  "userinfo_endpoint": "https://auth0.kylith.com/userinfo",
  "jwks_uri": "https://auth0.kylith.com/.well-known/jwks.json",
  "revocation_endpoint": "https://auth0.kylith.com/oauth2/revoke",
  "end_session_endpoint": "https://auth0.kylith.com/oauth2/sessions/logout"
}
```

**接入建议**：

- **推荐**：在应用启动时请求 Discovery 端点，动态读取各端点 URL，避免硬编码
- **简单场景**：也可直接使用下方「API 端点速查」表中的固定 URL（当前值与 Discovery 返回一致）
- 使用支持 OIDC Discovery 的 SDK（如 `openid-client`、`oidc-client-ts` 等）时，只需传入 `issuer`（`https://auth0.kylith.com`）和 `client_id`，SDK 会自动完成 Discovery

## 接入流程

### Step 1: 确认技术栈并分析系统类型

询问用户使用的框架（React/Next.js/Vue/Nuxt/Angular/纯HTML/后端语言等），并根据技术栈判断系统类型：

**系统类型分类：**

| 系统类型                 | 框架示例                            | 认证方式                     | 说明                                             |
| ------------------------ | ----------------------------------- | ---------------------------- | ------------------------------------------------ |
| **SPA 单页面应用** | React、Vue、Angular（纯前端）       | **使用 PKCE**          | 代码运行在浏览器，无法安全存储 client_secret     |
| **移动端应用**     | React Native、Flutter、iOS、Android | **使用 PKCE**          | 代码运行在客户端设备，无法安全存储 client_secret |
| **服务端渲染应用** | Next.js、Nuxt.js（SSR 模式）        | **使用 client_secret** | 有后端服务器，可安全存储 client_secret           |
| **传统后端应用**   | Node.js、Java、Python、Go 等        | **使用 client_secret** | 完全后端处理，可安全存储 client_secret           |

**判断规则：**

- 如果代码**完全运行在浏览器或移动设备**上 → 使用 **PKCE**（不需要 client_secret）
- 如果有**后端服务器处理 OAuth 流程** → 使用 **client_secret**（不需要 PKCE）

### Step 2: 参考 API 文档生成代码

阅读 `references/api.md` 获取完整的 OAuth 2.0 / OIDC 接口规范，**根据系统类型**生成对应代码：

**对于 SPA/移动端（使用 PKCE）：**

1. **环境变量配置** - 仅需 `client_id` 和 `redirect_uri`（端点 URL 通过 Discovery 自动获取）
2. **Discovery 初始化** - 启动时请求 `https://auth0.kylith.com/.well-known/openid-configuration` 获取端点配置；若使用支持 OIDC 的 SDK，直接传入 `issuer` 即可
3. **PKCE 实现** - 生成 code_verifier 和 code_challenge
4. **OAuth 流程封装** - 授权（带 PKCE 参数）、Token 交换（带 code_verifier）、刷新、登出
5. **登录按钮组件** - 符合下方规范的 UI 组件
6. **回调处理逻辑** - state 验证、code_verifier 验证、Token 存储

**对于后端应用（使用 client_secret）：**

1. **环境变量配置** - `client_id`、`client_secret`、`redirect_uri`（端点 URL 通过 Discovery 自动获取）
2. **Discovery 初始化** - 启动时请求 `https://auth0.kylith.com/.well-known/openid-configuration` 获取端点配置；若使用支持 OIDC 的 SDK，直接传入 `issuer` 即可
3. **OAuth 流程封装** - 授权、Token 交换（使用 `client_secret_post` 方式）、刷新、登出
4. **登录按钮组件** - 符合下方规范的 UI 组件
5. **回调处理逻辑** - state 验证、后端 Token 交换、安全存储（httpOnly Cookie）

### Step 3: 提供验证清单

- [ ] 环境变量正确配置
- [ ] 回调地址已在控制台注册
- [ ] 生产环境启用 HTTPS
- [ ] 登录按钮样式符合规范（可选）
- [ ] 错误处理完善

## API 端点速查

> **推荐**：通过 Discovery 端点动态获取所有端点 URL，只需硬编码 `issuer` 一个地址。

| 用途            | 端点                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| **Discovery（入口）** | `https://auth0.kylith.com/.well-known/openid-configuration`   |
| JWKS 公钥       | `https://auth0.kylith.com/.well-known/jwks.json`                       |
| 授权            | `https://auth0.kylith.com/oauth2/auth`                                 |
| Token           | `https://auth0.kylith.com/oauth2/token`                                |
| 用户信息        | `https://auth0.kylith.com/userinfo`                                    |
| 登出            | `https://auth0.kylith.com/oauth2/sessions/logout`                      |
| 撤销 Token      | `https://auth0.kylith.com/oauth2/revoke`                               |

完整 API 规范见 `references/api.md`

## 登录按钮规范（可选）

以下是推荐的登录按钮样式规范，采用 Google 风格的现代化按钮设计：

### 按钮文字

推荐使用以下文案之一（可本地化）：

- `使用 Kylith 账号登录`
- `通过 Kylith 登录`
- `继续使用 Kylith`

**注意**：应清楚表明用户是使用 Kylith 凭据登录您的应用，而非注册 Kylith 账号。

### 布局与尺寸

| 属性   | 值                    |
| ------ | --------------------- |
| 布局   | Flexbox，内容居中对齐 |
| 宽度   | 100%（自适应父容器）  |
| 高度   | 46px                  |
| 内边距 | 水平 24px             |

### 外观设计

| 属性   | 值                                   |
| ------ | ------------------------------------ |
| 背景色 | `#FFFFFF`                          |
| 边框   | `1px solid #dadce0`                |
| 圆角   | 24px（胶囊型）                       |
| 阴影   | `0 1px 3px rgba(60, 64, 67, 0.08)` |

### 文字样式

| 属性   | 值                                                                                     |
| ------ | -------------------------------------------------------------------------------------- |
| 字体   | `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif` |
| 字号   | 14px                                                                                   |
| 字重   | 600（半粗体）                                                                          |
| 颜色   | `#202124`                                                                            |
| 字间距 | 0.5px                                                                                  |

### 交互状态

**悬停状态 (hover)**：

- 背景色：`#f8f9fa`
- 边框色：`#c6c8ca`
- 阴影：`0 2px 8px rgba(60, 64, 67, 0.15)`
- 位移：`translateY(-1px)`

**点击状态 (active)**：

- 背景色：`#f1f3f4`
- 阴影：`0 1px 2px rgba(60, 64, 67, 0.1)`
- 位移：`translateY(0)`

**聚焦状态 (focus)**：

- 边框色：`#4285f4`（Google 蓝）
- 光晕：`0 0 0 3px rgba(66, 133, 244, 0.15)`

**加载状态**：

- 显示 spinner 并禁用按钮

**禁用状态**：

- 降低不透明度至 38%

### 动画效果

- 过渡时间：0.2s
- 缓动函数：cubic-bezier（流畅自然）
- 溢出：hidden（确保效果不超出按钮边界）

### 设计原则

1. **保持品牌一致性**：如有多个第三方登录选项，Kylith 按钮应与其他按钮具有相似的大小和视觉权重
2. **清晰的行动号召**：按钮文字应明确表达登录动作
3. **纯文字按钮**：当前仅使用文字，暂不包含图标或 Logo

## 安全要求

生成的代码必须遵循：

**SPA/移动端应用（PKCE 模式）：**

1. **必须使用 PKCE** - 生成 code_verifier（随机字符串）和 code_challenge（SHA256 哈希）
2. **验证 state** - 防止 CSRF 攻击
3. **不使用 client_secret** - 前端代码无法安全存储密钥
4. **验证 ID Token** - 检查 iss、aud、exp、nonce
5. **安全存储** - Token 存储在 sessionStorage 或 localStorage（注意 XSS 风险）

**后端应用（client_secret 模式）：**

1. **使用 client_secret_post** - Token 交换在后端完成，client_id 和 client_secret 放在请求体中
2. **验证 state** - 防止 CSRF 攻击
3. **不暴露密钥** - client_secret 仅存储在服务器环境变量中
4. **验证 ID Token** - 检查 iss、aud、exp、nonce
5. **安全存储** - 使用 httpOnly Cookie 存储 Token，防止 XSS 攻击

## 参考文档

| 文件                  | 内容                           |
| --------------------- | ------------------------------ |
| `references/api.md` | 完整 OAuth 2.0 / OIDC 接口文档 |

## 常见问题

| 问题           | 解决方案                                                                                |
| -------------- | --------------------------------------------------------------------------------------- |
| 本地测试       | 在[console.kylith.com](https://console.kylith.com) 添加 `http://localhost:端口/callback` |
| Token 过期     | 使用 refresh_token 刷新                                                                 |
| CORS 错误      | Token 交换必须在后端完成                                                                |
| state 验证失败 | 检查 sessionStorage 是否被清除                                                          |
