Pixiv Cron Worker
=================

Cloudflare Workers 定时触发器，用于调度 Pixiv 爬虫集群：

- 每 10 分钟：调用主节点首页爬虫获取 `pids`，随机选取 N 个 PID（N 为从节点数量），向各从节点分发单次爬取任务
- 每天 01:00：触发主节点每日榜单
- 每周一 01:00：触发主节点周榜
- 每月 1 号 01:00：触发主节点月榜

目录结构
--------

- `wrangler.toml`: Workers 配置与 CRON 计划
- `src/index.ts`: 任务路由与分发逻辑
- `package.json`: 本地开发与部署脚本（wrangler）

环境变量（wrangler.toml 中 [vars]）
-----------------------------------

- `PRIMARY_API_BASE`: 主节点 API 基础地址（如 `https://pixiv.chaosyn.com/api`）
- `WORKER_API_BASES`: 从节点 API 列表，逗号分隔（如 `https://node1.example.com/api,https://node2.example.com/api`）
- `TEN_MIN_TARGET_NUM`: 10 分钟任务分发的单次目标爬取数量（默认 100）
- `TEN_MIN_THRESHOLD`: 已废弃为强约束，仅向后兼容传参（默认 0.22）

运行与部署
----------

1) 本地预览

```bash
npm i
npm run dev
```

2) 部署 Workers

```bash
npm run deploy
```

注意事项
--------

- 10 分钟任务依赖主节点 `/?action=home` 返回 `pids` 列表
- 分发策略为随机均衡：随机选取与从节点数量相同的 PID，逐一发送到对应从节点 `POST /`（单次 PID 爬取）
- 主节点负责日/周/月榜任务触发，结果入库至主数据库

