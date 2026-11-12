# 自建 Orca Cloud 认证服务实现规格

面向「把 Orca 桌面端从 `login.onorca.dev` / `relay.onorca.dev` 切到内网自建服务」的目标， 本文给出
认证服务（控制面）的**完整接口契约**， 使其可以独立实现并与 `cloud/apps/relay` 对接。

- 部署形态：内网 Linux 服务器（详见 §10 TLS 约束）
- 官方现状参考：官方 `login.onorca.dev` 是一个托管 IdP（PropelAuth）前面的 BFF， 只暴露 `/v1/desktop/auth/*` 这一层。
  自建实现必须复刻**这一层 BFF 契约**， 而不是直接暴露裸 IdP。

> **实现状态**：本规格已实现为 `cloud/apps/auth`（Hono + jose + `@orca-cloud/cloud-database`，
> SQLite/Postgres 双支持，自带 Dockerfile）。下文的契约即该实现的契约；
> §15 记录了实现相对初版规格的取舍。

---

## 1. 术语与组件边界

| 组件                     | 官方地址                   | 本规格负责        | 源码位置                                |
| ------------------------ | -------------------------- | ----------------- | --------------------------------------- |
| 认证/账号服务（BFF）     | `https://login.onorca.dev` | ✅ 本规格         | 闭源（私有 repo `stablyai/orca-cloud`） |
| Relay（director + cell） | `https://relay.onorca.dev` | ❌ 只描述对接方式 | 开源：`cloud/apps/relay`（MIT）         |
| Push 网关                | `https://push.onorca.dev`  | ❌ 不在范围       | 开源：`cloud/apps/push`，但凭证不可得   |

桌面端只与**认证服务**通信； 手机端**完全不与认证服务通信**（只用配对码里的 inviteToken/resumeToken），
所以手机端无需任何改造或重编译。

---

## 2. 客户端如何寻址认证服务

全部通过环境变量覆盖， **打包版同样生效**（`src/main/orca-profiles/profile-cloud-auth-config.ts:42-101`）：

| 环境变量                         | 默认值                                       | 说明                                       |
| -------------------------------- | -------------------------------------------- | ------------------------------------------ |
| `ORCA_CLOUD_API_URL`             | `https://login.onorca.dev`                   | 账号服务基址                               |
| `ORCA_CLOUD_CLIENT_ID`           | `orca-desktop`                               | OAuth2 client_id                           |
| `ORCA_CLOUD_AUTH_URL`            | 同 `API_URL`                                 | 仅 authorize 端点的基址                    |
| `ORCA_CLOUD_AUTH_SCOPE`          | `openid profile email offline_access`        | OAuth2 scope                               |
| `ORCA_CLOUD_AUTHORIZE_URL`       | `${AUTH_URL}/v1/desktop/auth/authorize`      | 浏览器跳转                                 |
| `ORCA_CLOUD_SESSION_URL`         | `${API_URL}/v1/desktop/auth/session`         | 换 token                                   |
| `ORCA_CLOUD_REFRESH_URL`         | `${API_URL}/v1/desktop/auth/refresh`         | 刷新                                       |
| `ORCA_CLOUD_CAPABILITIES_URL`    | `${API_URL}/v1/desktop/auth/capabilities`    | 能力刷新                                   |
| `ORCA_CLOUD_PROFILE_URL`         | `${API_URL}/v1/desktop/auth/profile`         | 新建云档案                                 |
| `ORCA_CLOUD_ORG_URL`             | `${API_URL}/v1/desktop/auth/org`             | 切换组织                                   |
| `ORCA_CLOUD_LOGOUT_URL`          | `${API_URL}/v1/desktop/auth/logout`          | 登出                                       |
| `ORCA_CLOUD_RELAY_TOKEN_URL`     | `${API_URL}/v1/desktop/auth/relay-token`     | **领 relay token**                         |
| `ORCA_CLOUD_CONNECTOR_TOKEN_URL` | `${API_URL}/v1/desktop/auth/connector-token` | 领 connector token                         |
| `ORCA_RELAY_URL`                 | `https://relay.onorca.dev`                   | Relay director 基址（**必须是纯 origin**） |
| `ORCA_PUSH_GATEWAY_URL`          | `https://push.onorca.dev`                    | 推送网关（不在本规格范围）                 |

### URL 白名单规则（实现前必读）

`src/shared/cloud-service-url.ts` 的 `cleanCloudServiceUrl`：

- 只允许 `https:`；
- `http:` **仅**允许 `127.0.0.1` / `localhost` / `[::1]`，且**仅在未打包构建**（`allowLoopbackHttp = !packaged`）。

因此：**内网 LAN IP + 明文 HTTP 的账号服务会被直接拒绝**（`configured:false`，UI 显示
"Orca Cloud sign-in is not configured for this build."）。 内网部署必须用 HTTPS， 见 §10。

