# 微信公众号自动化服务

把一组图片发成微信公众号图文草稿（可选直接发布）的 HTTP 服务。作为 `serverless_pixiv_crawler` 的子项目，与 TS 主服务一并部署在同一台服务器上，**解决微信 IP 白名单需要固定出口 IP 的问题**——所有微信 API 调用都从这台机器出去，白名单只需配一个 IP。

## 它解决什么

- 发图文要调微信开放平台 API，而 API 要求调用方 IP 在白名单里
- 云函数 / 多出口 IP 没法稳定加白
- 把这个服务固定部署在一台机器上，微信只认这台机器的 IP

## 特性

- **全流程**：access_token → 封面永久素材 → 正文图压缩上传 → 建草稿 → 可选提交发布
- **token 稳**：用 `stable_token` + 进程内/文件双层缓存，遇 `40001` 自动强刷重试，避免并发刷新互踩
- **正文图自动压缩**：`media/uploadimg` 单图限 1MB，服务自动压到 1MB 内再传
- **多账号**：`accounts.json` 管理多个公众号
- **模板化正文**：content 抽成独立模板（`wx/templates/*.html`），默认沿用秀米风格（关注引导 + 底部免责声明），支持 `{{INTRO}}`/`{{IMAGES}}` 占位，调用时可指定模板
- **HTTP 服务**：FastAPI，`X-API-Key` 鉴权（与主服务风格一致），默认只绑 127.0.0.1
- **一并启动**：pm2 同时拉起 TS 主服务 + 本服务

## 目录结构

```
server/automation/wx/
├── README.md                # 本文档
├── requirements.txt          # fastapi, uvicorn, requests, Pillow
├── accounts.example.json     # 账号配置模板
├── accounts.json             # 实际配置（自己建，已 gitignore）
├── .gitignore
├── main.py                   # uvicorn 启动入口
├── wx/                       # Python 包
│   ├── __init__.py           # 导出
│   ├── errors.py             # 异常 + 错误码
│   ├── types.py              # dataclass
│   ├── config.py             # 环境变量 + accounts.json 加载
│   ├── token_manager.py      # stable_token + 缓存 + 重试
│   ├── image.py              # 正文图压缩到 ≤1MB
│   ├── content.py            # content HTML 拼装
│   ├── client.py             # WeixinClient：微信 API 封装
│   ├── service.py            # publish_article 一键编排
│   ├── api.py                # FastAPI 路由
│   └── templates/
│       └── default.html      # 正文模板（秀米风格，{{INTRO}}/{{IMAGES}} 占位）
└── examples/
    └── client_demo.py        # 调用示例
```

## 快速开始

### 1. 安装依赖

```bash
cd server/automation/wx
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. 配置公众号账号

```bash
cp accounts.example.json accounts.json
```

编辑 `accounts.json`，填入真实 `appid` / `secret`：

```json
{
  "accounts": [
    {
      "name": "demo_mp",
      "appid": "你的appid",
      "secret": "你的secret",
      "author": "编辑部",
      "title_template": "每日萌图 {date}",
      "digest": "喜欢的话就点个在看吧",
      "thumb_media_id": "",
      "default_thumb_path": "",
      "need_open_comment": 1,
      "only_fans_can_comment": 1
    }
  ]
}
```

- `thumb_media_id`：封面永久素材 id。留空时，调用 `/publish` 传 `cover_path` 会自动上传永久素材拿 id
- `title_template`：支持 `{date}` 占位，发图文时若不传 title 会自动替换为当天 YYYYMMDD

### 3. 配置服务环境变量

在 `server/.env.local` 加（与主服务共用一个文件）：

```env
WX_API_KEY=随机字符串_用于鉴权
WX_PORT=3004
WX_HOST=127.0.0.1
# WX_REQUIRE_API_KEY=true   # 默认开，生产务必开
```

### 4. 启动

```bash
python main.py
# 或
uvicorn main:app --host 127.0.0.1 --port 3004
```

### 5. 验证

```bash
curl http://127.0.0.1:3004/health
curl -H "X-API-Key: 你的key" http://127.0.0.1:3004/accounts
```

## 发图文

```bash
curl -X POST http://127.0.0.1:3004/publish \
  -H "X-API-Key: 你的key" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "demo_mp",
    "title": "今日萌图",
    "image_paths": ["/abs/path/img1.jpg", "/abs/path/img2.jpg"],
    "cover_path": "/abs/path/cover.jpg",
    "intro": "一起来看看今天的精选",
    "submit_publish": false
  }'
