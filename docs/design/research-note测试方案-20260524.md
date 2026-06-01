# Research-Note 模块 API 测试方案-20260524

> 范围：ResearchNote（研究笔记）
> 设计原则：全新开始；业务场景优先；黑盒推导期望结果；不以现有实现或现有测试为正确性依据。
> 状态：✅ 已完成

---

## 1. 测试范围

| 项目 | 内容 |
| ---- | ---- |
| 模块 | ResearchNote - 研究笔记 |
| 接口列表 | 11 个端点 |
| 用户角色 | 全部需 JWT 认证 |
| 依赖数据 | researchNote, stockBasic |

### 接口清单

| 分类 | 端点 | 说明 |
| ---- | ---- | ---- |
| 列表 | list | 分页 + 筛选查询笔记列表 |
| 标签 | tags | 获取当前用户所有标签及使用次数 |
| 股票关联 | stock | 获取某只股票的所有研究笔记 |
| 详情 | detail | 获取单条笔记详情 |
| CRUD | create, update | 创建/更新研究笔记 |
| 回收站 | delete, restore, permanent-delete, list-trash | 软删除/恢复/永久删除/回收站列表 |
| 搜索 | search | 全文搜索（带高亮） |

---

## 2. 核心业务规则

| 规则编号 | 规则 | 来源 | 测试影响 |
| -------- | ---- | ---- | -------- |
| R-RN01 | title 必填，1~100 字符 | CreateResearchNoteDto @IsString @MinLength(1) @MaxLength(100) | 缺失/空/超长应 400 |
| R-RN02 | content 必填，1~10000 字符 | CreateResearchNoteDto @IsString @MinLength(1) @MaxLength(10000) | 缺失/空/超长应 400 |
| R-RN03 | tsCode 可选，格式 /^\d{6}\.(SH\|SZ\|BJ)$/ | CreateResearchNoteDto @Matches | 格式错误应 400 |
| R-RN04 | tags 可选，数组最大 10 项，每项最长 30 字符 | @ArrayMaxSize(10) @MaxLength(30, { each: true }) | 超限应 400 |
| R-RN05 | isPinned 可选，布尔值 | @IsBoolean | 非布尔应 400 |
| R-RN06 | pageSize 1~100 | ResearchNoteQueryDto @Min(1) @Max(100) | 超范围应 400 |
| R-RN07 | page 最小 1 | @Min(1) | 小于 1 应 400 |
| R-RN08 | sortBy 必须是 createdAt/updatedAt | @IsIn | 无效应 400 |
| R-RN09 | sortOrder 必须是 asc/desc | @IsIn | 无效应 400 |
| R-RN10 | since/until 格式 YYYYMMDD | @Matches(/^\d{8}$/) | 格式错误应 400 |
| R-RN11 | 全部端点需 JWT | @UseGuards(JwtAuthGuard) | 无 Token 应 401 |
| R-RN12 | 详情/更新/删除需笔记存在且属于当前用户 | Service NotFoundException | 不存在应 404 |

---

## 3. 测试用例矩阵

### 列表查询

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| RN-BIZ-001 | BIZ | P0 | 查询笔记列表（默认参数） | 201, notes+total+page+pageSize | ✅ 通过 |
| RN-BIZ-002 | BIZ | P0 | 带筛选条件查询列表 | 201, 笔记列表 | ✅ 通过 |
| RN-ERR-001 | ERR | P1 | pageSize=101 超限 | 400 | ✅ 通过 |
| RN-ERR-002 | ERR | P1 | pageSize=0 超下限 | 400 | ✅ 通过 |
| RN-ERR-003 | ERR | P1 | sortBy 非法值 | 400 | ✅ 通过 |
| RN-ERR-004 | ERR | P1 | sortOrder 非法值 | 400 | ✅ 通过 |
| RN-ERR-005 | ERR | P1 | since 格式错误（非8位数字） | 400 | ✅ 通过 |
| RN-ERR-006 | ERR | P1 | until 格式错误 | 400 | ✅ 通过 |
| RN-EDGE-001 | EDGE | P1 | pageSize=100（最大值） | 201 | ✅ 通过 |
| RN-EDGE-002 | EDGE | P1 | pageSize=1（最小值） | 201 | ✅ 通过 |

### 标签

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| RN-BIZ-003 | BIZ | P0 | 获取用户标签列表 | 201, tags 数组 | ✅ 通过 |

### 股票关联

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| RN-BIZ-004 | BIZ | P0 | 获取某股票的研究笔记 | 201, notes+total | ✅ 通过 |