`ORCA_RELAY_URL` 走 `cleanCloudServiceOrigin`： 必须是无路径、无 query 的纯 origin。

已有测试证明任意 HTTPS 主机均可接受（`profile-cloud-service-connect-overlap.test.ts:88`
使用 `https://orca-cloud.example`）。

---

## 3. 端点契约总表

除 `authorize` 外全部为 `POST` + `application/json`； 带 `Bearer` 的端点要求
`Authorization: Bearer <accessToken>`。

| #   | 方法 | 路径                                      | 鉴权                  | 客户端调用点                                  |
| --- | ---- | ----------------------------------------- | --------------------- | --------------------------------------------- |
| 1   | GET  | `/v1/desktop/auth/authorize`              | 浏览器                | `profile-cloud-pkce.ts:141-152`               |
| 2   | POST | `/v1/desktop/auth/session`                | 无                    | `profile-cloud-client.ts:207-221`             |
| 3   | POST | `/v1/desktop/auth/refresh`                | 无（带 refreshToken） | `profile-cloud-client.ts:239-251`             |
| 4   | POST | `/v1/desktop/auth/capabilities`           | Bearer                | `profile-cloud-client.ts:223-237`             |
| 5   | POST | `/v1/desktop/auth/profile`                | Bearer                | `profile-cloud-client.ts:252-265`             |
| 6   | POST | `/v1/desktop/auth/org`                    | Bearer                | `profile-cloud-client.ts:267-282`             |
| 7   | POST | `/v1/desktop/auth/logout`                 | Bearer                | `profile-cloud-client.ts:284-293`             |
| 8   | POST | `/v1/desktop/auth/relay-token`            | Bearer                | `relay-http-client.ts:102-129`                |
| 9   | POST | `/v1/desktop/auth/connector-token`        | Bearer                | `connector-token-mint.ts:51-59`               |
| 10  | GET  | `/v1/desktop/orgs/{orgId}/members`        | Bearer                | `profile-cloud-org-members-client.ts:147-157` |
| 11  | POST | `/v1/desktop/orgs/{orgId}/invites`        | Bearer                | 同上 `:159-169`                               |
| 12  | POST | `/v1/desktop/orgs/{orgId}/invites/revoke` | Bearer                | 同上 `:171-181`                               |
| 13  | POST | `/v1/desktop/orgs/{orgId}/members/role`   | Bearer                | 同上 `:183-193`                               |
| 14  | POST | `/v1/desktop/orgs/{orgId}/members/remove` | Bearer                | 同上 `:195-205`                               |
| 15  | GET  | `<JWKS 路径>`（自定）                     | 无                    | `relay-token-verifier.ts:19`                  |

10–14 的路径**没有环境变量覆盖**， 直接由 `apiBaseUrl` 拼接（`profile-cloud-org-members-client.ts:101-103`）。

---

## 4. 登录时序（OAuth2 Authorization Code + PKCE）

桌面端发起（`profile-cloud-pkce.ts:42-158`）：

1. 生成 `codeVerifier`（32 随机字节）、`nonce`、`state`。
2. 在 `127.0.0.1:0` 起一个临时 HTTP 服务， 回调路径固定为 **`/auth/callback`**：
   `redirectUri = http://127.0.0.1:<port>/auth/callback`。
3. 打开浏览器到 authorize URL， query 参数：

   | 参数                    | 值                                        |
   | ----------------------- | ----------------------------------------- |
   | `client_id`             | `ORCA_CLOUD_CLIENT_ID`                    |
   | `response_type`         | `code`                                    |
   | `redirect_uri`          | 上面的回环地址                            |
   | `scope`                 | `ORCA_CLOUD_AUTH_SCOPE`                   |
   | `nonce`                 | 随机 base64url                            |
   | `state`                 | 随机 base64url                            |
   | `code_challenge`        | `base64url(sha256(codeVerifier))`         |
   | `code_challenge_method` | `S256`                                    |
   | `local_profile_id`      | 桌面本地档案 id（**自定义参数**，非标准） |

4. 浏览器回调带 `code` + `state` 回到回环地址；桌面校验 `state` 匹配后取 `code`。
   - 回调带 `error=access_denied` → 客户端报 `orca_cloud_auth_denied`（**必须支持这个错误参数**）。
   - 5 分钟超时 → `orca_cloud_auth_timeout`。

**服务端要求**：

- authorize 端点必须渲染登录页（桌面端**没有**邮箱/密码表单， 登录完全发生在浏览器里）。
  登录页可以最小化为一个 email + password 表单。
- 登录成功后 **302** 到 `redirect_uri?code=<code>&state=<state>`。
- 校验 `code_challenge`（S256）、`redirect_uri`、`client_id`；`state` 原样回传。
- 授权码一次性、 短 TTL（建议 ≤ 60s）。
- `nonce` 与 `local_profile_id` 一起存入授权码， 换 token 时校验并回绑。

