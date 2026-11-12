# 自建 Orca Cloud — 任务清单

配套文档：[`self-hosted-orca-cloud-design.md`](./self-hosted-orca-cloud-design.md)（规格与设计取舍）。

本文件是**执行台账**：每次会话从这里领任务、完成后勾选并提交。设计文档保持稳定，本文件随进度演进。

---

## 1. 当前状态

| 项                                           | 状态                                         |
| -------------------------------------------- | -------------------------------------------- |
| auth 服务（`cloud/apps/auth`）               | ✅ 已实现并部署，契约检查 21 项全过          |
| relay（`cloud/apps/relay`，上游开源）        | ✅ 已部署并对接，director + cell 合并角色    |
| 内网部署（192.168.10.13:18080）              | ✅ 已上线，三容器运行中                      |
| 桌面端脚本级链路（真实客户端代码打真实服务） | ✅ 已验证                                    |
| relay WebSocket 腿（升级 + token 鉴权）      | ✅ 已验证                                    |
| 登录限流落库（T-07）                         | ✅ 已实现并部署，重启后封禁不失效            |
| 审计事件（T-08）                             | ✅ 已实现并部署，可按用户与时间检索          |
| 真实 PostgreSQL（T-09）                      | ✅ PG 16 实跑通过（生产仍跑 SQLite）         |
| 部署配置入库（T-06）                         | ✅ `cloud/apps/auth/deploy/`                 |
| CI 补 auth 容器扫描（T-10）                  | ✅ 已进 matrix                               |
| 桌面端 UI 登录                               | ✅ 已完成（真实 Electron 应用 + 真实浏览器） |
| 真机配对（手机腿 + E2EE 握手）               | ⬜ 未做                                      |
| 域名与网关反代                               | 🟡 DNS + 证书已就绪，网关缺 WebSocket 头     |

### 交接信息

| 项       | 值                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 服务入口 | `192.168.10.13:18080`（唯一对外，**纯 HTTP**；TLS 由公网网关 113.106.112.17 终结）                                                                        |
| SSH      | `ssh -p 2222 root@192.168.10.13`（22 端口不通）                                                                                                           |
| 部署目录 | `/opt/orca-deploy`（compose + `nginx.conf` + `routing.inc` + `tls/` + `data/`），源码副本 `/opt/orca-cloud`                                               |
| 部署模板 | 仓库里 `cloud/apps/auth/deploy/`（compose / nginx / routing / RUNBOOK，不含密钥）                                                                         |
| 健康检查 | `/health` `/ready` → relay；`/auth/health` `/auth/ready` → 账号服务                                                                                       |
| 容器     | `orca-auth-1` / `orca-relay-1` / `orca-edge-1`                                                                                                            |
| 账号     | `operator@ctjt.cn`；密码在服务器 `data/auth/orca-auth-bootstrap-credentials.json`（0600）                                                                 |
| 签名密钥 | `data/auth/orca-auth-signing-key.pem`（0600，**丢了 relay 的 JWKS 缓存会失配**）                                                                          |
| 对外地址 | 账号 + director = `https://orca.ctjt.cn`；relay cell = `https://c1.orca.ctjt.cn`（写死在 env **和** relay 库的 `relay_cells.cell_url`，改域名要两处都改） |

**重建镜像**（改完 auth 代码走一遍）：

```bash
# 本地：打包 cloud/（排除 node_modules/dist）
tar --exclude=node_modules --exclude=dist --exclude=.cache \
    --exclude='*.tsbuildinfo' -czf /tmp/orca-cloud-src.tar.gz -C cloud .
scp -P 2222 /tmp/orca-cloud-src.tar.gz root@192.168.10.13:/tmp/
# 服务器：解包 → 构建 → 重启
ssh -p 2222 root@192.168.10.13 'set -e
  rm -rf /opt/orca-cloud && mkdir -p /opt/orca-cloud
  tar -xzf /tmp/orca-cloud-src.tar.gz -C /opt/orca-cloud
  cd /opt/orca-cloud && docker build -f apps/auth/Dockerfile -t orca-cloud-auth:local .
  cd /opt/orca-deploy && set -a && . ./.env.domain && . ./.env && set +a     && docker compose -p orca up -d --force-recreate auth'
```

