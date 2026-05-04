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
- 当前已接入最小管理员登录入口，可调用 backend 的 `/api/v1/auth/admin/login` 并在浏览器持久化登录态

部署策略：

- 运行环境为 Linux 服务器上的静态文件目录
- CI/CD 通过 GitHub Actions 先在 Runner 中构建 dist，再把产物与部署脚本上传到服务器执行发布
- 服务器静态文件服务建议使用 Nginx
- 当前生产域名固定为 print.1to.top
- HTTPS 证书通过 certbot 自动申请与续期
- Nginx 最大上传限制固定为 100m
- 服务器不再承担 npm / Vite 构建，因此不再要求部署机具备满足 Vite 的 Node.js 版本

开发启动建议：

```powershell
npm install
npm run dev
```

本地环境说明：

- 当前工作区的前端 npm / Vite 构建与排查默认在 Windows PowerShell 中执行。
- 现有 WSL 环境因历史原因仍保留较旧系统与 Node.js / npm 版本，不作为 cloud-print-web 的主验证环境。

当前 Web 入口状态：

- 已提供管理员登录页。
- 登录成功后会把 access token、管理员资料与 API Base URL 持久化到浏览器 localStorage。
- 页面刷新后会自动恢复最近一次管理员登录态。
- 登录后的管理台当前已接入模板上传表单和模板列表，可直接验证 Web 到 backend 的第一段业务链路。
- 当前登录页默认测试管理员示例为 `admin_test / Test123456!`，实际可用值仍以服务器真实 env 中的 bootstrap admin 配置为准。

服务端部署入口：

- scripts/deploy_static.sh
- deploy/runtime/cloud-print-web.env.example
- deploy/nginx/cloud-print-web.conf

首次部署说明：

- deploy job 不再要求服务器上的 DEPLOY_PATH 预先是一个 git 仓库。
- GitHub Actions 会先把 dist 产物与部署脚本上传到 DEPLOY_PATH，再由服务器执行静态发布、Nginx 配置刷新和 certbot 申请证书。
- 当前部署机至少需要：nginx、certbot、rsync，以及目标目录写权限。
- 当前部署机若把静态目录设在 `/var/www/...`，部署用户需要具备无密码 sudo 能力，因为发布过程会写入该目录并刷新 Nginx。
- `deploy/runtime/cloud-print-web.env` 必须由人工提前创建，脚本不再自动从示例文件复制默认值，以避免用错误默认配置直接上线。

