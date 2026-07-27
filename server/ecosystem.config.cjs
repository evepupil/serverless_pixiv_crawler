// pm2 进程配置：同时管理 TS 主服务 + Python 微信服务，一并启动。
//
// 用法（在 server/ 目录执行）：
//   npm run build                  // 先构建 TS 主服务
//   pm2 start ecosystem.config.cjs // 拉起两个进程
//   pm2 save && pm2 startup        // 开机自启
//   pm2 logs                       // 查看日志
//   pm2 status                     // 查看状态
//
// 两个进程都从 server/.env.local 读取环境变量（下方自动解析注入）。
// TS 主服务需要发图文时，HTTP 调本地 http://127.0.0.1:3004/publish（带 X-API-Key）。

const fs = require('fs');
const path = require('path');

// 自己解析 .env.local，不依赖 dotenv（pm2 全局环境未必装得了）
function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const envLocal = loadEnvFile(path.join(__dirname, '.env.local'));

module.exports = {
  apps: [
    {
      name: 'pixiv-server',
      script: 'dist/index.js',
      cwd: __dirname,
      env: { ...envLocal, NODE_ENV: 'production' },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
    },
    {
      name: 'wx-server',
      // 如系统里是 python 而非 python3，改成 'python'
      interpreter: 'python3',
      script: 'automation/wx/main.py',
      cwd: __dirname,
      env: { ...envLocal },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
    },
  ],
};