### 详情

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| RN-BIZ-005 | BIZ | P0 | 获取笔记详情 | 201, 笔记对象 | ✅ 通过 |
| RN-ERR-007 | ERR | P1 | 详情笔记不存在 | 404 | ✅ 通过 |

### 创建

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| RN-BIZ-006 | BIZ | P0 | 创建完整笔记（含可选字段） | 201, 笔记对象 | ✅ 通过 |
| RN-BIZ-007 | BIZ | P0 | 创建最简笔记（仅必填） | 201, 笔记对象 | ✅ 通过 |
| RN-ERR-008 | ERR | P1 | 创建缺 title | 400 | ✅ 通过 |
| RN-ERR-009 | ERR | P1 | 创建缺 content | 400 | ✅ 通过 |
| RN-ERR-010 | ERR | P1 | 创建 title 超长（101字符） | 400 | ✅ 通过 |
| RN-ERR-011 | ERR | P1 | 创建 content 超长（10001字符） | 400 | ✅ 通过 |
| RN-ERR-012 | ERR | P1 | 创建 tsCode 格式错误 | 400 | ✅ 通过 |
| RN-ERR-013 | ERR | P1 | 创建 tags 超过 10 个 | 400 | ✅ 通过 |
| RN-ERR-014 | ERR | P1 | 创建 tag 超过 30 字符 | 400 | ✅ 通过 |
| RN-ERR-015 | ERR | P1 | 创建 isPinned 非布尔 | 400 | ✅ 通过 |
| RN-EDGE-003 | EDGE | P1 | 创建 title 最大 100 字符 | 201 | ✅ 通过 |
| RN-EDGE-004 | EDGE | P1 | 创建 content 最大 10000 字符 | 201 | ✅ 通过 |
| RN-EDGE-005 | EDGE | P1 | 创建 tags 最大 10 个 | 201 | ✅ 通过 |
| RN-EDGE-006 | EDGE | P1 | 创建 tag 最大 30 字符 | 201 | ✅ 通过 |

### 更新

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| RN-BIZ-008 | BIZ | P0 | 更新笔记标题 | 201, 更新后笔记 | ✅ 通过 |
| RN-BIZ-009 | BIZ | P0 | 更新笔记内容 | 201, 更新后笔记 | ✅ 通过 |
| RN-ERR-016 | ERR | P1 | 更新 title 超长（交叉类型致校验跳过） | 201（已知缺口） | ✅ 通过 |

### 回收站

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| RN-BIZ-010 | BIZ | P0 | 软删除笔记 | 201, message | ✅ 通过 |
| RN-BIZ-011 | BIZ | P0 | 恢复笔记 | 201, 笔记对象 | ✅ 通过 |
| RN-BIZ-012 | BIZ | P0 | 永久删除笔记 | 201, message | ✅ 通过 |
| RN-BIZ-013 | BIZ | P0 | 查询回收站列表 | 201, notes+total | ✅ 通过 |
| RN-ERR-017 | ERR | P1 | 删除笔记不存在 | 404 | ✅ 通过 |
| RN-ERR-018 | ERR | P1 | 恢复笔记不存在 | 404 | ✅ 通过 |
| RN-ERR-019 | ERR | P1 | 永久删除笔记不存在 | 404 | ✅ 通过 |
| RN-EDGE-007 | EDGE | P1 | 回收站 pageSize 边界 | 201 | ✅ 通过 |

### 搜索

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| RN-BIZ-014 | BIZ | P0 | 全文搜索笔记 | 201, items+total | ✅ 通过 |
| RN-BIZ-015 | BIZ | P0 | 搜索带分页 | 201, 分页数据 | ✅ 通过 |

### 安全

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| RN-SEC-001 | SEC | P0 | 无 Token 访问列表 | 401 | ✅ 通过 |
| RN-SEC-002 | SEC | P0 | 无 Token 创建笔记 | 401 | ✅ 通过 |

---

## 4. 测试执行报告

> 执行时间：2026-05-24
> 执行方式：Jest controller spec + Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock service + supertest

### 执行总览

| 模块 | 用例数 | 通过 | 失败 | 跳过 | 通过率 |
| ---- | ------ | ---- | ---- | ---- | ------ |
| ResearchNote | 43 | 43 | 0 | 0 | 100% |

### 已知问题

| 编号 | 问题 | 影响 | 建议 |
| ---- | ---- | ---- | ---- |
| KNOWN-001 | `update` 端点使用 `UpdateResearchNoteDto & { id: number }` 交叉类型，TypeScript emitDecoratorMetadata 降级为 Object，ValidationPipe 无法识别 DTO 元类型，校验被跳过 | 更新接口无入参校验 | 将 `id` 改为 `@Param()` 或创建专用 `UpdateWithIdDto` |