> `docker build` 末尾的构建上下文 `.` 不能省，否则 buildx 报 `requires 1 argument`。
>
> **`docker compose` 之前必须 `set -a && . ./.env.domain && . ./.env`**：
> 宿主机上的 `.env` 只有两个密钥，域名类的变量全在 `.env.domain` 里；
> 不加载的话 `docker compose` 会报 `required variable ORCA_AUTH_PUBLIC_URL is missing a value`。

**本地校验**（仓库外的临时目录，未入库）：

```bash
ORCA_BASE_URL="http://192.168.10.13:18080" ORCA_TEST_PASSWORD='<密码>' node verify-contract.ts
ORCA_BASE_URL="http://192.168.10.13:18080" ORCA_TEST_PASSWORD='<密码>' node verify.ts
```

---

## 2. 任务清单

图例：⬜ 未开始 · 🟡 进行中 · ✅ 完成 · ⛔ 外部依赖

### P0 — 阻塞"真的能用"

#### T-01 ✅ 阿里云 A 记录 + 证书：`c1.orca.ctjt.cn`

- **实测（2026-11-12）**：`c1.orca.ctjt.cn` → `113.106.112.17`，`https://c1.orca.ctjt.cn/health` 返回 200，
  网关为它单独签了证书（`CN=c1.orca.ctjt.cn`）。**cell 域名用两层子域，是 director 的子域**。
- **⚠ 换 cell 域名要改两处**： relay 的 `ORCA_RELAY_CELL_URL` 环境变量，**以及** relay 库里的
  `relay_cells.cell_url`（那一行被钉死，心跳发现不一致会抛 `cell_origin_mismatch`，
  `/v1/assign` 仍吐旧 origin —— 2026-11-12 实测踩过）。

#### T-02 ⛔ 网关 nginx 反代规则

- **内容**（在公网网关 113.106.112.17 上）：`server_name orca.ctjt.cn c1.orca.ctjt.cn;` → `proxy_pass http://192.168.10.13:18080;`
- **要点**：`proxy_http_version 1.1` + `Upgrade`/`Connection` 头（**必须有，否则 relay 的手机腿/桌面腿连不上**）；`proxy_read_timeout 900s`（relay 空闲 10 分钟）。
- **验收**：从公网 `curl https://orca.ctjt.cn/health` 返回 200；`wss://c1.orca.ctjt.cn/v1/connect/<hostId>` 能完成 WS 升级。
- **依赖**：外部（网关）；**依赖 T-01**。
- **🟡 2026-11-12 实测**：HTTP 部分已经通了（`/health`、`/auth/health`、`/v1/assign` 都正常），
  但**网关那条规则还缺 WebSocket 头**： 同一路径经内网边缘是 `101`，
  经公网网关是 `404`（被当成普通 GET 转给 relay，relay 没有对应路由）。
  手机腿（`/v1/connect/<hostId>`）与桌面腿（`/v1/host/control`）**现在都连不上**，
  两个域名都一样。 网关上加这四行即可：

  ```nginx
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_read_timeout 900s;
  ```

#### T-03 ✅ 桌面端 UI 登录

- **内容**：用真实 Electron 应用跑一次完整登录（浏览器点登录 → 302 回 `127.0.0.1:<随机端口>/auth/callback`）。
- **命令**：
  ```bash
  ORCA_BACKGROUND_LAUNCH=1 ORCA_CLOUD_API_URL=https://orca.ctjt.cn ORCA_CLOUD_CLIENT_ID=orca-desktop   ORCA_RELAY_URL=https://orca.ctjt.cn pnpm dev
  ```
- **实测**（2026-11-12）：应用内点「设置 → Orca 账户 → 登录 Orca」→ 应用起回环监听
  `127.0.0.1:<随机端口>/auth/callback` 并打开 `https://orca.ctjt.cn/v1/desktop/auth/authorize?...`
  （`client_id=orca-desktop`、S256 challenge、nonce、state 齐全）→ 真实 Chrome 填账号密码提交 →
  应用收到回调并完成换 token。
- **验收**：应用内账号态 `connected`、`operator@ctjt.cn`、**`capabilities.flags['relay.use'] === true`**。
- **依赖**：T-01、T-02（实际只需要 director 这一个 origin，见下面的复核说明）。
- **⚠ 踩坑**：Chrome 会把「从公网 origin 跳到 127.0.0.1」这次导航判为本地网络访问，headless 下直接
  `ERR_ABORTED`（服务端 `login.succeeded` 已记录，但应用收不到回调）。有头浏览器一般会弹权限询问；
  自动化时用 `--disable-features=LocalNetworkAccessChecks` 或让重定向走请求层。**真机配对（T-04）同理要留意**。

