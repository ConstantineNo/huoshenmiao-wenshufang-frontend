# Cloud Print Web

远程前端客户端。

职责：

- 模板管理入口
- 业务录入与打印发起
- 目标节点与打印机选择
- 打印任务状态查看

当前阶段目标：

- 先建立最小 Vite + React + TypeScript 骨架
- 后续按 docs 仓中的云边端 CONTRACT 对接 REST API

部署策略：

- 运行环境为 Linux 服务器上的静态文件目录
- CI/CD 通过 GitHub Actions 先上传当前仓库源码，再通过 SSH 在服务器执行构建与发布脚本
- 服务器静态文件服务建议使用 Nginx
- 当前生产域名固定为 print.1to.top
- HTTPS 证书通过 certbot 自动申请与续期
- Nginx 最大上传限制固定为 100m
- 服务器 Node.js 版本需满足 Vite 要求，建议固定为 Node 22 LTS

开发启动建议：

```powershell
npm install
npm run dev
```

本地环境说明：

- 当前工作区的前端 npm / Vite 构建与排查默认在 Windows PowerShell 中执行。
- 现有 WSL 环境因历史原因仍保留较旧系统与 Node.js / npm 版本，不作为 cloud-print-web 的主验证环境。

服务端部署入口：

- scripts/deploy_static.sh
- deploy/runtime/cloud-print-web.env.example
- deploy/nginx/cloud-print-web.conf

首次部署说明：

- deploy job 不再要求服务器上的 DEPLOY_PATH 预先是一个 git 仓库。
- GitHub Actions 会先把当前仓库源码上传到 DEPLOY_PATH，再由服务器本地执行 npm 构建、Nginx 配置刷新和 certbot 申请证书。

