# 题库项目结构说明

## 目录结构

```text
Q/
├─ app.py                  # Flask 服务入口（路由 + API）
├─ init_db.py              # 初始化数据库脚本
├─ quiz.db                 # SQLite 数据库
├─ 题库示例.json           # 示例导入数据
├─ templates/              # 页面模板（只放 HTML 结构）
│  ├─ index.html
│  ├─ admin.html
│  └─ admin_login.html
└─ static/                 # 静态资源
   ├─ css/
   │  ├─ index.css
   │  ├─ admin.css
   │  └─ admin_login.css
   └─ js/
      ├─ index.js
      ├─ admin.js
      └─ admin_login.js
```

## 约定

- `templates/*.html`：只负责页面结构和挂载点（避免内联大段 CSS/JS）。
- `static/css/*.css`：页面样式按页面拆分，便于独立优化。
- `static/js/*.js`：页面逻辑按页面拆分，避免单文件过大。
- API 基地址通过 `data-*` 配置：
  - 做题页：`data-api-base`
  - 管理页：`data-admin-api-base`
  - 登录页：`data-admin-login-api`

## JSON 导入导出

- 导入：管理页点击导入图标，调用 `POST /api/admin/import-json`
- 导出：管理页点击导出图标，调用 `GET /api/admin/export-json`
  - 可选参数：`library_id`（仅导出某个题集）

## Vercel 部署（Flask）

### 1) 准备部署文件

在项目根目录新建 `requirements.txt`：

```txt
Flask>=2.3,<4
```

在项目根目录新建 `vercel.json`：

```json
{
  "version": 2,
  "builds": [
    { "src": "app.py", "use": "@vercel/python" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "app.py" }
  ]
}
```

### 2) 推送到 Git 仓库

将代码推送到 GitHub/GitLab/Bitbucket 仓库。

### 3) 在 Vercel 导入项目

1. 打开 Vercel 控制台，点击 **Add New -> Project**
2. 选择你的仓库并导入
3. Framework Preset 可选 **Other**
4. 保持默认 Build/Output 配置，点击 **Deploy**

### 4) 配置环境变量（建议）

在 Vercel 项目设置中添加：

- `FLASK_SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

### 5) 重要说明（SQLite）

当前项目使用 `quiz.db`（SQLite 文件）。Vercel Serverless 环境不适合做持久化写入，重部署或实例回收后数据可能丢失。

- 仅做演示：可直接部署，数据变更不保证持久化。
- 生产环境：建议改用外部数据库（如 PostgreSQL/MySQL/Supabase/Neon）。
