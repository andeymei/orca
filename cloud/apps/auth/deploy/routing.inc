# 共享的路径分流：账号服务与 relay 共用同一个端口，靠路径区分。
# 放在 server 块里 include。

# 账号服务：PKCE 登录、换 token、relay token
location /v1/desktop/ {
    proxy_pass http://orca_auth;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    # 边缘是可信边界：覆盖掉客户端自带的 X-Forwarded-For，
    # 否则登录限流的「来源 IP」维度可以被伪造而形同虚设。
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 60s;
}

location /.well-known/jwks.json {
    proxy_pass http://orca_auth;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}

# 账号服务自己的健康检查。/health 与 /ready 被 relay 的兜底路由占着，
# 所以这里单开一个前缀，监控才能分别盯住两个服务。
location = /auth/health {
    proxy_pass http://orca_auth/health;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}

location = /auth/ready {
    proxy_pass http://orca_auth/ready;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}

# Relay：分配、区域目录、WebSocket（手机腿与桌面腿）
location / {
    proxy_pass http://orca_relay;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # relay 的空闲超时是 10 分钟，这里留出余量
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
}
