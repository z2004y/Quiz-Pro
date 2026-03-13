# Q 题库系统（Flask）

一个支持做题、题库管理、导入导出、AI 识别导入、OCS 推送采集的题库系统。  
后端支持 SQLite / MySQL，新增可选 Redis 缓存。

---

## 目录结构

```text
Q/
├─ app.py                  # Flask 服务入口（页面 + API）
├─ init_db.py              # SQLite 初始化脚本
├─ quiz.db                 # SQLite 数据库（DB_BACKEND=sqlite 时）
├─ ai_settings.json        # AI/采集推送配置
├─ ocs题库配置.json         # OCS 示例配置
├─ 题库示例.json            # 示例导入数据
├─ templates/
│  ├─ index.html
│  ├─ admin.html
│  └─ admin_login.html
└─ static/
   ├─ css/
   │  ├─ index.css
   │  ├─ admin.css
   │  └─ admin_login.css
   └─ js/
      ├─ index.js
      ├─ admin.js
      └─ admin_login.js
```

---

## 主要功能

- 前台刷题（多模式）
- 管理后台：
  - 题库管理
  - 题集管理（支持“公开/私有”）
  - 导入题库（批量导入 / 文档导入 / 单题导入 / 识别导入）
  - 导出题库
  - 采集列表
- OCS 推送查询接口：`POST /api/admin/query`
  - 题库有答案优先返回
  - 没有答案时 AI 兜底
  - 推送记录会并入本地题库

---

## 依赖安装

```bash
pip install -r requirements.txt
```

当前依赖：

- Flask>=2.3,<4
- PyMySQL>=1.1,<2
- redis>=5,<7

---

## 启动

```bash
python app.py
```

默认地址：`http://127.0.0.1:5000`

---

## Docker Compose 部署（推荐自托管）

已内置以下文件：

- `Dockerfile`
- `docker-compose.yml`
- `deploy/nginx/default.conf`
- `.env.docker.example`

### 1) 准备环境变量

```bash
cp .env.docker.example .env
```

然后编辑 `.env`，至少修改：

- `FLASK_SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `MYSQL_ROOT_PASSWORD`
- `MYSQL_PASSWORD`

### 2) 启动

```bash
docker compose up -d --build
```

启动后访问：

- `http://<你的服务器IP>/`
- 后台登录：`http://<你的服务器IP>/admin/login`

### 3) 常用命令

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f app
docker compose logs -f db
```

停止：

```bash
docker compose down
```

停止并清空数据卷（危险）：

```bash
docker compose down -v
```

### 4) 升级代码后重启

```bash
git pull
docker compose up -d --build
```

---

## 数据库配置

通过环境变量切换数据库：

- `DB_BACKEND=sqlite`（默认，本地 `quiz.db`）
- `DB_BACKEND=mysql`
- `DB_PATH`（可选，SQLite 文件路径；Vercel 默认使用 `/tmp/quiz.db`）

MySQL 环境变量：

- `MYSQL_HOST`
- `MYSQL_PORT`（默认 3308）
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_POOL_ENABLED`（可选，默认在 Vercel 为 true）
- `MYSQL_POOL_MAX_IDLE_SECONDS`（可选，默认 45）

---

## 管理员配置

- `FLASK_SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

---

## AI 与采集推送配置

AI 设置和采集推送开关保存在 `ai_settings.json`（可在后台“AI 设置”页面修改）：

- `collector_push_enabled`：是否开启 OCS 推送
- `collector_push_token`：可选，不填则不要求携带 token

> 兼容环境变量默认值：
>
> - `COLLECTOR_PUSH`（默认 true）
> - `COLLECTOR_PUSH_TOKEN`（默认空）
> - `AI_SETTINGS_PATH`（可选；Vercel 默认 `/tmp/ai_settings.json`）

推送接口：

- `POST /api/admin/query`

可通过以下方式携带 token（任选）：

- Header: `X-Collector-Token`
- `Authorization: Bearer <token>`
- query/form/json 中的 `token`

---

## Redis（可选）

已接入 Redis 用于前台公开题集缓存（列表/详情）。  
Redis 不可用时会自动回退到数据库直查。

环境变量：

- `REDIS_ENABLED`（默认 true）
- `REDIS_URL`（优先）
- 或：
  - `REDIS_HOST`（默认 127.0.0.1）
  - `REDIS_PORT`（默认 6379）
  - `REDIS_DB`（默认 0）
  - `REDIS_PASSWORD`
- `REDIS_CACHE_PREFIX`（默认 `quiz`）
- `REDIS_PUBLIC_LIB_CACHE_TTL`（默认 120 秒）

建议：

- 在 Vercel 未配置外部 Redis 时，设置 `REDIS_ENABLED=false`，避免无效连接探测。

---

## 公开/私有题集规则

- 前台 `GET /api/libraries` 仅返回公开题集
- 私有题集仅后台可见
- 在“题集管理”可设置题集是否公开，并支持筛选：
  - 全部
  - 仅公开
  - 仅私有

---

## 导入导出

- 导入：`POST /api/admin/import-json`
- 导出：`GET /api/admin/export-json`
  - 可选参数：`library_id`（只导出一个题集）

---

## Vercel 部署

支持两种方式：**Git 自动部署（推荐）** 和 **CLI 手动部署**。

### 1) 部署前准备

- 保留根目录 `requirements.txt`、`vercel.json`
- 入口文件为 `app.py`（已适配 `@vercel/python`）

### 2) 环境变量（Vercel Project Settings → Environment Variables）

必填：

- `FLASK_SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

生产强烈建议（持久化）：

- `DB_BACKEND=mysql`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

可选：

- `REDIS_URL`（启用 Redis 缓存）
- `COLLECTOR_PUSH`
- `COLLECTOR_PUSH_TOKEN`

### 3) 方式 A：Git 自动部署（推荐）

1. 将项目推送到 GitHub / GitLab / Bitbucket
2. 打开 Vercel 控制台并点击 **New Project**
3. 导入仓库后确认配置并部署
4. 后续 push 代码会自动触发部署（Preview / Production）

### 4) 方式 B：CLI 手动部署

```bash
npm i -g vercel
vercel login
vercel
vercel --prod
```

### 5) 说明

- 如果使用 SQLite，Vercel 仅提供临时可写目录 `/tmp`，实例重建后数据会丢失（不建议生产）。
- 本项目在 Vercel 下默认：
  - SQLite 路径：`/tmp/quiz.db`
  - AI 设置路径：`/tmp/ai_settings.json`