---

## 5. 统一响应体（session / refresh / profile / org 共用）

`OrcaCloudSessionExchangeResponse`（`profile-cloud-session-exchange.ts:7-14`）：

```jsonc
{
  "accessToken": "string", // 必填，非空
  "refreshToken": "string", // 必填，非空
  "expiresAt": 1731200000000, // 必填，毫秒 epoch
  "cloud": {
    // 必填
    "cloudProfileId": "string", // 必填
    "userId": "string", // 必填
    "email": "string", // 必填
    "displayName": "string", // 可选
    "activeOrgId": "string", // 可选
    "activeOrgName": "string", // 可选
    "linkedAt": 1731200000000 // 可选（缺失时客户端填 now）
  },
  "organizations": [
    // 可选；元素非法会被静默丢弃
    { "orgId": "string", "name": "string", "role": "string" }
  ],
  "capabilities": {
    // 必填
    "flags": { "relay.use": true }, // 必须是 Record<string, boolean>
    "refreshedAt": 1731200000000
  }
}
```

客户端归一化规则（`profile-cloud-client.ts:74-155`）：

- `cloud` 缺 `cloudProfileId` / `userId` / `email` → 抛 `invalid_orca_cloud_profile`， **登录失败**。
- `capabilities` 缺失或格式错误 → 被降级为 `{ flags: {}, refreshedAt: Date.now() }`。
  **但 `flags['relay.use']` 为 false 会直接导致 relay 不可用**（见 §7）。
- `organizations` 非法元素被丢弃；**不要**因为个别元素格式错误而整体失败。

### 能力标志

至少需要 `relay.use: true`（`src/main/runtime/mobile-cloud-relay/relay-auth-context.ts:31`）。
dev 版内置的全量集合可参考 `profile-cloud-dev-auth.ts:20-33`：
`share` / `team` / `share.create` / `share.manage` / `relay.use` / `team.member` / `enterprise.sso`。

---

## 6. 各端点细节

### 6.1 POST `/v1/desktop/auth/session`

请求：

```jsonc
{
  "code": "...",
  "codeVerifier": "...",
  "nonce": "...",
  "redirectUri": "http://127.0.0.1:PORT/auth/callback",
  "state": "...",
  "localProfileId": "..."
}
```

响应：§5 的统一响应体。

服务端动作：校验授权码（一次性、未过期、`code_challenge` 与 `codeVerifier` 匹配 S256）、
`nonce` 与授权码中的一致；建立会话；返回 access/refresh token。

### 6.2 POST `/v1/desktop/auth/refresh`

请求：`{ "refreshToken": "..." }` → 响应：§5 的统一响应体（**必须返回新的 refreshToken**， 轮换语义）。

语义要求（`src/main/orca-profiles/profile-cloud-session-refresh.ts`）：

| 服务端行为                                  | 客户端反应                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `401` + `{"error":"invalid_refresh_token"}` | **判定 token 已撤销 → 清除本地会话、UI 变 `reconnect-required`**（`:60-66`） |
| `5xx`                                       | 客户端重试一次（`isRetryableCloudRefreshRejection`，`:>=500`）               |
| 网络超时/连接失败                           | 记入 replay guard， 稍后重放一次                                             |
| `403`                                       | **不会**触发刷新（403 被视为权限问题）                                       |

**轮换宽限期（关键）**：客户端注释明确要求
"Two attempts plus the replay delay must settle inside the server's 60s rotation grace"
（`profile-cloud-client.ts:160`）， 且客户端超时为 **20s**（`CLOUD_REFRESH_TIMEOUT_MS`）。

→ 服务端必须保留**上一代 refresh token 约 60 秒**， 且在宽限期内用旧 token 再次刷新应返回
**客户端手上那个 token**（幂等轮换）， 而不是 401，也不能再签发一个新的（那会让客户端手上的
token 立刻失效）。 否则客户端超时重放会拿到 `invalid_refresh_token`， 直接把用户踢下线。

实现采用**确定性派生**来达成这一点（`cloud/apps/auth/src/refresh-token.ts`）：
`refreshToken = base64url(HMAC(key, sessionId + ':' + generation))`， 服务端只存 generation 计数器。
重放时按当前 generation 重算出**完全相同**的 token 返回， 不做任何状态变更。
这样既满足「只存 hash 不存明文」， 又能让重放与并发刷新都收敛到同一个 token。

### 6.3 POST `/v1/desktop/auth/capabilities`

请求：`{}`；响应：`{ "cloud"?, "organizations"?, "capabilities" }`（`capabilities` 必填）。

用途：客户端定期刷新能力与组织列表。 `cloud.userId` / `cloud.cloudProfileId` 必须与登录时一致，
否则客户端抛 `orca_cloud_identity_changed_during_capability_refresh`
（`profile-cloud-capability-refresh.ts:58-61`）。

