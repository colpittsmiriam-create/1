# 建材智途 AI 公网版 4.0

在线访问：[建材智途 AI](https://jiancai-zhitu-ai-20261028.expertjam32.chatgpt.site)。

4.0 已补齐分层后端、18 张数据库表、实体 API、方案状态流程、协作角色、审计及统一中间件。设计文档见 [后端架构与数据库设计](docs/后端架构与数据库设计.md)，接口示例见 [接口使用示例](docs/接口使用示例.md)。

建材智途 AI 的公网应用源码。沿用六个业务页面，增加平台登录、账号隔离、云端项目与底图存储、并发版本检查和项目归档恢复。

## 使用方式

部署后访问站点根地址即可进入工作台。访客可直接体验；点击右上角「登录保存」，通过托管平台提供的 ChatGPT 登录进入个人项目空间。

- 访客数据保存在当前浏览器，不会自动上传到任何账号。
- 登录后，项目保存到账号专属空间，可在不同设备访问。
- 账号菜单可切换、新建、归档、恢复项目，并手动导入本机体验数据。
- 模型编辑后自动保存；右上角显示实际同步状态。断网或保存失败时，本机保留草稿，可下载 JSON 备份。
- 两个窗口基于同一旧版本保存时，第二个保存会被拒绝，不覆盖先保存的内容。可下载本机备份、另存为新项目，或备份后重新载入云端。
- 退出账号后，访客页面不会读取该账号的本机草稿。

完整规划流程为「场地采集与建模 → 搬运路径优化 → 堆场比选 → 调度检查 → 成果交付」。原 2.0 JSON 备份可导入；导入时创建独立云端项目，保留已有项目。

## 技术组成

| 部分 | 位置 / 用途 |
| --- | --- |
| 六页工作台 | `public/platform/`，原生 HTML/CSS/JavaScript |
| 云端同步 | `public/platform/cloud.js`，串行保存、账号草稿、版本冲突、断线重试 |
| 账号与项目管理 | `public/platform/account.js` |
| API 路由 | `app/api/[[...segments]]/route.ts` |
| API 与中间件 | `lib/http/`，身份、限流、幂等、安全头、追踪和统一错误 |
| 业务服务 | `lib/services/`，实体编辑、服务端计算、复核状态、版本与成员 |
| 数据访问 | `lib/repositories/`，关系表、事务批次、条件版本与快照 |
| 领域规则 | `lib/domain/`，输入、引用、方案就绪检查与计算规则 |
| 路径与模型核心 | `public/platform/core.js`；构建时生成服务端 ESM 和测试 CJS |
| 结构化项目 | Cloudflare D1，绑定名 `DB` |
| 场地底图 | Cloudflare R2，绑定名 `BUCKET` |
| 数据库结构 | `db/schema.ts`、`drizzle/` 中的增量迁移 |
| 托管配置 | `.openai/hosting.json` |

登录由 Sites 托管平台完成，本应用不处理密码。生产身份来自平台注入的请求身份，不能把未经认证的直接 Worker 入口暴露为另一条访问通道。跨站写请求被拒绝，客户端不能指定项目归属用户。开发环境模拟登录不会打入生产构建。

每账号最多拥有 30 个项目（含归档），每项目最多 20 位协作成员；支持所有者、编辑者和查看者。读请求每分钟最多 300 次，写请求每小时最多 240 次。底图最大 2 MB；模型正文不含底图最大 900 KB。归档可恢复，永久删除需先归档并检查版本。底图拆入对象存储，避免超过 [D1 单行大小限制](https://developers.cloudflare.com/d1/platform/limits/)。

## 本地开发

需要 Node.js 22.13 或更高版本、npm。首次安装：

```powershell
npm ci
npm run build
```

首次启动前，应用已附带的数据库迁移（仅执行一次，不要在已有表上重复执行）：

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_ordinary_red_hulk.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_fixed_jasper_sitwell.sql
npm run dev -- --port 5175 --hostname 127.0.0.1
```

访问终端显示的本机地址。开发环境由 Sites 的本地模拟登录提供测试账号；它不是公网账号。

构建产物预览：

```powershell
npm run build
npm start -- --port 5176
```

生产构建本地预览不模拟登录。它用于检查公开页面、存储绑定和静态资源；登录由真实托管网关处理。

## 验证

```powershell
npm test
node node_modules/typescript/bin/tsc --noEmit
```

核心/API 测试覆盖路径计算、关系表、外键、事务回滚、用户隔离、成员角色、复核状态、幂等、限流、版本冲突、底图保存、历史恢复、旧数据迁移和数量限制。API 测试使用内存 SQLite，不读取真实云端项目。

浏览器回归需另行提供 Playwright 和 Chrome。启动本地开发服务后：

```powershell
node tests/cloud-browser.cjs
node tests/backend-browser.cjs
```

可设置 `CHROME_PATH` 和 `TEST_BASE_URL`。浏览器测试只在本地模拟登录环境运行，验证两个独立浏览器的保存读取、版本冲突、底图、断网重试、归档恢复、退出隔离和响应式布局。

## 公网发布

此项目使用 Sites 托管配置。保留 `.openai/hosting.json` 中的项目 ID、D1 和 R2 绑定，通过 Sites 工作流提交源码、构建、打包并发布。托管平台应用数据库迁移，提供 HTTPS 和正式登录。

不要把 `dist/client` 单独当作完整应用上传到静态托管。项目还需要 `dist/server` 中的 Worker、数据库、底图存储和托管登录网关。无需把本机临时登录 Cookie、数据库、构建工具目录或任何凭据上传到公网。

已有项目的 SQL 迁移一旦应用就应保留；数据库变更应生成新的增量迁移。生产运行日志通过托管平台查看。

## 当前功能边界

路径搜索使用人工录入的双向道路图，按道路长度、净宽、封闭状态和任务时窗计算。工时包含等距空返和装卸参数，不含等待；调度检查设备冲突、路线不可达和工时超窗，不自动求解多任务最优排程。图像识别和大模型服务未接入，参考底图用于人工核对。

本次保留原离线优化版，公网版单独存放，未修改用户提供的原始 ZIP 与商业计划书。