#### T-04 ⬜ 真机配对（手机腿 + E2EE 握手）

- **内容**：桌面 `relay-session-broker.createPairingRelay()` 拿到 `inviteToken` → 生成 `orca://pair?code=…` → 手机连 `wss://c1.orca.ctjt.cn/v1/connect/{relayHostId}` → `relay-auth` → `relay-hello` → host-challenge/ack → conn-open → E2EE 数据。
- **已验证的边界**：WS 升级与 token 鉴权（有效 token → 101，无效 token → 401）。**E2EE 握手与手机 App 尚未验证。**
- **验收**：手机端能连上并看到桌面会话；数据走加密通道。
- **依赖**：T-03。

### P1 — 生产化必需

#### T-05 🔴 网关→内网这一跳是明文 HTTP

- **现状**：18080 是纯 HTTP，**登录密码、access token、refresh token 在隧道里是明文**。
- **方案 A（推荐）**：隧道自身加密（frp `transport.tls`），服务端不用改。
- **方案 B**：内网再开一个 TLS 端口（此前撤掉的 443 可加回，自签证书 + 网关 `proxy_ssl_verify off`）。
- **验收**：抓包确认隧道内看不到明文 password。
- **备注**：唯一一个"现在就在裸奔"的项，优先级高于其余 P1。

#### T-06 ✅ 部署配置纳入版本库

- **产出**：`cloud/apps/auth/deploy/` —— `docker-compose.yml` / `nginx.conf` / `routing.inc` / `.env.example` / `RUNBOOK.md`，**不含任何密钥**（`.env` 与 `data/` 被 `cloud/.gitignore` 挡掉）。
- **验收**：新人照 RUNBOOK 能一条命令拉起服务。
- **顺带修的两处**：
  - 边缘把 `X-Forwarded-For` 改成 `$remote_addr`（覆盖客户端自带的头）。原来的 `$proxy_add_x_forwarded_for` 会把客户端伪造的头留在第一位，**登录限流的「来源 IP」维度可以被伪造而形同虚设**。
  - 账号服务自己的 `/health` `/ready` 被 relay 的兜底路由吃掉了，新增 `/auth/health` `/auth/ready` 两个前缀，监控才能分别盯两个服务。

#### T-07 ✅ 登录限流落库

- **产出**：`auth_login_attempts` 表 + `login-attempt-store.ts`（替换原来的内存 `login-attempt-limiter.ts`）。计数、封禁、清零全部走数据库，在事务内完成。
- **验收**：实测通过 —— 10 次错误口令后返回 429；**重启容器后仍然是 429**（封禁不失效）。
- **已知边界**：网关没有透传真实客户端 IP，所以诚实流量在服务侧看到的是网关地址，**IP 维度实际是「整个网关」的闸门**，账号维度才是精确到人的那道闸。

#### T-08 ✅ 审计事件

- **产出**：`auth_audit_events` 表 + `audit-log.ts`。事件类型：`login.succeeded` / `login.failed` / `login.blocked` / `session.issued` / `session.refreshed` / `session.revoked` / `relay_token.issued` / `profile.created` / `organization.changed`。
- **检索**：`GET /v1/desktop/auth/audit-events`（带 Bearer），只返回调用者自己的事件，支持 `since` / `until` / `limit`。
- **不写敏感值**：detail 里名字像凭据的键（token / password / secret / authorization / cookie / code_verifier / private）一律替换成 `[redacted]`，落库与日志都是替换后的版本。

#### T-09 ✅ 真实 PostgreSQL

- **产出**：`cloud/apps/auth/src/postgres-auth.test.ts` —— 同一套契约（登录 → `/session` → `/capabilities` → 限流落库 → 审计落库）在 PG 上跑；CI 的 `test` job 已经有 `postgres:16-alpine` 服务与 `ORCA_CLOUD_DATABASE_TEST_URL`，所以这条路径在 CI 里也会跑。
- **实测**：PG 16 上建表（15 条语句全部执行）、同一套契约检查通过；`BIGINT` 在 PG 下以字符串返回，读数路径已兼容。
- **现状**：**生产仍然跑 SQLite**（`ORCA_AUTH_DATABASE_URL` 为空）。切 PG 只需改环境变量并把 `data/` 里的 SQLite 库迁过去。