### 6.4 POST `/v1/desktop/auth/profile`

请求：`{ "orgId"?, "name"?, "refreshToken" }` → 响应：§5 的统一响应体。

语义：为当前本地档案**新建一个云档案**（多档案场景）。 单用户自建场景可以原样返回当前会话。

### 6.5 POST `/v1/desktop/auth/org`

请求：`{ "orgId" }` → 响应：`{ "cloud", "organizations", "capabilities" }`。

语义：切换当前组织。 `cloud.activeOrgId` / `cloud.activeOrgName` 要同步更新，
因为它会进入 relay token 的 `org` claim（§8）。

### 6.6 POST `/v1/desktop/auth/logout`

请求：`{ "refreshToken" }` + Bearer → `200`（响应体可空）。

语义：吊销 refresh token **并吊销该 access token 所属的会话**（access token 载荷带 `sid`，
每个受保护端点都会复查会话是否被吊销）。 客户端随后删除本地会话文件并解绑档案。

### 6.7 POST `/v1/desktop/auth/relay-token`（**最关键**）

请求（`relay-http-client.ts:102-129`）：

```jsonc
{ "relayHostId": "AbCdEf0123_-xyZ9", "hostPublicKeyB64": "<base64 32B 公钥>" }
```

响应：

```jsonc
{ "relayToken": "<ES256 JWT>", "expiresAt": 1731200000000 }
```

服务端动作：

1. 校验 accessToken 有效； 从会话取 `userId` / `cloudProfileId` / `activeOrgId`。
2. **建议**服务端自行校验 `relayHostId === base64url(sha256(hostPublicKeyB64))[0..16]`
   （与桌面端 `deriveRelayHostId` 一致， `relay-http-client.ts:85-87`）， 不一致则 400，
   避免桌面端冒领他人 hostId。
3. 签发 ES256 JWT， claims 严格按下表（`cloud/apps/relay/src/authentication/relay-token-verifier.ts:6-13`）：

   | claim         | 类型             | 值                                                 |
   | ------------- | ---------------- | -------------------------------------------------- |
   | `sub`         | string           | 用户的 `userId`（relay 内部即 user_id）            |
   | `prof`        | string           | `cloudProfileId`                                   |
   | `org`         | string?          | `activeOrgId`（无组织时省略）                      |
   | `relayHostId` | string           | 必须匹配 `/^[A-Za-z0-9_-]{16}$/`                   |
   | `purpose`     | `'host-control'` | 字面量                                             |
   | `exp`         | number           | 过期时间（秒）                                     |
   | `iss`         | string           | 必须**严格等于** relay 的 `ORCA_RELAY_AUTH_ISSUER` |
   | `aud`         | string           | 必须**严格等于** `orca-relay`                      |

4. `expiresAt`（毫秒 epoch）应与 JWT 的 `exp` 对齐； 客户端据此安排续期
   （`relayRenewalDelayMs`）。 建议 TTL **5 分钟**（relay 协议上限 `relayTokenTtlMs: 5 * 60 * 1000`，
   `cloud/packages/relay-contract/src/protocol-limits.ts:16`）， 客户端会自动续期。

### 6.8 POST `/v1/desktop/auth/connector-token`

请求：`{ "machineId": "..." }` → 响应：`{ "connectorToken": "string", "expiresAt": number }`。

connector 是实验特性（`https://connector.onorca.dev`）。 不使用该特性时返回 `501 {"error":"connector_not_supported"}` 即可。

### 6.9 组织成员端点（可选）

`GET /v1/desktop/orgs/{orgId}/members` →

```jsonc
{
  "members": [ { "userId": "string|null", "email": "string", "displayName"?: "string", "role": "owner|admin|member" } ],
  "pendingInvites": [ { "email": "string", "role": "owner|admin|member", "createdAt": 1731200000000 } ],
  "viewerRole": "owner|admin|member",
  "canManageMembers": true
}
```

写操作请求体：`invites` → `{email, role}`；`invites/revoke` → `{email}`；
`members/role` → `{userId, role}`；`members/remove` → `{userId}`。

错误码（客户端会读 body 里的 `error` 字段）：
`already_member` / `already_invited` / `cannot_change_own_role` / `cannot_remove_self`。

---

## 7. 错误契约

- 客户端从 **JSON body 的 `error` 字段**读取业务错误码（`profile-cloud-client.ts:174-187`）；
  非 JSON body 只取状态码。
- `401` = token 无效 → 客户端会强制刷新一次。 **`403` 才表示权限不足**。
- `401` + `invalid_refresh_token` = 会话已撤销（唯一能清除本地登录态的组合）。

建议错误体统一为：

```json
{ "error": "invalid_refresh_token" }
```

---

## 8. Relay 对接

Relay 侧配置（`cloud/apps/relay/src/config.ts`）：