```

- `image_paths`：**服务器本地绝对路径**（服务在这台机器上读图）。若图片在 B2 上，需先下载到服务器本地再发
- `cover_path`：封面图。不传且账号没配 `thumb_media_id` 时，会用第一张正文图当封面
- `submit_publish`：`false` 只存草稿；`true` 存草稿后直接提交发布（异步审核，返回 `publish_id`）
- 返回 `media_id`（草稿 id），后续可用于发布/删除/查询

## 正文模板

正文 content 由「模板 + 图片」拼成，模板独立放在 `wx/templates/`，改样式不用动代码：

- `default.html`：默认模板，沿用秀米风格——顶部装饰 gif +「点击蓝字关注我们」+ 分隔线 + `[前言]` + `[正文图片，每张带灰色文件名标注]` + 底部「图片源自网络，侵立删 / 点个在看」+ 装饰
- 两个占位符：`{{INTRO}}`（前言，可选）、`{{IMAGES}}`（正文图片，自动填入）
- 换模板：在 `wx/templates/` 放一个 `<名字>.html`（带上这两个占位符），调用 `/publish` 时传 `"template": "<名字>"`

## 端点一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查，无需鉴权 |
| GET | `/accounts` | 列出账号（不返回 secret） |
| POST | `/publish` | 一键发图文（建草稿，可选直接发布） |
| POST | `/draft` | 仅建草稿（不提交发布） |
| POST | `/material/upload` | 上传永久素材，拿 `thumb_media_id` |
| POST | `/freepublish` | 提交草稿发布，拿 `publish_id` |
| POST | `/draft/get` | 取草稿详情 |
| POST | `/draft/delete` | 删除草稿 |
| GET | `/draft/count?account=demo_mp` | 草稿箱数量 |

所有 POST 端点用 JSON body，需带 `X-API-Key` 头。

## 与主服务一并启动（pm2）

`server/ecosystem.config.cjs` 同时管理 TS 主服务 + 本服务，两个进程都从 `server/.env.local` 读环境变量：

```bash
cd server
npm run build                  # 先构建 TS 主服务（产出 dist/index.js）
pm2 start ecosystem.config.cjs # 拉起 pixiv-server + wx-server
pm2 save && pm2 startup        # 开机自启
pm2 logs                       # 查看日志
```

TS 主服务需要发图文时，HTTP 调本地 `http://127.0.0.1:3004/publish`（带 `X-API-Key`）。

> 没装 pm2 时：`npm install -g pm2`。也可不用 pm2，分别 `npm start` 和 `python automation/wx/main.py` 起两个终端。

## 部署与 IP 白名单

1. 部署到服务器（项目原本就是东京服务器）
2. 进公众号后台「设置与开发 → 基本配置 → IP 白名单」，加入该服务器出口 IP
3. 白名单只支持单 IP，不支持通配符和 IP 段；改完需管理员扫码生效
4. 多出口的话，专门用一台固定 IP 的小机器跑这个服务

## 配置项

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `WX_API_KEY` | 空 | 鉴权密钥，调用方放 `X-API-Key` 头 |
| `WX_PORT` | 3004 | 服务端口 |
| `WX_HOST` | 127.0.0.1 | 监听地址；对外暴露务必配 `WX_API_KEY` |
| `WX_REQUIRE_API_KEY` | true | 是否强制鉴权 |
| `WX_ACCOUNTS_PATH` | accounts.json | 账号配置路径 |
| `WX_TOKEN_CACHE_PATH` | token_cache.json | token 跨进程缓存文件 |
| `WX_TOKEN_REFRESH_MARGIN` | 300 | token 提前刷新余量（秒） |
| `WX_LOG_LEVEL` | INFO | 日志级别 |

### accounts.json 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 账号标识，调用时用 |
| `appid` / `secret` | 是 | 公众号凭据 |
| `author` | 否 | 默认作者 |
| `title_template` | 否 | 标题模板，支持 `{date}` |
| `digest` | 否 | 默认摘要 |
| `thumb_media_id` | 否 | 封面永久素材 id；空则发布时上传 `cover_path` |
| `default_thumb_path` | 否 | 默认封面图本地路径 |
| `need_open_comment` | 否 | 是否开评论 0/1 |
| `only_fans_can_comment` | 否 | 是否仅粉丝可评论 0/1 |

## 错误码

| errcode | 含义 | 处理 |
|---|---|---|
| 40001 | access_token 无效/过期 | 服务自动强刷重试一次；仍失败检查 appid/secret |
| 40164 | **IP 不在白名单**（注意不是 40001） | 加白名单，改完扫码 |
| 40007 | media_id 无效 | `thumb_media_id` 不是有效永久素材或被删 |
| 40004 | 媒体类型不合法 | 检查 `material_type` 和文件格式 |
| 40125 | appsecret 无效 | 核对 secret |
| 45009 | 接口调用超限 | 退避重试，检查 token 是否频繁刷新 |
| 48002 | API 未授权 | 公众号未认证或无该接口权限 |
| 46003 | 草稿不存在 | media_id 错误或已删 |

## 常见踩坑

1. **IP 白名单报 40164 不是 40001**：白名单问题卡在「获取 token」这步报 40164；40001 是 token 失效。排查路径不同
2. **正文图必须用 uploadimg 返回的 URL**：content 里外链图片会被防盗链过滤不显示。本服务已自动走 uploadimg
3. **正文图超 1MB 被静默拒**：本服务已自动压缩到 1MB 内
4. **thumb_media_id 必须是永久素材**：不能用临时素材（3 天过期）或 uploadimg 的 URL。本服务 `cover_path` 走 `material/add_material?type=image`
5. **access_token 并发刷新互踩**：本服务用 stable_token + 文件缓存，多进程共享同一份 token

## 作为库直接调用（不走 HTTP）

不想起 HTTP 服务时，可直接 import 用：

```python
from wx import ArticleSpec, publish_article

spec = ArticleSpec(
    title="今日萌图",
    image_paths=["/abs/path/img1.jpg", "/abs/path/img2.jpg"],
    cover_path="/abs/path/cover.jpg",
    submit_publish=False,
)
result = publish_article("demo_mp", spec)
print(result)
```

详见 `examples/client_demo.py`。

## 开发与门禁

```bash
# 语法检查
python -m py_compile wx/*.py main.py
# 类型检查（可选，需装 mypy）
mypy wx
# 格式化（可选，需装 ruff）
ruff format wx main.py
```

Python >= 3.10。