#### T-10 ✅ CI 补 auth 的容器扫描

- **改动**：`.github/workflows/cloud-verify.yml` 的容器扫描 matrix 从 `[relay, push]` 变成 `[relay, push, auth]`。
- **验证**：CI 里那条 "Smoke test the nonroot Node runtime" 在本地对 auth 镜像实跑通过（非 root、无 npm/pnpm、`apps/auth/dist/app.js` 可导入）。
- **待确认**：Trivy 扫描要等 CI 跑完才知道有没有可修复的高危（本地与内网服务器都没有 Trivy）。

### P2 — 功能补全（按需）

#### T-11 ⬜ 账号管理

- **现状**：只有 bootstrap 一个账号；**没有注册 / 改密码 / 找回密码 / 邀请成员**。
- **最低要求**：管理员建号 + 用户改密码。

#### T-12 ⬜ 三个明确 501 的口子

| 端点 / 能力                             | 现状     | 说明                                                                                                         |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `POST /v1/desktop/auth/connector-token` | 501      | 官方桌面端的 connector 功能不可用                                                                            |
| 组织成员写操作 ×4                       | 501      | 成员增删改、邀请                                                                                             |
| 推送网关                                | 不可自建 | 需要 APNs/FCM 凭证；后果是**桌面退出登录后手机配对降级为 local-only**（`mobile-pairing-connection-mode.ts`） |

#### T-13 ⬜ 可选增强

- 多实例 / 水平扩展时 session 与限流走共享存储。
- `/health`、`/ready` 已就绪，可接监控告警。
- 镜像 tag 现在是 `:local`，生产要打版本号。

---

## 3. 刻意不做的事

- **不要给 cell 补 director 库登记**（`/v1/regions` 保持为空）： 目录一旦非空，区域探测可能抛错
  （被上层 catch，只丢区域偏好，不影响配对）。 现在的 cell 域名 `c1.orca.ctjt.cn` **是** director 的子域，
  桌面端的来源归属校验（`relay-region-catalog-fetch.ts:74-76`）本来就能过，
  但空目录仍然最稳 —— 合并角色没有自登记，区域偏好退化成默认值。
- **不要在仓库里提交任何密钥**：会话密钥、ES256 私钥、阿里云 AccessKey、账号密码一律留在服务器（0600 文件）或环境变量。

---

## 4. 推进约定

1. 开会话先读本文件与设计文档，确认状态表与任务勾选。
2. 领一个任务（优先 P0 → P1），把状态改成 🟡。
3. 改代码 → 本地跑测试与类型检查 → 部署到 192.168.10.13 → 用 `verify-contract.ts` / `verify.ts` 复测。
4. 通过后勾选任务、在下方「推进记录」追加一行、提交（conventional commit，不 push，等用户明确要求再 push）。
5. 任务需要改动对外地址或端口时，**先更新第 1 节的状态表与交接信息**，再改代码。

### 推进记录

| 日期       | 任务                                                                                     | 结果                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-12 | 实现 auth 服务骨架 + 内网部署 + 契约验证                                                 | 21 项契约全过；桌面端真实客户端代码与 relay WS 腿验证通过；域名方案落定（网关终结 TLS，内网 18080）                                                                                        |
| 2026-11-12 | P1 批量：T-06 部署配置入库 / T-07 限流落库 / T-08 审计事件 / T-09 真实 PG / T-10 CI 扫描 | 全部实装并部署；重启后封禁仍生效（实测 429）；PG 16 上同一套契约跑通；边缘改覆盖 `X-Forwarded-For`（原来可被客户端伪造）；新增 `/auth/health`                                              |
| 2026-11-12 | T-03 桌面端 UI 登录                                                                      | 真实 Electron 应用 + 真实 Chrome 走完 PKCE 登录；应用内账号态 `connected`，`relay.use === true`。发现 Chrome 对「公网 → 127.0.0.1」跳转的本地网络访问限制                                  |
| 2026-11-12 | cell 域名换成 `c1.orca.ctjt.cn`                                                          | DNS + 证书 + 网关路由都通了；relay 的 `ORCA_RELAY_CELL_URL` 与库里 `relay_cells.cell_url` 两处都改了，`/v1/assign` 现在返回新 origin。**遗留：网关缺 WebSocket 头，手机腿/桌面腿仍连不上** |