```bash
ORCA_RELAY_AUTH_ISSUER=https://auth.mydomain.com   # 必须等于 JWT 的 iss
ORCA_RELAY_AUTH_AUDIENCE=orca-relay                # 默认值即此
ORCA_RELAY_JWKS_URL=https://auth.mydomain.com/.well-known/jwks.json
ORCA_RELAY_ASSIGNMENT_SIGNING_KEY=<≥32 字节随机串>
ORCA_RELAY_ROLE=combined        # 单机部署用 combined（director+cell 一体）
ORCA_RELAY_PUBLIC_URL=https://relay.mydomain.com
ORCA_RELAY_CELL_URL=https://relay.mydomain.com
```

验签代码（`relay-token-verifier.ts:23-28`）：

```ts
jwtVerify(token, jwks, {
  issuer: config.authIssuer,
  audience: config.authAudience,
  algorithms: ['ES256']
})
```

→ **签名密钥必须是 EC P-256（ES256）**， 且 JWKS 要暴露公钥集合。
relay 用 `createRemoteJWKSet` 拉取并缓存（带 stale-if-error 容忍）， 所以
**JWKS 端点必须能被 relay 服务器访问**（内网 HTTP 也可以， relay 不做 https 强制）。

签发密钥与 JWKS 的建议：

- 单独一把 ES256 密钥专用于 relay token； 暴露公钥即可。
- JWKS 可放 `/.well-known/jwks.json`， 建议同时保留旧公钥（轮换期）， 因为 relay 缓存了 JWKS。

---

## 9. 建议实现方案

### 9.1 技术栈

与仓库现有 cloud 服务保持一致（`cloud/apps/relay/package.json`）：

- **Node 24 + Hono**（HTTP）+ **jose**（ES256 JWT / JWKS）+ **pg** 或 **better-sqlite3**。
- 密码哈希：`argon2`（或 `scrypt`， Node 内置）。

### 9.2 代码落点

建议作为 `cloud/apps/auth`（沿用 `cloud/` 独立 pnpm workspace、 Dockerfile、 `packages/*` 契约包的模式）。
若不想把认证服务并入 Orca 仓库， 也可独立仓库； 但契约以本文为准。

### 9.3 数据模型（最小可用）

```
users(user_id PK, email UNIQUE, display_name, password_hash, created_at)
organizations(org_id PK, name)
memberships(org_id, user_id, role)                    -- owner/admin/member
pending_invites(org_id, email, role, created_at)
cloud_profiles(cloud_profile_id PK, user_id, display_name, active_org_id, created_at)
auth_codes(code_hash PK, client_id, redirect_uri, code_challenge, method,
           scope, nonce, state, local_profile_id, user_id,
           expires_at, consumed_at)
sessions(session_id PK, user_id, cloud_profile_id, access_token_hash,
         refresh_token_hash, prev_refresh_token_hash, prev_refresh_valid_until,
         access_expires_at, refresh_expires_at, active_org_id, revoked_at)
```

要点：

- 授权码、refresh token **只存 hash**（与 relay 的做法一致： `relay_invites.token_hash`）。
- `prev_refresh_token_hash` + `prev_refresh_valid_until` 实现 §6.2 的 60s 幂等轮换宽限。
- `access_token` 可以是自签 JWT（服务内部校验）， 也可以是随机串 + 数据库查表。
  若用 JWT，注意客户端把 accessToken 直接当 Bearer 用， 但**只有你们的服务器校验它**。

---

## 10. 部署（内网服务器）

### 10.1 组件

| 服务       | 说明                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| `auth`     | 本规格的认证服务（Hono）， 监听 8080                                               |
| `relay`    | `cloud/apps/relay`， `ORCA_RELAY_ROLE=combined`， 监听 8080                        |
| `postgres` | 16 或 17（生产）； SQLite 适合单机试用（`DATABASE_URL` 不设即走 SQLite）           |
| TLS 终结   | Caddy / nginx， 需要 WebSocket upgrade + 长 idle timeout（relay 空闲超时 10 分钟） |

**数据目录必须挂持久卷**：`ORCA_AUTH_DATA_DIR` 里放着 **ES256 签名私钥** 与 **session cookie 密钥**。
容器重建若丢失签名密钥， relay 端缓存的 JWKS 会失配， 换钥窗口内 relay 验签失败。
`cloud/apps/auth/Dockerfile` 已把 `ORCA_AUTH_DATA_DIR` 默认指向 `/data/auth` 并声明 `VOLUME ["/data"]`。

仓库里**没有** docker-compose， 需要自写。 注意 `cloud/README.md:63-72` 声明 Terraform / 运维脚本在私有仓库。

### 10.2 HTTPS 是硬约束（内网部署的关键取舍）

| 组件      | 谁能访问它  | 是否必须公网可信证书                                                         |
| --------- | ----------- | ---------------------------------------------------------------------------- |
| **relay** | 手机 + 桌面 | **是** —— 手机强制 `wss:` 且校验证书链                                       |
| **auth**  | 仅桌面      | 桌面用 Node `fetch`， 信任 Node CA 集； 可用 `NODE_EXTRA_CA_CERTS` 挂内网 CA |

