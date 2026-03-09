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
