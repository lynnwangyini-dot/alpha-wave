# 部署到自定义域名指南

本项目是 **100% 纯前端** Web 应用：
- 音频分析 → 浏览器 Web Audio API
- 音乐生成 → 浏览器 OscillatorNode + BiquadFilter 程序化合成
- 能量曲线 → 客户端 RMS
- 下载 → 客户端 OfflineAudioContext 烘焙 WAV
- 双耳节拍 → 客户端左右声道分离

**没有任何后端 API 调用**，所以部署极其简单。

---

## 方案 A：一键部署到 Vercel（推荐，5 分钟）

### 1. 准备工作
- ✅ 域名（已买，DNS 在 Cloudflare / 阿里云 / 腾讯云 均可）
- ✅ GitHub 账号
- ✅ Vercel 账号（GitHub 登录即可）

### 2. 推送代码到 GitHub
```bash
git init
git add .
git commit -m "feat: alpha wave music generator"
git branch -M main
git remote add origin https://github.com/<your-username>/alpha-wave.git
git push -u origin main
```

### 3. 在 Vercel 导入
1. 打开 https://vercel.com/new
2. 选择 `alpha-wave` 仓库
3. Framework Preset 自动识别为 Next.js，**直接 Deploy**
4. 等待 1-2 分钟构建完成，得到 `xxx.vercel.app` 默认域名

### 4. 绑定自定义域名
1. Vercel 项目 → Settings → Domains
2. 输入你的域名（如 `alpha.mydomain.com`）
3. Vercel 会显示需要添加的 DNS 记录
4. 到你的 DNS 服务商添加：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| CNAME | alpha | cname.vercel-dns.com |

5. 等 1-10 分钟生效，HTTPS 自动签发

### 5. 修改 next.config.ts
部署完成后，把 `allowedDevOrigins` 改为你的域名：
```ts
allowedDevOrigins: ['alpha.mydomain.com', '*.mydomain.com'],
```

---

## 方案 B：自有服务器 + Docker

### 1. 服务器准备
- 阿里云 / 腾讯云 / AWS 任选，**至少 1 核 1GB** 内存
- 系统：Ubuntu 22.04+ / Debian 11+
- 已装 Docker + Docker Compose

### 2. 上传代码并构建
```bash
# 服务器上
git clone https://github.com/<your-username>/alpha-wave.git
cd alpha-wave

# 修改 next.config.ts：output: 'standalone' 模式
# （用于减小 Docker 镜像）

# 构建并启动
docker build -t alpha-wave .
docker run -d --name alpha-wave -p 3000:3000 --restart unless-stopped alpha-wave
```

### 3. 反向代理 + HTTPS（Nginx + Certbot）
```nginx
# /etc/nginx/sites-available/alpha
server {
    server_name alpha.mydomain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/alpha /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d alpha.mydomain.com
```

### 4. DNS 解析
- `A` 记录：`alpha` → 服务器公网 IP
- 等 1-10 分钟生效

---

## 方案 C：Cloudflare Pages

### 1. 在 Cloudflare 控制台
- Pages → Create application → Connect to Git
- 选择仓库
- Build command: `pnpm run build`
- Build output: `.next`

### 2. 绑定域名
- Custom domains → Set up a custom domain
- 如果域名已在 Cloudflare，自动签发证书

---

## 常见问题

### Q: 部署后访问报错"Blocked request. This host is not allowed"？
A: 需要在 `next.config.ts` 的 `allowedDevOrigins` 中加入你的域名。

### Q: 国内访问 Vercel 太慢？
A: 选 Vercel `hkg1` 区域（已在 vercel.json 配置），或用方案 B 自建国内服务器。

### Q: 想用国内备案域名？
A: 必须用方案 B（自有服务器），Vercel/Cloudflare 都不能绑未备案的 cn 域名。

### Q: 流量大要收费吗？
A: Vercel 免费版每月 100GB 流量，个人项目绰绰有余。Cloudflare Pages 完全免费。