手机侧证据： `mobile/src/transport/relay/mobile-relay-connect-url.ts:2-7` 把协议强制改成 `wss:`；
配对 offer schema 也只接受 canonical HTTPS origin（`mobile-relay-pairing-offer.ts:18-31, 48-52`）。

内网部署推荐方案（按优先级）：

1. **Tailscale + MagicDNS + `tailscale cert`**： 证书由 Let's Encrypt 签发、**公网可信**，
   手机和桌面都加入 tailnet 即可； 服务器无需公网暴露。 **推荐**。
2. **内部域名 + Let's Encrypt DNS-01**： 需有该域名的 DNS API 权限。
3. **内网 CA + 桌面 `NODE_EXTRA_CA_CERTS`**： 只解决桌面侧； **relay 仍需公网可信证书**， 故不足够。

### 10.3 桌面端环境变量

```bash
ORCA_CLOUD_API_URL=https://auth.mydomain.com
ORCA_CLOUD_CLIENT_ID=orca-desktop
ORCA_RELAY_URL=https://relay.mydomain.com
# 可选：自建推送网关（§12 不在范围内）
# ORCA_PUSH_GATEWAY_URL=https://push.mydomain.com
```

Windows 打包版需要用带环境变量的启动包装（进程环境变量即可， 桌面端每次调用都会重新读取配置，
无缓存）。 开发构建额外支持：

```bash
ORCA_CLOUD_DEV_AUTH=1   # 仅未打包 + NODE_ENV!=production：本地伪造会话（含 relay.use）， 不走网络登录
```

---

## 11. 端到端验收清单

1. `GET /v1/desktop/auth/authorize?...` → 登录页 → 302 回 `127.0.0.1:PORT/auth/callback?code=...&state=...`
2. `POST /v1/desktop/auth/session` → 返回含 `capabilities.flags['relay.use'] === true` 的会话
3. 桌面端状态栏显示 **Connected**， 且 `capabilities` 面板可见 `relay.use`
4. `POST /v1/desktop/auth/relay-token` → 拿到 ES256 JWT； 用 JWKS 验签通过， `iss`/`aud`/`purpose` 正确
5. `POST {ORCA_RELAY_URL}/v1/assign` → 返回 `cellUrl` 与 `assignmentEpoch`
6. 桌面端 Pairing → 生成 `orca://pair?code=...`， 解码后 `relay.directorUrl` / `cellUrl` 指向你的 relay
7. 手机（官方 App，无需重编译）扫码配对 → `wss://<cell>/v1/connect/<relayHostId>` 建立成功
8. 手机端能看到 worktree 列表、终端输出， 能回复 agent
9. 断开 auth 服务 → 桌面端应进入 `reconnect-required`， 而不是静默失败
10. 用旧 refresh token 在 60s 内重复调用 `/refresh` → 应返回同一新 token， 不报 `invalid_refresh_token`

---

## 12. 明确不在本规格范围内

| 事项                              | 原因 / 现状                                                                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **推送通知**                      | 官方 App 的 APNs topic 是 `com.stably.orca.mobile`（属 stablyai 的 Apple 账号）， 自建网关拿不到对应 APNs key。 自建推送需自编译手机端并换 bundle id + 自有 Firebase/Apple 账号。                                                         |
| **Relay admin 路由**              | `/v1/admin/*` 的验签硬编码 Google Identity（`admin-token-verifier.ts:66`）， 单机部署弃用即可， 不影响配对。                                                                                                                              |
| **Artifacts / Skill 分享**        | API 域名被锁死在 `*.onorca.dev`（`src/main/artifacts/artifact-cloud-config.ts:21,26`）， 自建需放开该白名单。                                                                                                                             |
| **移动端重编译**                  | 非必需。 relay 地址由配对码携带， 官方 App 直接可用。                                                                                                                                                                                     |
| **区域优选（多区域延迟路由）**    | 单节点下不生效， 但无害。 目录里的 `probeOrigins` 必须是 director 主机名的**子域**（`relay-region-catalog-fetch.ts:60-62`）， 失败会被 catch 并降级为"无偏好区域"。 另注：**没有** `*.onorca.dev` 域名白名单， 任意 HTTPS director 均可。 |
| **Updater / feedback / 插件目录** | 硬编码 `onorca.dev`， 与登录配对无关。                                                                                                                                                                                                    |

---

## 13. 已知坑清单

1. **region 目录不是硬阻塞**：`isCanonicalDirectorOrigin` 只要求 HTTPS 或 loopback HTTP，
   **不存在** `.onorca.dev` 白名单（`relay-region-catalog-fetch.ts:50-58`）。
