# Kylith SSO Public API 接口文档

Base URL: `https://auth0.kylith.com`

---

## 目录

- [Discovery 端点](#discovery-端点)
- [OAuth 2.0 端点](#oauth-20-端点)
- [OpenID Connect 端点](#openid-connect-端点)
- [数据结构](#数据结构)
- [错误响应](#错误响应)

---

## Discovery 端点

### 获取 OpenID Connect 配置

获取 OpenID Provider 的元数据配置，包含所有端点 URL 和支持的功能。

```
GET /.well-known/openid-configuration
```

**请求示例**

```bash
curl https://auth0.kylith.com/.well-known/openid-configuration
```

**响应示例**

```json
{
  "issuer": "https://auth0.kylith.com",
  "authorization_endpoint": "https://auth0.kylith.com/oauth2/auth",
  "token_endpoint": "https://auth0.kylith.com/oauth2/token",
  "userinfo_endpoint": "https://auth0.kylith.com/userinfo",
  "jwks_uri": "https://auth0.kylith.com/.well-known/jwks.json",
  "revocation_endpoint": "https://auth0.kylith.com/oauth2/revoke",
  "end_session_endpoint": "https://auth0.kylith.com/oauth2/sessions/logout",
  "response_types_supported": ["code", "token", "id_token", "code token", "code id_token", "token id_token", "code token id_token"],
  "subject_types_supported": ["public", "pairwise"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "scopes_supported": ["openid", "offline_access", "profile", "email", "phone", "organization"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic", "private_key_jwt", "none"],
  "claims_supported": ["sub", "iss", "aud", "exp", "iat", "name", "email", "email_verified", "picture", "locale", "english_name", "gender", "phone_number", "phone_number_verified", "organization_id", "organization_name"],
  "code_challenge_methods_supported": ["plain", "S256"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials", "implicit"]
}
```

---

### 获取 JSON Web Key Set (JWKS)

获取用于验证 ID Token 和 JWT Access Token 签名的公钥。

```
GET /.well-known/jwks.json
```

**请求示例**

```bash
curl https://auth0.kylith.com/.well-known/jwks.json
```

**响应示例**

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "public:hydra.openid.id-token",
      "alg": "RS256",
      "n": "z5...",
      "e": "AQAB"
    }
  ]
}
```

---

## OAuth 2.0 端点

### 授权端点

发起 OAuth 2.0 / OpenID Connect 授权流程。

```
GET /oauth2/auth
```

**请求参数**

| 参数                    | 类型    | 必填      | 说明                                           |
| ----------------------- | ------- | --------- | ---------------------------------------------- |
| `client_id`             | string  | ✅         | 客户端 ID                                      |
| `redirect_uri`          | string  | ✅         | 回调地址（需预注册）                           |
| `response_type`         | string  | ✅         | 响应类型：`code`、`token`、`id_token` 或组合   |
| `scope`                 | string  | ✅         | 权限范围，空格分隔                             |
| `state`                 | string  | ✅         | 随机字符串，防止 CSRF                          |
| `nonce`                 | string  | OIDC 必填 | 随机字符串，防止重放（请求 `id_token` 时必填） |
| `code_challenge`        | string  | PKCE      | SHA256(code_verifier) 的 Base64URL 编码        |
| `code_challenge_method` | string  | PKCE      | 固定值 `S256`                                  |
| `prompt`                | string  | 可选      | `none`、`login`、`consent`、`select_account`   |
| `max_age`               | integer | 可选      | 最大认证时间（秒）                             |
| `login_hint`            | string  | 可选      | 预填用户名/邮箱                                |
| `ui_locales`            | string  | 可选      | 界面语言偏好                                   |

**请求示例**

```
GET https://auth0.kylith.com/oauth2/auth?
  client_id=my-client&
  redirect_uri=https://example.com/callback&
  response_type=code&
  scope=openid%20profile%20email%20phone%20organization&
  state=abc123&
  nonce=xyz789&
  code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
  code_challenge_method=S256
```

**响应**

成功：302 重定向到 `redirect_uri`，附带参数：

| 参数           | 说明                                        |
| -------------- | ------------------------------------------- |
| `code`         | 授权码（response_type=code 时）             |
| `state`        | 原样返回的 state 参数                       |
| `id_token`     | ID Token（response_type 包含 id_token 时）  |
| `access_token` | Access Token（response_type 包含 token 时） |

失败：302 重定向到 `redirect_uri`，附带错误参数：

```
https://example.com/callback?error=access_denied&error_description=The+user+denied+the+request&state=abc123
```

---

### Token 端点

用授权码或其他凭据换取 Access Token。

```
POST /oauth2/token
```

**Content-Type**: `application/x-www-form-urlencoded`

**认证方式**（三选一）：

- `client_secret_basic`: Authorization header（推荐）
- `client_secret_post`: 在 body 中传 client_id 和 client_secret
- `none`: 公开客户端，仅传 client_id

#### Authorization Code 换取 Token

| 参数            | 类型   | 必填       | 说明                          |
| --------------- | ------ | ---------- | ----------------------------- |
| `grant_type`    | string | ✅          | 固定值 `authorization_code`   |
| `code`          | string | ✅          | 授权码                        |
| `redirect_uri`  | string | ✅          | 与授权请求一致                |
| `client_id`     | string | ✅          | 客户端 ID                     |
| `client_secret` | string | 机密客户端 | 客户端密钥                    |
| `code_verifier` | string | PKCE       | 原始随机字符串（43-128 字符） |

**请求示例**

```bash
curl -X POST https://auth0.kylith.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "my-client:my-secret" \
  -d "grant_type=authorization_code" \
  -d "code=AUTH_CODE" \
  -d "redirect_uri=https://example.com/callback" \
  -d "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
```

**响应示例**

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "xrefrsh_abc123...",
  "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "scope": "openid profile email phone organization"
}
```

---

#### Refresh Token 刷新

| 参数            | 类型   | 必填       | 说明                   |
| --------------- | ------ | ---------- | ---------------------- |
| `grant_type`    | string | ✅          | 固定值 `refresh_token` |
| `refresh_token` | string | ✅          | 刷新令牌               |
| `client_id`     | string | ✅          | 客户端 ID              |
| `client_secret` | string | 机密客户端 | 客户端密钥             |
| `scope`         | string | 可选       | 缩小权限范围           |

**请求示例**

```bash
curl -X POST https://auth0.kylith.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "my-client:my-secret" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=xrefrsh_abc123"
```

---

#### Client Credentials（M2M）

| 参数            | 类型   | 必填 | 说明                        |
| --------------- | ------ | ---- | --------------------------- |
| `grant_type`    | string | ✅    | 固定值 `client_credentials` |
| `client_id`     | string | ✅    | 客户端 ID                   |
| `client_secret` | string | ✅    | 客户端密钥                  |
| `scope`         | string | 可选 | 权限范围                    |

**请求示例**

```bash
curl -X POST https://auth0.kylith.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "my-client:my-secret" \
  -d "grant_type=client_credentials" \
  -d "scope=api:read api:write"
```

**响应示例**

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "api:read api:write"
}
```

> ⚠️ Client Credentials 模式不返回 `refresh_token` 和 `id_token`

---

### Token 撤销端点

撤销 Access Token 或 Refresh Token。

```
POST /oauth2/revoke
```

**Content-Type**: `application/x-www-form-urlencoded`

**请求参数**

| 参数              | 类型   | 必填       | 说明                              |
| ----------------- | ------ | ---------- | --------------------------------- |
| `token`           | string | ✅          | 要撤销的 Token                    |
| `token_type_hint` | string | 可选       | `access_token` 或 `refresh_token` |
| `client_id`       | string | ✅          | 客户端 ID                         |
| `client_secret`   | string | 机密客户端 | 客户端密钥                        |

**请求示例**

```bash
curl -X POST https://auth0.kylith.com/oauth2/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "my-client:my-secret" \
  -d "token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**响应**

成功：`200 OK`（无响应体）

> 即使 Token 无效或已过期，也返回 200（符合 RFC 7009）

---

### Token 内省端点

验证 Token 有效性并获取元数据（通常仅限内部服务使用）。

```
POST /oauth2/introspect
```

**Content-Type**: `application/x-www-form-urlencoded`

**请求参数**

| 参数              | 类型   | 必填 | 说明                              |
| ----------------- | ------ | ---- | --------------------------------- |
| `token`           | string | ✅    | 要检查的 Token                    |
| `token_type_hint` | string | 可选 | `access_token` 或 `refresh_token` |
| `scope`           | string | 可选 | 要求 Token 必须包含的 scope       |

**请求示例**

```bash
curl -X POST https://auth0.kylith.com/oauth2/introspect \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "my-client:my-secret" \
  -d "token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**响应示例（Token 有效）**

```json
{
  "active": true,
  "client_id": "my-client",
  "sub": "user-123",
  "exp": 1704067200,
  "iat": 1704063600,
  "iss": "https://auth0.kylith.com",
  "token_type": "Bearer",
  "scope": "openid profile email phone organization"
}
```

**响应示例（Token 无效）**

```json
{
  "active": false
}
```

---

## OpenID Connect 端点

### UserInfo 端点

获取当前用户信息。

```
GET /userinfo
```

**认证**

| Header          | 值                      |
| --------------- | ----------------------- |
| `Authorization` | `Bearer {access_token}` |

**请求示例**

```bash
curl https://auth0.kylith.com/userinfo \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**响应示例**

```json
{
  "sub": "a1b2c3d4-...",
  "email": "zhangsan@kn.group",
  "email_verified": true,
  "name": "张三",
  "picture": "https://oa-prod-std-kuainiu.oss-accelerate.aliyuncs.com/...",
  "locale": "zh-CN",
  "english_name": "San Zhang",
  "gender": "male",
  "phone_number": "+86 13800138000",
  "phone_number_verified": true,
  "organization_id": "oa.kuainiu.io",
  "organization_name": "oa.kuainiu.io",
  "updated_at": 1738937400
}
```

**返回字段说明**

| 字段                    | Scope        | 说明                         |
| ----------------------- | ------------ | ---------------------------- |
| `sub`                   | openid       | 用户唯一标识                 |
| `email`                 | email        | 邮箱                         |
| `email_verified`        | email        | 邮箱是否验证                 |
| `name`                  | profile      | 中文全名                     |
| `picture`               | profile      | 头像 URL                     |
| `locale`                | profile      | 语言/地区（如 `zh-CN`）      |
| `english_name`          | profile      | 英文姓名                     |
| `gender`                | profile      | 性别（来自 metadata_public） |
| `phone_number`          | phone        | 手机号（E.164 格式）         |
| `phone_number_verified` | phone        | 手机号是否验证               |
| `organization_id`       | organization | 组织标识（tenant_domain）    |
| `organization_name`     | organization | 组织名称（tenant_domain）    |
| `updated_at`            | profile      | 最后更新时间戳               |

---

### 登出端点

发起 OpenID Connect 登出流程。

```
GET /oauth2/sessions/logout
```

**请求参数**

| 参数                       | 类型   | 必填 | 说明                       |
| -------------------------- | ------ | ---- | -------------------------- |
| `id_token_hint`            | string | 推荐 | 当前用户的 ID Token        |
| `post_logout_redirect_uri` | string | 可选 | 登出后跳转地址（需预注册） |
| `state`                    | string | 可选 | 状态参数，原样返回         |

**请求示例**

```
GET https://auth0.kylith.com/oauth2/sessions/logout?
  id_token_hint=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...&
  post_logout_redirect_uri=https://example.com&
  state=abc123
```

**响应**

302 重定向到 `post_logout_redirect_uri`（如果提供），或显示登出成功页面。

---

## 数据结构

### Token 响应

```typescript
interface TokenResponse {
  access_token: string;      // Access Token
  token_type: "Bearer";      // Token 类型
  expires_in: number;        // 过期时间（秒）
  refresh_token?: string;    // Refresh Token（需要 offline_access scope）
  id_token?: string;         // ID Token（需要 openid scope）
  scope: string;             // 实际授予的 scope
}
```

### ID Token Claims

```typescript
interface IDToken {
  iss: string;               // 签发者
  sub: string;               // 用户标识
  aud: string | string[];    // 客户端 ID
  exp: number;               // 过期时间戳
  iat: number;               // 签发时间戳
  auth_time?: number;        // 认证时间戳
  nonce?: string;            // 请求中的 nonce
  acr?: string;              // 认证上下文类引用
  amr?: string[];            // 认证方法引用
  azp?: string;              // 授权方
  at_hash?: string;          // Access Token 哈希
  c_hash?: string;           // Code 哈希
  
  // Profile scope
  name?: string;             // 中文全名
  picture?: string;          // 头像 URL
  locale?: string;           // 语言/地区
  english_name?: string;     // 英文姓名
  gender?: string;           // 性别（来自 metadata_public）
  
  // Email scope
  email?: string;            // 邮箱
  email_verified?: boolean;  // 邮箱是否验证
  
  // Phone scope
  phone_number?: string;           // 手机号（E.164 格式）
  phone_number_verified?: boolean; // 手机号是否验证
  
  // Organization scope
  organization_id?: string;        // 组织标识（tenant_domain）
  organization_name?: string;      // 组织名称（tenant_domain）
  
  updated_at?: number;       // 最后更新时间戳
}
```

### UserInfo 响应

```typescript
interface UserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  locale?: string;
  english_name?: string;
  gender?: string;
  phone_number?: string;
  phone_number_verified?: boolean;
  organization_id?: string;
  organization_name?: string;
  updated_at?: number;
}
```

---

## 错误响应

### OAuth 2.0 错误格式

```json
{
  "error": "invalid_request",
  "error_description": "The request is missing a required parameter.",
  "error_hint": "Make sure that the client_id parameter is set.",
  "status_code": 400
}
```

### 常见错误码

| 错误码                    | HTTP 状态 | 说明                        |
| ------------------------- | --------- | --------------------------- |
| `invalid_request`         | 400       | 请求缺少必需参数或参数无效  |
| `invalid_client`          | 401       | 客户端认证失败              |
| `invalid_grant`           | 400       | 授权码/刷新令牌无效或已过期 |
| `invalid_scope`           | 400       | 请求的 scope 无效或未授权   |
| `unauthorized_client`     | 401       | 客户端无权使用此授权类型    |
| `unsupported_grant_type`  | 400       | 不支持的 grant_type         |
| `access_denied`           | 403       | 用户拒绝授权请求            |
| `server_error`            | 500       | 服务器内部错误              |
| `temporarily_unavailable` | 503       | 服务暂时不可用              |

### UserInfo 错误

使用 WWW-Authenticate header 返回错误：

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token", error_description="The access token expired"
```

| 错误码               | 说明                     |
| -------------------- | ------------------------ |
| `invalid_token`      | Token 无效、过期或被撤销 |
| `insufficient_scope` | Token 缺少所需 scope     |

---

## 常用 Scope

| Scope            | 说明                                                        |
| ---------------- | ----------------------------------------------------------- |
| `openid`         | **必须** - 启用 OpenID Connect，返回 ID Token               |
| `profile`        | 用户基本信息（name, picture, locale, english_name, gender） |
| `email`          | 用户邮箱信息（email, email_verified）                       |
| `phone`          | 用户手机号（phone_number, phone_number_verified）           |
| `organization`   | 用户组织信息（organization_id, organization_name）          |
| `offline_access` | 获取 Refresh Token                                          |

---

## 速率限制

| 端点                 | 限制                 |
| -------------------- | -------------------- |
| `/oauth2/token`      | 100 请求/分钟/客户端 |
| `/oauth2/introspect` | 500 请求/分钟/客户端 |
| `/userinfo`          | 100 请求/分钟/用户   |

超出限制时返回 `429 Too Many Requests`。

---

## 安全建议

1. **始终使用 HTTPS**
2. **验证 ID Token 签名** - 使用 JWKS 端点获取公钥
3. **验证 ID Token Claims** - 检查 iss、aud、exp、nonce
4. **使用 PKCE** - 所有公开客户端必须使用
5. **安全存储 Token** - 推荐 httpOnly Cookie
6. **定期轮换 Refresh Token**
