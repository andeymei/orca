# 自建 Orca Cloud — 任务清单

配套文档：[`self-hosted-orca-cloud-design.md`](./self-hosted-orca-cloud-design.md)（规格与设计取舍）。

本文件是**执行台账**：每次会话从这里领任务、完成后勾选并提交。设计文档保持稳定，本文件随进度演进。

---

## 1. 当前状态

| 项                                              | 状态                                      |
| ----------------------------------------------- | ----------------------------------------- |
| auth 服务（`cloud/apps/auth`）                  | ✅ 已实现并部署，契约检查 21 项全过       |
| relay（`cloud/apps/relay`，上游开源）           | ✅ 已部署并对接，director + cell 合并角色 |
| 内网部署（192.168.10.13:18080）                 | ✅ 已上线，三容器运行中                   |
| 桌面端脚本级链路（真实客户端代码打真实服务）    | ✅ 已验证                                 |
| relay WebSocket 腿（升级 + token 鉴权）         | ✅ 已验证                                 |
| 桌面端 UI 登录                                  | ⬜ 未做                                   |
| 真机配对（手机腿 + E2EE 握手）                  | ⬜ 未做                                   |
| 域名（`orca.ctjt.cn` / `c1.ctjt.cn`）与网关反代 | ⬜ 等外部配置                             |

### 交接信息

| 项       | 值                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| 服务入口 | `192.168.10.13:18080`（唯一对外，**纯 HTTP**；TLS 由公网网关 113.106.112.17 终结）                                      |
| SSH      | `ssh -p 2222 root@192.168.10.13`（22 端口不通）                                                                         |
| 部署目录 | `/opt/orca-deploy`（compose + `nginx.conf` + `routing.inc` + `tls/` + `data/`），源码副本 `/opt/orca-cloud`             |
| 容器     | `orca-auth-1` / `orca-relay-1` / `orca-edge-1`                                                                          |
| 账号     | `operator@ctjt.cn`；密码在服务器 `data/auth/orca-auth-bootstrap-credentials.json`（0600）                               |
| 签名密钥 | `data/auth/orca-auth-signing-key.pem`（0600，**丢了 relay 的 JWKS 缓存会失配**）                                        |
| 对外地址 | 账号 + director = `https://orca.ctjt.cn`；relay cell = `https://c1.ctjt.cn`（写死在 env，域名改名要改环境变量重建容器） |

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
  cd /opt/orca-deploy && docker compose -p orca up -d --force-recreate auth'
```

> `docker build` 末尾的构建上下文 `.` 不能省，否则 buildx 报 `requires 1 argument`。

**本地校验**（仓库外的临时目录，未入库）：

```bash
ORCA_BASE_URL="http://192.168.10.13:18080" ORCA_TEST_PASSWORD='<密码>' node verify-contract.ts
ORCA_BASE_URL="http://192.168.10.13:18080" ORCA_TEST_PASSWORD='<密码>' node verify.ts
```

---

## 2. 任务清单

图例：⬜ 未开始 · 🟡 进行中 · ✅ 完成 · ⛔ 外部依赖

### P0 — 阻塞"真的能用"

#### T-01 ⛔ 阿里云 A 记录：`c1.ctjt.cn`

- **内容**：加 A 记录 `c1.ctjt.cn` → `113.106.112.17`。`orca.ctjt.cn` 已存在，**cell 域名目前解析不了**。
- **验收**：`dig +short c1.ctjt.cn` 返回 `113.106.112.17`。
- **依赖**：外部（DNS 面板）。

#### T-02 ⛔ 网关 nginx 反代规则

- **内容**（在公网网关 113.106.112.17 上）：`server_name orca.ctjt.cn c1.ctjt.cn;` → `proxy_pass http://192.168.10.13:18080;`
- **要点**：`proxy_http_version 1.1` + `Upgrade`/`Connection` 头（**必须有，否则 relay 的手机腿/桌面腿连不上**）；`proxy_read_timeout 900s`（relay 空闲 10 分钟）。
- **验收**：从公网 `curl https://orca.ctjt.cn/health` 返回 200；`wss://c1.ctjt.cn/v1/connect/<hostId>` 能完成 WS 升级。
- **依赖**：外部（网关）；**依赖 T-01**。

#### T-03 ⬜ 桌面端 UI 登录

