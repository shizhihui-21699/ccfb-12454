# 第三方 OAuth 授权治理台

面向企业安全团队的第三方应用授权治理工具：导入办公套件导出的 OAuth 授权记录，按应用汇总授权人数与权限范围，
自动标记邮件 / 网盘 / 通讯录的高危权限，对应用执行「已批准 / 待评估 / 禁用」治理流程，并通过本地模拟的管理接口批量撤销授权。

> 所有数据均为虚构样本；管理接口为 Vite dev-server 内的内存态模拟，不连接任何真实办公套件。

## 技术栈

- Vue 3 + TypeScript + Vite 6
- Pinia（状态管理）、Vue Router（hash 路由）
- Element Plus（UI）、ECharts（图表）
- 模拟后端：Vite 中间件（`server/mockAdmin.ts`），无独立后端进程

## 快速开始

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # 类型检查 + 生产构建
```

重新生成样本数据（确定性，固定种子 20261117，可重复）：

```bash
node scripts/gen-sample.mjs
```

产物：`server/seed.json`（接口种子）、`public/sample/oauth-grants.{json,csv}`（可下载/导入的样本文件）。

## 功能与页面

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/#/dashboard` | 风险总览 | 6 项核心指标、治理状态/风险分布饼图、授权人数 Top8 条形图、数据域暴露面、严重权限预警 |
| `/#/apps` | 应用治理 | 按应用汇总：授权人数、持高危权限人数、去重 scope、数据域；关键词/状态/风险筛选；状态流转；禁用后一键批量撤销 |
| `/#/apps/:appId` | 应用详情 | 应用档案、逐 scope 持权人数与说明、员工授权明细、勾选/全部撤销及逐条结果回执 |
| `/#/grants` | 授权明细 | 全量授权记录检索，支持按应用、严重/高危权限、员工过滤与分页 |
| `/#/import` | 授权导入 | 上传 JSON/CSV（拖拽上传、解析预览、逐行校验结果），也可一键导入内置样本 |
| `/#/audit` | 操作审计 | 导入、批准、禁用、撤销、重置的操作人/对象/详情/结果全记录 |
| `/#/policy` | 分级口径 | 完整风险规则、分值速查与处置 SOP |

## 风险分级口径

规则实现于 `src/shared/risk.ts`，前后端共用同一份代码，确定性计算、可审计、可调参。

### 权限（scope）级别

| 级别 | 分值 | 判定口径 | 示例 |
| --- | --- | --- | --- |
| 严重 critical | 40 | `*.full` 完全委托、全租户通讯录管理、租户管理、全员账号读取 | `mail.full`、`drive.full`、`admin.tenant.full` |
| 高危 high | 20 | 邮件 / 网盘文件 / 通讯录的读取、读写、代发信 | `mail.read`、`drive.readwrite`、`contacts.read` |
| 中危 medium | 8 | 日历、IM、审计日志、离线访问（refresh token）、受限单文件 | `calendar.readwrite`、`offline_access` |
| 低危 low | 1 | openid/profile/email 等基础身份、元数据类 | `openid`、`drive.metadata` |
| 未识别 unknown | 1 | 字典外 scope，关键字兜底（full/admin/manage → 高危；敏感域读写 → 高危），提示人工确认 | — |

### 应用级别

- 对**去重后的 scope 集合**逐个计分求和（同一 scope 不因授权人数重复累计）
- 发布方未验证 **+10** 分
- **≥40 高危**、**15–39 中危**、**<15 低危**
- 风险分级（自动）与治理状态（人工：已批准/待评估/禁用）解耦；**禁用是调用撤销接口的前置条件**

## 模拟管理接口（`/api`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 全量授权与应用状态 |
| GET | `/api/apps` | 应用汇总列表（含风险分/分级） |
| GET | `/api/apps/:appId` | 应用详情（含员工授权明细） |
| POST | `/api/apps/:appId/status` | 变更治理状态 `{status, reason?}` |
| POST | `/api/grants/import` | 导入 `{records: [...]}`，按 id 新增/更新，逐行校验 |
| POST | `/api/revoke` | 批量撤销 `{items: [{grantId, userId, appId, scope?}]}` |
| GET | `/api/audit` | 审计日志 |
| GET | `/api/stats` | 仪表盘统计 |
| POST | `/api/reset` | 重置为种子数据 |

撤销接口的业务规则：应用非禁用状态 → 跳过并说明；授权不存在 → 失败；指定 `scope` 做单权限降级，
不指定则整条授权删除。所有动作写入审计日志。

## 目录结构

```
oauth-governance/
├── scripts/gen-sample.mjs      # 确定性样本生成器
├── server/
│   ├── mockAdmin.ts            # 模拟管理接口（Vite 中间件）
│   └── seed.json               # 种子数据（生成物）
├── public/sample/              # 可下载/导入的 JSON、CSV 样本
└── src/
    ├── shared/
    │   ├── types.ts            # 前后端共享类型
    │   └── risk.ts             # 风险分级引擎（scope 字典 + 评分规则 + 汇总）
    ├── api/client.ts           # 前端 API 封装
    ├── stores/governance.ts    # Pinia store
    ├── components/             # RiskBadge、ScopeTag
    └── pages/                  # 7 个页面
```
