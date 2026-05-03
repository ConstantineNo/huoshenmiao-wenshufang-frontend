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
- CI/CD 通过 GitHub Actions 触发 SSH 到服务器执行构建与发布脚本
- 服务器静态文件服务建议使用 Nginx

开发启动建议：

```powershell
npm install
npm run dev
```

服务端部署入口：

- scripts/deploy_static.sh
- deploy/runtime/cloud-print-web.env.example
- deploy/nginx/cloud-print-web.conf

