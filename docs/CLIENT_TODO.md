# 前端仓库 (client-code) — 优化与缺失功能 TODO List

> 基于对前端仓库的全面审视，按优先级和分类整理。
> 技术栈：React 19 + TypeScript 5.8 + MUI 7 + Vite 6 + ApexCharts + Socket.IO
>
> 格式：`- [ ]` 待完成，`- [x]` 已完成。

---

## 一、测试（当前测试覆盖率 0%）

- [ ] 搭建测试框架（Vitest + React Testing Library）
- [ ] 添加核心组件单元测试（Chart、Table、Form 组件）
- [ ] 添加 API 层测试（Mock fetch，验证请求参数和响应处理）
- [ ] 添加 Auth Provider 测试（登录流程、Token 刷新、自动登出）
- [ ] 添加路由守卫测试（权限控制、未登录重定向）
- [ ] 添加 E2E 测试（Playwright / Cypress，覆盖登录→查看股票→回测提交）
- [ ] 配置覆盖率阈值，集成到 CI

---

## 二、CI/CD（当前无 GitHub Actions 工作流）

- [ ] 添加 CI 工作流：lint → type-check → build（`.github/workflows/ci.yml`）
- [ ] 添加 PR 预览部署（Vercel Preview Deployments）
- [ ] 添加 Bundle Size 检查（防止打包体积膨胀）
- [ ] 添加 Lighthouse CI（性能、可访问性评分门禁）

---

## 三、数据获取与状态管理

- [ ] 引入数据获取库（推荐 TanStack Query / SWR）：
  - 请求缓存与去重
  - 自动重试与刷新
  - 加载 / 错误状态管理
  - 乐观更新
- [ ] 为复杂页面添加状态管理（Zustand / Jotai）：
  - 股票筛选条件持久化
  - 回测参数缓存
  - 用户偏好设置
- [ ] 移除 `src/_mock/` 中不再使用的模拟数据

---

## 四、错误处理与用户体验

- [ ] 添加全局 ErrorBoundary 组件（捕获渲染错误，显示友好提示和重试按钮）
- [ ] API 请求失败的统一错误提示（Toast / Snackbar）
- [ ] 网络断开提示与自动重连
- [ ] 请求超时处理（API Client 添加 timeout 配置）
- [ ] 添加 Loading Skeleton 骨架屏（替代空白加载）
- [ ] 空状态页面设计（无数据 / 无搜索结果 / 无权限）
- [ ] 操作确认弹窗（删除策略、删除用户等危险操作）

---

## 五、表单验证

- [ ] 引入表单验证库（Zod + React Hook Form）
- [ ] 登录表单添加前端校验（账号长度、密码强度、验证码格式）
- [ ] 回测参数表单校验（日期范围、资金范围、策略参数合法性）
- [ ] 选股策略表单校验（条件完整性、数值范围）
- [ ] 用户管理表单校验（邮箱格式、昵称长度）

---

## 六、性能优化

- [ ] 添加 Bundle 分析工具（`rollup-plugin-visualizer`）
- [ ] 长列表虚拟滚动（股票列表、回测历史列表）
- [ ] 图表数据量大时的降采样渲染
- [ ] 路由级别预加载（hover 时预取下一页数据）
- [ ] 图片 / 静态资源懒加载
- [ ] `React.memo` 优化高频重渲染组件
- [ ] Web Worker 处理大量数据计算（技术指标、筛选过滤）

---

## 七、安全加固

- [ ] API 请求添加 CSRF Token（如果后端启用）
- [ ] 添加 CSP（Content Security Policy）meta 标签或 Vercel Headers
- [ ] 敏感字段前端脱敏显示（如有涉及）
- [ ] XSS 防护：审查所有 `dangerouslySetInnerHTML` 使用
- [ ] 输入内容 sanitize（防止注入攻击）
- [ ] 检查 `localStorage` / `sessionStorage` 中是否存储了敏感信息