2. **`profiles` / `org` 端点不要返回额外字段**： 客户端用 zod 风格的手写归一化， 多余字段被忽略， 无害。
3. **`expiresAt` 是毫秒**， 不是秒。 客户端拿它和 `Date.now()` 比较（`shouldRefreshCloudSession`）。
4. **refresh 的 60s 宽限**（§6.2）是最容易踩的坑， 直接决定用户会不会被莫名踢下线。
5. **`relay.use` 标志缺失**不会让登录失败， 但会让 relay 静默不可用， 且配对界面不会给出清晰原因
   （`refuseAutomaticWithoutRelay` 直接拒绝生成配对码， `runtime-rpc-mobile-pairing.ts:188-200`）。
6. **退出登录会把配对降级为 local-only**（`src/shared/remote-runtime/pairing/mobile-pairing-connection-mode.ts`）：
   `effectiveMobilePairingConnectionMode` 在 `automatic` 模式下若 `signedIn === false` 一律降级为 `local-only`，
   且 `canMintMobilePairingOffer` 会直接拒绝生成 "Anywhere/Relay" 配对码。
   即桌面退出登录后， 手机只能走 LAN/Tailscale 直连， 不能再用 relay。
7. **单机 relay 必须 HTTPS**： 手机端不接受 `http://`， 即使是 `127.0.0.1`。
8. **`ORCA_RELAY_URL` 必须是纯 origin**（无路径）， 否则 `cleanCloudServiceOrigin` 返回 null 并静默回落到官方地址。
9. **区域探测的 origin 归属检查是「子域」语义**（`relay-region-catalog-fetch.ts:74-76`）：
   探测来源的主机名必须以 `.${director 主机名}` 结尾。 用 **IP** 做 director 时该判断恒为假，
   一旦 `/v1/regions` 返回非空目录，桌面端的区域探测会直接抛
   `relay probe origin does not belong to the director`。 所以 IP 部署下应当让区域目录保持为空
   （不要把合并角色的 cell 登记进 director 库），区域偏好退化成默认值即可。

---

## 14. 实现现状与取舍

实现位于 `cloud/apps/auth`：Hono + jose + `@orca-cloud/cloud-database`（SQLite/Postgres 双支持），
自带 Dockerfile，与 `cloud/apps/relay` 同一 workspace 风格。

| 文件                                          | 职责                                       |
| --------------------------------------------- | ------------------------------------------ |
| `src/app.ts`                                  | 全部 HTTP 端点、鉴权、限流                 |
| `src/config.ts`                               | 环境变量契约（zod）                        |
| `src/authorization-request.ts`                | authorize 参数校验、loopback redirect 规则 |
| `src/authorization-code.ts`                   | 授权码签发/校验/消费、过期清理             |
| `src/session-store.ts`                        | 会话、refresh 轮换与宽限期                 |
| `src/refresh-token.ts`                        | refresh token 的确定性派生与校验           |
| `src/token-signer.ts`                         | ES256 access/relay token 签发与验签        |
| `src/signing-key.ts`                          | 签名密钥加载/生成、JWKS                    |
| `src/password-hash.ts`                        | 异步 scrypt                                |
| `src/cloud-profile.ts` / `src/auth-user.ts`   | 账号、组织、云档案                         |
| `src/login-page.ts` / `src/session-cookie.ts` | 登录页与登录态 cookie                      |
| `src/bootstrap-user.ts`                       | 首次启动播种账号（密码写 0600 文件）       |

### 与初版规格的差异

| 项              | 初版规格                       | 实现                                                                | 原因                                                            |
| --------------- | ------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| refresh 轮换    | 宽限期内返回「同一个新 token」 | 确定性派生：同一 generation 永远算出同一个 token， 服务端只存计数器 | 只存 hash 也能满足幂等；重放与并发刷新都收敛到同一个 token      |
| connector-token | `404`                          | `501 {"error":"connector_not_supported"}`                           | 更明确；客户端只对 401/403 触发刷新，501 无副作用               |
| 授权码消耗时机  | 先消耗后校验                   | 先校验后消耗（不匹配不消耗）                                        | 客户端一次手滑不应浪费唯一一次交换机会                          |
| 云档案          | 每次签发新建                   | 同一账号复用 `cloudProfileId`， 仅 `/profile` 端点新建              | 否则档案表无限增长，且 relay token 的 `prof` claim 每次登录都变 |
| 组织成员写操作  | 列入契约表                     | 统一返回 `501 {"error":"org_management_not_supported"}`             | 骨架阶段未实现；显式错误码比 404 纯文本更利于 UI 提示           |

### 已做的安全加固

