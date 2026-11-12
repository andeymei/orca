# 自建 Orca Cloud 运行手册

本目录是 `cloud/apps/auth`（账号服务）与 `cloud/apps/relay`（relay）的一体化部署包：
三个容器 —— `orca-auth-1` / `orca-relay-1` / `orca-edge-1` —— 共用宿主机的**一个**端口。

- 账号服务与 relay 契约：[`docs/self-hosted-orca-cloud-design.md`](../../../docs/self-hosted-orca-cloud-design.md)
- 任务台账：[`docs/self-hosted-orca-cloud-tasks.md`](../../../docs/self-hosted-orca-cloud-tasks.md)

## 拓扑

```
公网客户端 ──https──▶ 公网网关 113.106.112.17（TLS 终结，*.ctjt.cn 泛域名证书）
                          │  http（内网）
                          ▼
                 边缘容器 :18080 ──┬──▶ auth:8080   /v1/desktop/*  /.well-known/jwks.json
                                  └──▶ relay:8080  /v1/assign  /v1/regions  /v1/connect/*
```

**TLS 在网关终结**：内网这一段是纯 HTTP，所以账号密码、access token、refresh token 在隧道里
是明文。要加密这一段，见任务台账 T-05（frp `transport.tls` 或内网再开一个 TLS 端口）。

**网关那条 server 规则必须带 WebSocket 头**，否则 relay 的手机腿/桌面腿连不上：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_read_timeout 900s;   # relay 空闲 10 分钟
```

## 前提

- Linux 宿主机 + Docker + Docker Compose v2
- 两个域名解析到网关，且都在网关证书覆盖范围内（`*.ctjt.cn` 只覆盖一层子域）
- 网关上已配好反代：`server_name <director> <cell>;` → `proxy_pass http://<内网IP>:18080;`

## 首次拉起

```bash
cd deploy
cp .env.example .env
# 填 .env：两个密钥 + 域名 + 账号
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

容器镜像需要先构建（构建上下文是 `cloud/` 目录）：

```bash
cd ../..                       # cloud/
docker build -f apps/auth/Dockerfile  -t orca-cloud-auth:local  .
docker build -f apps/relay/Dockerfile -t orca-cloud-relay:local .
```

## 密钥与数据

| 位置                            | 内容                     | 权限   |
| ------------------------------- | ------------------------ | ------ |
| `data/auth/`                    | ES256 签名私钥、session 密钥、SQLite 库 | 0700 |
| `data/auth/orca-auth-signing-key.pem` | **签名私钥**；丢了 relay 缓存的 JWKS 会失配 | 0600 |
| `data/auth/orca-auth-bootstrap-credentials.json` | 首次播种的账号密码 | 0600 |
| `data/relay/`                   | relay 的分配与邀请数据   | 0700   |

**`data/` 目录永远不进版本库**，也永远不要在重建镜像时删掉。

## 验证

```bash
# 健康检查：/health 与 /ready 归 relay，账号服务走 /auth/health 与 /auth/ready
curl -s http://127.0.0.1:18080/health          # relay
curl -s http://127.0.0.1:18080/auth/health     # 账号服务
curl -s http://127.0.0.1:18080/auth/ready      # 账号服务（探数据库）

# 公网侧
curl -s https://orca.ctjt.cn/health
curl -s https://orca.ctjt.cn/auth/health
curl -s https://orca.ctjt.cn/.well-known/jwks.json

# 登录页能渲染（返回 HTML 表单，不是 400）
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://orca.ctjt.cn/v1/desktop/auth/authorize?client_id=orca-desktop&response_type=code&redirect_uri=http://127.0.0.1:55999/auth/callback&scope=openid+profile+email+offline_access&nonce=n&state=s&code_challenge=abc&code_challenge_method=S256'
```

区域目录 `/v1/regions` **应当返回空数组**：合并角色的 relay 不自我登记，
非空目录会让桌面端的区域探测抛错（`relay probe origin does not belong to the director`）。

## 升级

改完 `cloud/` 里的代码后重建镜像并重启，**不要删 `data/`**：

```bash
cd ../..
docker build -f apps/auth/Dockerfile -t orca-cloud-auth:local .
cd deploy && docker compose --env-file .env up -d --force-recreate auth
```

> `docker build` 末尾的构建上下文 `.` 不能省，否则 buildx 报 `requires 1 argument`。

## 排障

| 现象                             | 原因                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| 桌面端提示 "Orca Cloud sign-in is not configured for this build." | `ORCA_CLOUD_API_URL` 不是 https（打包版只允许 https，loopback 除外） |
| 登录页 400                        | `client_id` / `redirect_uri` / `code_challenge` 不合规                |
| 手机连不上 relay                   | 网关反代缺 WebSocket 头，或 `ORCA_RELAY_CELL_URL` 的域名解析不了     |
| relay 报验签失败                  | auth 的签名私钥换了，relay 缓存的 JWKS 还没刷新                       |
| 429 too many sign-in attempts    | 登录限流已触发（账号 + 来源 IP 两个维度，计数落库，重启不清零）      |