- **内容**：用真实 Electron 应用跑一次完整登录（浏览器点登录 → 302 回 `127.0.0.1:<随机端口>/auth/callback`）。
- **命令**：
  ```bash
  ORCA_CLOUD_API_URL=https://orca.ctjt.cn ORCA_CLOUD_CLIENT_ID=orca-desktop \
  ORCA_RELAY_URL=https://orca.ctjt.cn pnpm dev
  ```
- **验收**：应用内账号态为已登录；`capabilities.flags['relay.use'] === true`。
- **依赖**：T-01、T-02。

#### T-04 ⬜ 真机配对（手机腿 + E2EE 握手）

- **内容**：桌面 `relay-session-broker.createPairingRelay()` 拿到 `inviteToken` → 生成 `orca://pair?code=…` → 手机连 `wss://c1.ctjt.cn/v1/connect/{relayHostId}` → `relay-auth` → `relay-hello` → host-challenge/ack → conn-open → E2EE 数据。
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

#### T-06 ⬜ 部署配置纳入版本库

- **现状**：compose / `nginx.conf` / `routing.inc` / 切换脚本 / RUNBOOK 只存在服务器 `/opt/orca-deploy` 与本地临时目录，**仓库里没有**。
- **取舍**：上游惯例是把 deployment 配置放私有 repo（`cloud/README.md:66-68`）。要么照惯例，要么把**不含密钥**的部分放进 `cloud/apps/auth/deploy/`。
- **验收**：新人照 README 能一条命令拉起服务。

#### T-07 ⬜ 登录限流落库

- **现状**：`login-attempt-limiter.ts` 用内存 `Map` 计数，注释明写 "resets on restart" → 重启即可绕过。
- **内容**：改为落库（`auth_login_attempts` 表）或 IP 维度走共享存储。
- **验收**：重启服务后封禁不失效。

#### T-08 ⬜ 审计事件

- **现状**：只有 3 行 console 输出，登录成功/失败、token 签发、登出、组织变更都没有记录。
- **内容**：`auth_audit_events` 表 + 结构化日志。**禁止把 token / 密码写进日志。**
- **验收**：能按用户与时间检索登录与令牌事件。

#### T-09 ⬜ 真实 PostgreSQL

- **现状**：跑的是 SQLite。SQL 已按 PG 方言审查（别名避开 `user` 等保留字、BIGINT 读数兼容），**但没实跑**。
- **内容**：PG 16/17 上建表 + 全量测试 + `/session`、`/capabilities` 真连一次。
- **验收**：PG 环境跑通同一套契约检查。

#### T-10 ⬜ CI 补 auth 的容器扫描

- **现状**：`.github/workflows/cloud-verify.yml` 已对整个 cloud workspace 跑 `build`/`typecheck`/`test` ✓，但容器安全扫描 matrix 是 `app: [relay, push]`，**auth 没进扫描**。
- **验收**：`apps/auth` 进 matrix，Trivy 扫描无高危。

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

- **不要给 cell 补 director 库登记**（`/v1/regions` 保持为空）：`c1.ctjt.cn` 不是 `orca.ctjt.cn` 的子域，桌面端会校验探测来源主机名以 `.${director 主机名}` 结尾（`relay-region-catalog-fetch.ts:74-76`）。目录一旦非空，区域探测会抛错（被上层 catch，只丢区域偏好，不影响配对）。空目录反而最稳。
- **不要在仓库里提交任何密钥**：会话密钥、ES256 私钥、阿里云 AccessKey、账号密码一律留在服务器（0600 文件）或环境变量。

---

## 4. 推进约定

1. 开会话先读本文件与设计文档，确认状态表与任务勾选。
2. 领一个任务（优先 P0 → P1），把状态改成 🟡。
3. 改代码 → 本地跑测试与类型检查 → 部署到 192.168.10.13 → 用 `verify-contract.ts` / `verify.ts` 复测。
4. 通过后勾选任务、在下方「推进记录」追加一行、提交（conventional commit，不 push，等用户明确要求再 push）。
5. 任务需要改动对外地址或端口时，**先更新第 1 节的状态表与交接信息**，再改代码。

### 推进记录

| 日期       | 任务                                     | 结果                                                                                                |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 2026-11-12 | 实现 auth 服务骨架 + 内网部署 + 契约验证 | 21 项契约全过；桌面端真实客户端代码与 relay WS 腿验证通过；域名方案落定（网关终结 TLS，内网 18080） |