- 密码哈希用**异步** scrypt（N=2^14）， 不阻塞事件循环；**账号不存在时也跑一次等时假哈希**， 消除用户枚举的时序侧信道。
- 登录限流按**账号 + 来源 IP** 两个维度计数。
- 登录页带 `Content-Security-Policy` / `X-Frame-Options` / `Cache-Control: no-store`。
- 登录 cookie 在 `publicUrl` 为 https 时带 `Secure`。
- 授权码与过期会话定期清理。
- redirect_uri 只接受 loopback 的 `/auth/callback`；`client_id`、`state`、`nonce`、`code_challenge`、`local_profile_id` 全部校验。
- **access token 与会话绑定**： token 载荷带 `sid`，每个受保护端点在验签后再查一次会话是否被吊销；
  登出会同时吊销该会话，token 立刻失效，而不是等 TTL 到期。

### 已知未覆盖

- **未在真实 PostgreSQL 上跑过**（开发机无 Docker）。 SQL 已按 PG 方言审查（表别名避开 `user` 等保留字；
  `BIGINT` 列在 PG 下以字符串返回，读数路径已兼容）。
- **已签发的 relay token 在登出后仍可用到 TTL**（默认 5 分钟）：relay 侧只验签、不回查 auth 会话，
  这是设计上的边界，不是缺陷。
- 推送、connector、组织成员写操作未实现。

### 内网部署实测（192.168.10.13:18443）

三个容器跑在一台共享内网服务器上（自建 CA + 自签 IP 证书，nginx 做 TLS 终结与路径分流）：

| 容器           | 作用                                | 外部路径                                                   |
| -------------- | ----------------------------------- | ---------------------------------------------------------- |
| `orca-auth-1`  | 账号与 token 服务                   | `/v1/desktop/*`、`/.well-known/jwks.json`                  |
| `orca-relay-1` | relay director + cell（合并角色）   | `/v1/assign`、`/v1/regions`、`/v1/connect/*`、`/v1/host/*` |
| `orca-edge-1`  | nginx TLS 终结 + WS 升级 + 路径分流 | `0.0.0.0:18443`                                            |

实测结论（脚本在 `cloud/apps/auth` 仓库外的一次性目录，未入库）：

- **契约检查 21 项全过**：授权页 → 登录 302 → 换 token → capabilities → profile → org 切换 →
  org members → relay-token → 登出 → 无凭据拒绝，响应形状与 `profile-cloud-client.ts` 的期望一致。
- **桌面端真实客户端代码全链路通过**：直接调用 `exchangeOrcaCloudAuthCode` /
  `refreshOrcaCloudCapabilities` / `createOrcaCloudProfile` / `selectOrcaCloudOrg` /
  `exchangeRelayAuthorization` / `requestRelayAssignment` / `revokeOrcaCloudSession`，
  `requestRelayAssignment` 返回 `cellUrl=https://192.168.10.13:18443`。
- **relay 的 WS 腿可用**：经 nginx 后 `wss://…/v1/host/control` 带有效 relay token 升级成功（101），
  无效 token 被 relay 以 401 拒绝（说明 relay 确实在用 auth 签发的 ES256 token 验签，JWKS 走内网 http）。
- **`/v1/regions` 返回空数组**：区域目录只列出「已在 director 库登记、admission=general、心跳新鲜」的 cell，
  合并角色没有自登记，因此区域偏好退化为默认值；单 cell 部署下不影响 `/v1/assign`。
- **手机腿的硬限制**：手机系统不信任自签 IP 证书（Android/iOS 都不会默认信任），所以**真机配对必须先有
  真实域名 + 公网证书**（或 Tailscale `*.ts.net`）。配对 offer 的 schema 只要求「规范 HTTPS origin」，
  IP + 端口在结构上合法，卡住的只是证书信任。

---

## 15. 参考文件索引

| 主题                                           | 文件                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| 端点与默认地址                                 | `src/main/orca-profiles/profile-cloud-auth-config.ts`             |
| PKCE 登录流程                                  | `src/main/orca-profiles/profile-cloud-pkce.ts`                    |
| 请求/响应归一化                                | `src/main/orca-profiles/profile-cloud-client.ts`                  |
| 刷新与错误语义                                 | `src/main/orca-profiles/profile-cloud-session-refresh.ts`         |
| 会话状态机                                     | `src/main/orca-profiles/profile-cloud-session-owner.ts`           |
| 状态派生（local/connected/reconnect-required） | `src/main/orca-profiles/profile-cloud-auth-status.ts`             |
| 组织成员客户端                                 | `src/main/orca-profiles/profile-cloud-org-members-client.ts`      |
| relay token 申请                               | `src/main/runtime/mobile-cloud-relay/relay-http-client.ts`        |
| relay 验签与 claims                            | `cloud/apps/relay/src/authentication/relay-token-verifier.ts`     |
| relay 配置项                                   | `cloud/apps/relay/src/config.ts`                                  |
| 配对 offer schema                              | `src/shared/remote-runtime/pairing/mobile-relay-pairing-offer.ts` |
| 手机端 relay 连接                              | `mobile/src/transport/relay/mobile-relay-connect-url.ts`          |