---

## 八、UI / UX 增强

- [ ] 暗色模式支持（MUI ThemeProvider 切换）
- [ ] 响应式布局优化（当前可能仅适配桌面端）
- [ ] 键盘快捷键支持（`/` 聚焦搜索、`Esc` 关闭弹窗）
- [ ] 数据导出功能（表格数据导出为 CSV / Excel）
- [ ] K 线图交互增强：
  - 十字光标联动
  - 区间选择放大
  - 指标叠加切换
- [ ] 表格列排序 / 筛选 / 列可见性切换
- [ ] 拖拽排列 Dashboard 卡片
- [ ] 多语言支持（i18n，当前中英混合）
- [ ] 无障碍（Accessibility）：键盘导航、ARIA 标签、色彩对比度

---

## 九、WebSocket 实时功能增强

- [ ] Socket 连接状态 UI 指示器（已连接 / 断开 / 重连中）
- [ ] 断线自动重连机制（指数退避）
- [ ] 同步进度条增强（百分比、预计剩余时间）
- [ ] 按需订阅机制（只接收当前页面相关的推送）
- [ ] WebSocket 消息队列（离线期间消息缓存）

---

## 十、环境配置与开发体验

- [ ] 添加 `.env.example` 文件（含所有必需环境变量及注释）
  ```
  VITE_API_BASE_URL=http://localhost:3000
  VITE_WS_URL=http://localhost:3000
  ```
- [ ] 添加 `.env.development` 默认开发配置
- [ ] 添加 Husky + lint-staged（提交前自动 lint / format）
- [ ] 更新 `README.md`（替换模板内容为项目实际说明）
- [ ] 添加 `CONTRIBUTING.md`（本地开发环境搭建指南）
- [ ] 统一包管理器（package.json 中 `packageManager: yarn`，但同时存在 `package-lock.json`）

---

## 十一、API 层优化

- [ ] API 响应类型与后端 Swagger DTO 保持同步（可考虑自动生成）
- [ ] 请求取消机制（AbortController，页面离开时取消进行中的请求）
- [ ] 请求重试机制（网络抖动自动重试 1-2 次）
- [ ] 请求/响应拦截器增强：
  - 统一日志记录
  - 性能统计（请求耗时）
  - 错误上报
- [ ] API Base URL 按环境自动切换

---

## 十二、监控与错误追踪

- [ ] 集成 Sentry（或类似工具）进行前端错误追踪
- [ ] 添加用户行为分析（可选，如 Mixpanel / 自建埋点）
- [ ] 添加 Web Vitals 监控（LCP / FID / CLS）
- [ ] 控制台错误和未捕获 Promise 拒绝统一上报

---

## 十三、代码质量

- [ ] 清理模板残留代码（blog、products 等 Minimal UI 模板页面）
- [ ] 抽取可复用 Hooks：
  - `useApiQuery` — 封装数据请求（loading / error / data）
  - `usePagination` — 分页逻辑
  - `useDebounce` — 搜索防抖
  - `useLocalStorage` — 本地存储状态
- [ ] 组件文档化（可选 Storybook）
- [ ] 统一文件命名规范（当前 kebab-case 为主，确保一致）
- [ ] TypeScript strict mode 审查（确保无隐式 any）

---

## 十四、缺失的功能页面

- [ ] 用户个人中心页面（修改密码、修改资料、查看配额）
- [ ] 系统设置页面（管理员：同步配置、系统参数）
- [ ] 通知中心页面（站内消息、价格预警通知）
- [ ] 数据管理页面（同步日志查看、手动触发同步、数据完整性检查）
- [ ] 热力图页面（行业 / 概念板块热力图可视化）
- [ ] 指数行情页面（沪深 300 / 中证 500 等主要指数走势）
- [ ] 帮助 / 文档页面（内嵌使用指南）

---

*最后更新：2026-04-01*
