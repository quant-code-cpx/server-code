# 自选股与研究工作台 — 开发方案设计

> **目标读者**：AI 代码生成助手 / 开发者。请按照本文定义的分阶段方案、接口规格、Schema 变更进行实现。
>
> **对应痛点**：`FEATURE_GAP_ANALYSIS_2026-04-01.md` → 痛点四：缺少自选股与研究工作台
>
> **日期**：2026-04-02

---

## 目录

1. [现状评估与需求分析](#一现状评估与需求分析)
2. [总体分阶段规划](#二总体分阶段规划)
3. [Phase 1：自选股管理（Watchlist）](#三phase-1自选股管理watchlist)
4. [Phase 2：研究笔记（Research Notes）](#四phase-2研究笔记research-notes)
5. [Phase 3：条件订阅（Screener Subscription）](#五phase-3条件订阅screener-subscription)
6. [Phase 4：策略草稿箱（Strategy Draft）](#六phase-4策略草稿箱strategy-draft)
7. [WebSocket 事件设计](#七websocket-事件设计)
8. [安全与权限设计](#八安全与权限设计)
9. [缓存策略](#九缓存策略)
10. [实施顺序与依赖关系](#十实施顺序与依赖关系)
11. [文件变更汇总](#十一文件变更汇总)

---

## 一、现状评估与需求分析

### 1.1 现状

系统当前是"工具型"——用户查完即走，无法沉淀研究过程：

| 能力 | 状态 | 说明 |
|------|------|------|
| 股票列表/搜索/详情 | ✅ 已有 | `StockService` 提供完善的查询能力 |
| 选股器 + 预设策略 | ✅ 已有 | `POST /stock/screener` + `POST /stock/screener/presets` |
| 选股策略保存 | ✅ 已有 | `ScreenerStrategy` CRUD（每用户最多 20 条） |
| 因子库 + 因子选股 | ✅ 已有 | 9 个 API 端点 |
| 回测框架 | ✅ 已有 | BullMQ 异步回测 + WebSocket 进度推送 |
| **自选股管理** | ❌ 缺失 | 无法跟踪关注标的 |
| **研究笔记** | ❌ 缺失 | 无法对标的添加分析记录 |
| **条件订阅** | ❌ 缺失 | 无法"每天收盘后自动看有没有新进入条件的票" |
| **策略草稿** | ❌ 缺失 | 未完成的回测参数配置无法暂存 |

### 1.2 可复用的基础设施

| 组件 | 文件 | 可复用方式 |
|------|------|-----------|
| **用户模型** | `prisma/user.prisma` | `User` 已有 `watchlistLimit` 字段（上限控制） |
| **JWT 鉴权** | `src/lifecycle/guard/jwt-auth.guard.ts` | 所有新接口直接使用 `@UseGuards(JwtAuthGuard)` |
| **当前用户** | `src/common/decorators/current-user.decorator.ts` | `@CurrentUser()` 提取 `TokenPayload` |
| **角色守卫** | `src/lifecycle/guard/roles.guard.ts` | Admin 端点使用 `@Roles(UserRole.ADMIN)` |
| **选股器** | `src/apps/stock/stock.service.ts` | `screener()` 方法可被条件订阅复用 |
| **策略保存** | `prisma/screener_strategy.prisma` | `ScreenerStrategy` 模式可参考（CRUD + 用户归属 + 数量限制） |
| **WebSocket** | `src/websocket/events.gateway.ts` | 已有 `broadcastNotification()`，可扩展自选股/订阅事件 |
| **Redis 缓存** | `src/shared/cache.service.ts` | `rememberJson()` / `invalidateNamespaces()` |
| **BullMQ** | `src/queue/backtesting/` | 条件订阅可复用队列模式 |
| **用户配额** | `src/constant/user.constant.ts` | `ADMIN_WATCHLIST_UNLIMITED = -1`，配额检查模式已就绪 |

### 1.3 核心设计原则

1. **用户数据隔离**：所有数据按 `userId` 隔离，CRUD 操作必须校验归属
2. **配额可控**：通过 `User` 模型上的 limit 字段实现管理员可配的数量上限
3. **轻量级起步**：先实现核心 CRUD，不过度设计协作/分享功能
4. **与现有模块松耦合**：新功能放在独立模块中，通过 import 复用已有 Service
5. **渐进式增强**：Phase 1-4 分步交付，每个 Phase 独立可用

---

## 二、总体分阶段规划

| 阶段 | 目标 | 预估工时 | 前置依赖 |
|------|------|----------|----------|
| **Phase 1** | 自选股管理（Watchlist + WatchlistStock CRUD + 批量导入 + 行情聚合） | 3-5 天 | 无 |
| **Phase 2** | 研究笔记（ResearchNote CRUD + 按股票/标签查询 + Markdown 内容） | 2-3 天 | 无 |
| **Phase 3** | 条件订阅（ScreenerSubscription + BullMQ 定时执行 + 增量通知） | 3-5 天 | 选股器正常运作 |
| **Phase 4** | 策略草稿箱（StrategyDraft 自动保存 + 加载回填 + 回测提交） | 2-3 天 | 回测模块基础就绪 |

> Phase 1 和 Phase 2 互不依赖，可并行开发。Phase 3 / Phase 4 也互不依赖。

---

## 三、Phase 1：自选股管理（Watchlist）

### 3.1 需求概述

量化研究人员需要管理多个关注股票池：

- 创建多个自选股组（如"价值股候选"、"趋势股关注"、"事件驱动标的"）
- 向组内添加/移除股票，附带简短备注和标签
- 设定目标价位进行跟踪
- 查看自选股组的最新行情汇总（涨跌幅、成交量等）
- 批量导入股票代码

### 3.2 Prisma Schema

**文件**：`prisma/watchlist.prisma`（🆕 新建）

```prisma
/// 自选股组
model Watchlist {
  id          Int              @id @default(autoincrement())
  userId      Int              @map("user_id")
  name        String           @db.VarChar(50)
  description String?          @db.VarChar(200)
  isDefault   Boolean          @default(false) @map("is_default")  /// 默认自选组（仅一个）
  sortOrder   Int              @default(0) @map("sort_order")      /// 展示排序
  createdAt   DateTime         @default(now()) @map("created_at")
  updatedAt   DateTime         @updatedAt @map("updated_at")

  user   User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  stocks WatchlistStock[]

  @@map("watchlists")
  @@index([userId])
  @@unique([userId, name])  /// 同一用户不能有同名自选组
}

/// 自选股成员
model WatchlistStock {
  id          Int       @id @default(autoincrement())
  watchlistId Int       @map("watchlist_id")
  tsCode      String    @map("ts_code") @db.VarChar(16)
  notes       String?   @db.VarChar(500)               /// 用户备注
  tags        String[]  @default([])                    /// 标签数组（PostgreSQL text[]）
  targetPrice Decimal?  @map("target_price") @db.Decimal(10, 2)  /// 目标价
  sortOrder   Int       @default(0) @map("sort_order")  /// 组内排序
  addedAt     DateTime  @default(now()) @map("added_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  watchlist Watchlist @relation(fields: [watchlistId], references: [id], onDelete: Cascade)

  @@map("watchlist_stocks")
  @@unique([watchlistId, tsCode])  /// 同组内不能重复添加同一股票
  @@index([watchlistId, sortOrder])
  @@index([tsCode])
}
```

**User 模型关系补充**（修改 `prisma/user.prisma`）：

```prisma
model User {
  // ... 现有字段 ...
  watchlists Watchlist[]  // 🆕 添加反向关系
}
```

### 3.3 配额控制

利用 `User.watchlistLimit` 字段控制每用户可创建的自选组数量：

| 角色 | 默认上限 | 说明 |
|------|---------|------|
| `USER` | `10`（`User.watchlistLimit` 默认值） | 管理员可通过 `adminUpdateUser` 调整 |
| `ADMIN` / `SUPER_ADMIN` | `-1`（无限制） | 由 `ADMIN_WATCHLIST_UNLIMITED` 常量定义 |

每个自选组内股票数量上限：**200 只**（在常量文件中定义，不做用户级可配）。

### 3.4 模块结构

```
src/apps/watchlist/
├── watchlist.module.ts
├── watchlist.controller.ts
├── watchlist.service.ts
├── dto/
│   ├── create-watchlist.dto.ts
│   ├── update-watchlist.dto.ts
│   ├── add-watchlist-stock.dto.ts
│   ├── update-watchlist-stock.dto.ts
│   ├── batch-add-stocks.dto.ts
│   ├── reorder-watchlists.dto.ts
│   └── watchlist-query.dto.ts
└── constants/
    └── watchlist.constant.ts
```

### 3.5 API 设计

#### 3.5.1 自选股组 CRUD

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /watchlist` | GET | 获取当前用户的所有自选组（含各组股票数量） |
| `POST /watchlist` | POST | 创建自选组 |
| `PUT /watchlist/:id` | PUT | 更新自选组（名称/描述/排序） |
| `DELETE /watchlist/:id` | DELETE | 删除自选组（含关联股票级联删除） |
| `PUT /watchlist/reorder` | PUT | 批量更新自选组排序 |

#### 3.5.2 自选股成员管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /watchlist/:id/stocks` | GET | 获取自选组内股票列表（含最新行情） |
| `POST /watchlist/:id/stocks` | POST | 添加单只股票 |
| `POST /watchlist/:id/stocks/batch` | POST | 批量添加股票（最多 50 只/次） |
| `PUT /watchlist/:id/stocks/:stockId` | PUT | 更新股票备注/标签/目标价 |
| `DELETE /watchlist/:id/stocks/:stockId` | DELETE | 移除股票 |
| `DELETE /watchlist/:id/stocks/batch` | DELETE | 批量移除股票 |
| `PUT /watchlist/:id/stocks/reorder` | PUT | 批量更新组内排序 |

#### 3.5.3 自选股聚合查询

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /watchlist/:id/summary` | GET | 自选组汇总（涨跌统计、总市值、平均涨幅等） |
| `GET /watchlist/overview` | GET | 所有自选组的快速概览 |

### 3.6 DTO 定义

#### `CreateWatchlistDto`

```typescript
class CreateWatchlistDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean         // 设为默认自选组（会取消其他默认标记）
}
```

#### `UpdateWatchlistDto`

```typescript
class UpdateWatchlistDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number
}
```

#### `AddWatchlistStockDto`

```typescript
class AddWatchlistStockDto {
  @IsString()
  @Matches(/^\d{6}\.(SH|SZ|BJ)$/)
  tsCode: string                   // 股票代码，格式如 000001.SZ

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @ArrayMaxSize(10)
  tags?: string[]                  // 标签，最多 10 个

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPrice?: number             // 目标价
}
```

#### `UpdateWatchlistStockDto`

```typescript
class UpdateWatchlistStockDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @ArrayMaxSize(10)
  tags?: string[]

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPrice?: number
}
```

#### `BatchAddStocksDto`

```typescript
class BatchAddStocksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AddWatchlistStockDto)
  stocks: AddWatchlistStockDto[]
}
```

#### `BatchRemoveStocksDto`

```typescript
class BatchRemoveStocksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  stockIds: number[]
}
```

#### `ReorderWatchlistsDto`

```typescript
class ReorderWatchlistsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItem)
  items: ReorderItem[]
}

class ReorderItem {
  @IsInt()
  id: number

  @IsInt()
  @Min(0)
  sortOrder: number
}
```

### 3.7 Service 实现要点

```typescript
@Injectable()
export class WatchlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // ──────── 自选组 CRUD ────────

  async getWatchlists(userId: number) {
    return this.prisma.watchlist.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { stocks: true } },  // 含股票数量
      },
    })
  }

  async createWatchlist(userId: number, dto: CreateWatchlistDto) {
    // 1. 配额检查
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const count = await this.prisma.watchlist.count({ where: { userId } })
    if (user.watchlistLimit !== ADMIN_WATCHLIST_UNLIMITED && count >= user.watchlistLimit) {
      throw new BadRequestException(`自选组数量已达上限（最多 ${user.watchlistLimit} 个）`)
    }

    // 2. 处理默认标记
    if (dto.isDefault) {
      await this.prisma.watchlist.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      })
    }

    // 3. 创建
    try {
      const watchlist = await this.prisma.watchlist.create({
        data: {
          userId,
          name: dto.name,
          description: dto.description ?? null,
          isDefault: dto.isDefault ?? false,
        },
      })
      await this.invalidateCache(userId)
      return watchlist
    } catch (e) {
      if (e.code === 'P2002') throw new ConflictException('同名自选组已存在')
      throw e
    }
  }

  async updateWatchlist(userId: number, id: number, dto: UpdateWatchlistDto) {
    const existing = await this.prisma.watchlist.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('自选组不存在')

    // 处理默认标记切换
    if (dto.isDefault === true) {
      await this.prisma.watchlist.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      })
    }

    try {
      const updated = await this.prisma.watchlist.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        },
      })
      await this.invalidateCache(userId)
      return updated
    } catch (e) {
      if (e.code === 'P2002') throw new ConflictException('同名自选组已存在')
      throw e
    }
  }

  async deleteWatchlist(userId: number, id: number) {
    const existing = await this.prisma.watchlist.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('自选组不存在')

    await this.prisma.watchlist.delete({ where: { id } })  // 级联删除关联股票
    await this.invalidateCache(userId)
    return { message: '删除成功' }
  }

  // ──────── 自选股成员管理 ────────

  async getStocks(userId: number, watchlistId: number) {
    // 1. 验证归属
    const watchlist = await this.prisma.watchlist.findFirst({
      where: { id: watchlistId, userId },
    })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    // 2. 查询成员列表
    const stocks = await this.prisma.watchlistStock.findMany({
      where: { watchlistId },
      orderBy: [{ sortOrder: 'asc' }, { addedAt: 'desc' }],
    })

    // 3. 批量获取最新行情
    if (stocks.length === 0) return { stocks: [], summary: null }
    const tsCodes = stocks.map(s => s.tsCode)
    const quotes = await this.getLatestQuotes(tsCodes)

    // 4. 组装返回
    return {
      stocks: stocks.map(s => ({
        ...s,
        quote: quotes.get(s.tsCode) ?? null,
      })),
    }
  }

  async addStock(userId: number, watchlistId: number, dto: AddWatchlistStockDto) {
    const watchlist = await this.prisma.watchlist.findFirst({
      where: { id: watchlistId, userId },
    })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    // 组内数量限制
    const count = await this.prisma.watchlistStock.count({ where: { watchlistId } })
    if (count >= MAX_STOCKS_PER_WATCHLIST) {
      throw new BadRequestException(`每个自选组最多 ${MAX_STOCKS_PER_WATCHLIST} 只股票`)
    }

    // 验证股票代码合法性
    const stockExists = await this.prisma.stockBasic.findFirst({
      where: { tsCode: dto.tsCode },
    })
    if (!stockExists) throw new NotFoundException(`股票代码 ${dto.tsCode} 不存在`)

    try {
      const stock = await this.prisma.watchlistStock.create({
        data: {
          watchlistId,
          tsCode: dto.tsCode,
          notes: dto.notes ?? null,
          tags: dto.tags ?? [],
          targetPrice: dto.targetPrice ?? null,
        },
      })
      await this.invalidateCache(userId)
      return stock
    } catch (e) {
      if (e.code === 'P2002') throw new ConflictException('该股票已在自选组中')
      throw e
    }
  }

  async batchAddStocks(userId: number, watchlistId: number, dto: BatchAddStocksDto) {
    const watchlist = await this.prisma.watchlist.findFirst({
      where: { id: watchlistId, userId },
    })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    const currentCount = await this.prisma.watchlistStock.count({ where: { watchlistId } })
    if (currentCount + dto.stocks.length > MAX_STOCKS_PER_WATCHLIST) {
      throw new BadRequestException(
        `超出上限：当前 ${currentCount} 只，本次添加 ${dto.stocks.length} 只，上限 ${MAX_STOCKS_PER_WATCHLIST}`
      )
    }

    // 批量创建（skipDuplicates 忽略已存在的）
    const result = await this.prisma.watchlistStock.createMany({
      data: dto.stocks.map(s => ({
        watchlistId,
        tsCode: s.tsCode,
        notes: s.notes ?? null,
        tags: s.tags ?? [],
        targetPrice: s.targetPrice ?? null,
      })),
      skipDuplicates: true,
    })

    await this.invalidateCache(userId)
    return { added: result.count, skipped: dto.stocks.length - result.count }
  }

  // ──────── 行情聚合 ────────

  /**
   * 获取一批股票的最新交易日行情数据。
   * 从 Daily + DailyBasic 表查询最近一个交易日的数据。
   */
  private async getLatestQuotes(tsCodes: string[]): Promise<Map<string, StockQuote>> {
    // 1. 获取最近交易日
    // 2. 查 stock_daily_prices JOIN stock_daily_valuation_metrics
    // 3. 返回 Map<tsCode, { close, pctChg, vol, amount, pe, pb, totalMv }>
  }

  async getWatchlistSummary(userId: number, watchlistId: number) {
    const stocks = await this.getStocks(userId, watchlistId)
    if (!stocks.stocks.length) return { stockCount: 0, upCount: 0, downCount: 0, flatCount: 0 }

    const quotes = stocks.stocks.map(s => s.quote).filter(Boolean)
    return {
      stockCount: stocks.stocks.length,
      upCount: quotes.filter(q => q.pctChg > 0).length,
      downCount: quotes.filter(q => q.pctChg < 0).length,
      flatCount: quotes.filter(q => q.pctChg === 0).length,
      avgPctChg: quotes.reduce((s, q) => s + q.pctChg, 0) / quotes.length,
      totalMv: quotes.reduce((s, q) => s + (q.totalMv ?? 0), 0),
    }
  }

  private async invalidateCache(userId: number) {
    await this.cacheService.invalidateByPrefixes([`watchlist:${userId}`])
  }
}
```

### 3.8 Controller 实现

```typescript
@ApiTags('自选股')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  @ApiOperation({ summary: '获取用户所有自选组' })
  getWatchlists(@CurrentUser() user: TokenPayload) {
    return this.watchlistService.getWatchlists(user.id)
  }

  @Post()
  @ApiOperation({ summary: '创建自选组' })
  createWatchlist(@CurrentUser() user: TokenPayload, @Body() dto: CreateWatchlistDto) {
    return this.watchlistService.createWatchlist(user.id, dto)
  }

  @Put(':id')
  @ApiOperation({ summary: '更新自选组' })
  updateWatchlist(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWatchlistDto,
  ) {
    return this.watchlistService.updateWatchlist(user.id, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除自选组' })
  deleteWatchlist(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.watchlistService.deleteWatchlist(user.id, id)
  }

  @Put('reorder')
  @ApiOperation({ summary: '批量更新自选组排序' })
  reorderWatchlists(@CurrentUser() user: TokenPayload, @Body() dto: ReorderWatchlistsDto) {
    return this.watchlistService.reorderWatchlists(user.id, dto)
  }

  // ── 自选股成员 ──

  @Get(':id/stocks')
  @ApiOperation({ summary: '获取自选组内股票列表（含最新行情）' })
  getStocks(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.watchlistService.getStocks(user.id, id)
  }

  @Post(':id/stocks')
  @ApiOperation({ summary: '添加股票到自选组' })
  addStock(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddWatchlistStockDto,
  ) {
    return this.watchlistService.addStock(user.id, id, dto)
  }

  @Post(':id/stocks/batch')
  @ApiOperation({ summary: '批量添加股票到自选组' })
  batchAddStocks(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BatchAddStocksDto,
  ) {
    return this.watchlistService.batchAddStocks(user.id, id, dto)
  }

  @Put(':id/stocks/:stockId')
  @ApiOperation({ summary: '更新股票备注/标签/目标价' })
  updateStock(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('stockId', ParseIntPipe) stockId: number,
    @Body() dto: UpdateWatchlistStockDto,
  ) {
    return this.watchlistService.updateStock(user.id, id, stockId, dto)
  }

  @Delete(':id/stocks/:stockId')
  @ApiOperation({ summary: '从自选组移除股票' })
  removeStock(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('stockId', ParseIntPipe) stockId: number,
  ) {
    return this.watchlistService.removeStock(user.id, id, stockId)
  }

  @Delete(':id/stocks/batch')
  @ApiOperation({ summary: '批量移除股票' })
  batchRemoveStocks(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BatchRemoveStocksDto,
  ) {
    return this.watchlistService.batchRemoveStocks(user.id, id, dto)
  }

  @Get(':id/summary')
  @ApiOperation({ summary: '获取自选组行情汇总' })
  getWatchlistSummary(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.watchlistService.getWatchlistSummary(user.id, id)
  }

  @Get('overview')
  @ApiOperation({ summary: '所有自选组快速概览' })
  getOverview(@CurrentUser() user: TokenPayload) {
    return this.watchlistService.getOverview(user.id)
  }
}
```

### 3.9 响应格式

#### `GET /watchlist` 响应

```typescript
{
  code: 200,
  data: [
    {
      id: 1,
      name: "价值股候选",
      description: "低 PE 高 ROE 标的",
      isDefault: true,
      sortOrder: 0,
      createdAt: "2026-04-01T10:00:00Z",
      updatedAt: "2026-04-01T10:00:00Z",
      _count: { stocks: 15 }
    },
    // ...
  ]
}
```

#### `GET /watchlist/:id/stocks` 响应

```typescript
{
  code: 200,
  data: {
    stocks: [
      {
        id: 1,
        tsCode: "600519.SH",
        notes: "茅台，关注春节行情",
        tags: ["白酒", "消费"],
        targetPrice: 1800.00,
        sortOrder: 0,
        addedAt: "2026-04-01T10:00:00Z",
        quote: {
          close: 1750.00,
          pctChg: 1.23,
          vol: 25000,
          amount: 450000,
          pe: 28.5,
          pb: 9.2,
          totalMv: 2200000,
          tradeDate: "20260401"
        }
      },
      // ...
    ]
  }
}
```

#### `GET /watchlist/:id/summary` 响应

```typescript
{
  code: 200,
  data: {
    stockCount: 15,
    upCount: 8,
    downCount: 5,
    flatCount: 2,
    avgPctChg: 0.45,
    totalMv: 8500000     // 万元
  }
}
```

### 3.10 常量定义

**文件**：`src/apps/watchlist/constants/watchlist.constant.ts`（🆕 新建）

```typescript
/** 每个自选组内最大股票数量 */
export const MAX_STOCKS_PER_WATCHLIST = 200

/** 批量操作单次最大数量 */
export const BATCH_OPERATION_LIMIT = 50

/** 缓存命名空间 */
export const WATCHLIST_CACHE_NAMESPACE = 'watchlist'

/** 缓存 TTL（秒） */
export const WATCHLIST_CACHE_TTL = 5 * 60  // 5 分钟

/** 行情缓存 TTL（秒）— 交易时段较短，非交易时段较长 */
export const WATCHLIST_QUOTE_CACHE_TTL = 60  // 1 分钟
```

---

## 四、Phase 2：研究笔记（Research Notes）

### 4.1 需求概述

研究人员需要记录对标的的分析思考：

- 对某只股票写研究笔记（"发现财报中现金流异常，需要深入分析"）
- 写非关联到具体股票的通用研究笔记（"宏观环境分析"、"行业研究"）
- 按标签分类管理笔记
- 支持 Markdown 格式
- 按股票代码、标签、时间范围查询

### 4.2 Prisma Schema

**文件**：`prisma/research_note.prisma`（🆕 新建）

```prisma
/// 研究笔记
model ResearchNote {
  id        Int       @id @default(autoincrement())
  userId    Int       @map("user_id")
  tsCode    String?   @map("ts_code") @db.VarChar(16)   /// 可选关联股票代码
  title     String    @db.VarChar(100)
  content   String    @db.Text                           /// Markdown 内容
  tags      String[]  @default([])                       /// 标签数组
  isPinned  Boolean   @default(false) @map("is_pinned")  /// 置顶
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("research_notes")
  @@index([userId, createdAt(sort: Desc)])
  @@index([userId, tsCode])
  @@index([userId, isPinned])
}
```

**User 模型关系补充**（修改 `prisma/user.prisma`）：

```prisma
model User {
  // ... 现有字段 ...
  researchNotes ResearchNote[]  // 🆕 添加反向关系
}
```

### 4.3 模块结构

```
src/apps/research-note/
├── research-note.module.ts
├── research-note.controller.ts
├── research-note.service.ts
└── dto/
    ├── create-research-note.dto.ts
    ├── update-research-note.dto.ts
    └── research-note-query.dto.ts
```

### 4.4 API 设计

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /research-note` | GET | 查询笔记列表（分页 + 筛选） |
| `GET /research-note/:id` | GET | 获取单条笔记详情 |
| `POST /research-note` | POST | 创建笔记 |
| `PUT /research-note/:id` | PUT | 更新笔记 |
| `DELETE /research-note/:id` | DELETE | 删除笔记 |
| `GET /research-note/tags` | GET | 获取当前用户所有使用过的标签 |
| `GET /research-note/stock/:tsCode` | GET | 获取某只股票的所有笔记 |

### 4.5 DTO 定义

#### `CreateResearchNoteDto`

```typescript
class CreateResearchNoteDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}\.(SH|SZ|BJ)$/)
  tsCode?: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string

  @IsString()
  @MinLength(1)
  @MaxLength(10000)                      // 最长 10,000 字符
  content: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @ArrayMaxSize(10)
  tags?: string[]

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean
}
```

#### `UpdateResearchNoteDto`

```typescript
class UpdateResearchNoteDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}\.(SH|SZ|BJ)$/)
  tsCode?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @ArrayMaxSize(10)
  tags?: string[]

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean
}
```

#### `ResearchNoteQueryDto`

```typescript
class ResearchNoteQueryDto {
  @IsOptional()
  @IsString()
  tsCode?: string                        // 按股票筛选

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]                        // 按标签筛选（AND 语义）

  @IsOptional()
  @IsString()
  keyword?: string                       // 标题/内容模糊搜索

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt'])
  sortBy?: string = 'updatedAt'

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string = 'desc'
}
```

### 4.6 Service 实现要点

```typescript
@Injectable()
export class ResearchNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: number, query: ResearchNoteQueryDto) {
    const where: Prisma.ResearchNoteWhereInput = { userId }

    if (query.tsCode) where.tsCode = query.tsCode
    if (query.tags?.length) {
      // PostgreSQL array containment: tags 包含所有指定标签
      where.tags = { hasEvery: query.tags }
    }
    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { content: { contains: query.keyword, mode: 'insensitive' } },
      ]
    }

    const [notes, total] = await Promise.all([
      this.prisma.researchNote.findMany({
        where,
        orderBy: [
          { isPinned: 'desc' },  // 置顶优先
          { [query.sortBy ?? 'updatedAt']: query.sortOrder ?? 'desc' },
        ],
        skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 20),
        take: query.pageSize ?? 20,
      }),
      this.prisma.researchNote.count({ where }),
    ])

    return { notes, total, page: query.page ?? 1, pageSize: query.pageSize ?? 20 }
  }

  async create(userId: number, dto: CreateResearchNoteDto) {
    // 数量限制：每用户最多 500 条笔记
    const count = await this.prisma.researchNote.count({ where: { userId } })
    if (count >= MAX_NOTES_PER_USER) {
      throw new BadRequestException(`笔记数量已达上限（最多 ${MAX_NOTES_PER_USER} 条）`)
    }

    // 如果关联股票，验证股票代码存在
    if (dto.tsCode) {
      const stockExists = await this.prisma.stockBasic.findFirst({
        where: { tsCode: dto.tsCode },
      })
      if (!stockExists) throw new NotFoundException(`股票代码 ${dto.tsCode} 不存在`)
    }

    return this.prisma.researchNote.create({
      data: {
        userId,
        tsCode: dto.tsCode ?? null,
        title: dto.title,
        content: dto.content,
        tags: dto.tags ?? [],
        isPinned: dto.isPinned ?? false,
      },
    })
  }

  async getUserTags(userId: number): Promise<string[]> {
    // 查询用户所有笔记的标签并去重
    const notes = await this.prisma.researchNote.findMany({
      where: { userId },
      select: { tags: true },
    })
    const allTags = notes.flatMap(n => n.tags)
    return [...new Set(allTags)].sort()
  }
}
```

### 4.7 配额常量

```typescript
/** 每用户最大笔记数量 */
export const MAX_NOTES_PER_USER = 500

/** 笔记内容最大长度 */
export const MAX_NOTE_CONTENT_LENGTH = 10000
```

### 4.8 响应格式

#### `GET /research-note` 响应

```typescript
{
  code: 200,
  data: {
    notes: [
      {
        id: 1,
        tsCode: "600519.SH",
        title: "贵州茅台 Q1 财报分析",
        content: "## 核心观点\n\n1. 营收增长 15%...",
        tags: ["白酒", "财报"],
        isPinned: true,
        createdAt: "2026-04-01T10:00:00Z",
        updatedAt: "2026-04-01T12:00:00Z"
      },
      // ...
    ],
    total: 42,
    page: 1,
    pageSize: 20
  }
}
```

#### `GET /research-note/tags` 响应

```typescript
{
  code: 200,
  data: {
    tags: ["事件驱动", "价值投资", "周期股", "宏观", "白酒", "财报"]
  }
}
```

---

## 五、Phase 3：条件订阅（Screener Subscription）

### 5.1 需求概述

用户希望"每天收盘后自动检查有没有新符合条件的票"：

- 基于已保存的选股策略创建订阅
- 系统每天盘后自动执行策略
- 将**新进入**条件的股票通知用户（增量检测）
- 支持暂停/恢复订阅
- 支持不同执行频率（每日/每周一/每月1日）

### 5.2 Prisma Schema

**文件**：`prisma/screener_subscription.prisma`（🆕 新建）

```prisma
/// 订阅执行频率
enum SubscriptionFrequency {
  DAILY                 /// 每个交易日
  WEEKLY                /// 每周一
  MONTHLY               /// 每月第一个交易日

  @@map("subscription_frequency")
}

/// 订阅状态
enum SubscriptionStatus {
  ACTIVE                /// 正常运行
  PAUSED                /// 已暂停
  ERROR                 /// 执行出错（连续失败后自动暂停）

  @@map("subscription_status")
}

/// 条件订阅
model ScreenerSubscription {
  id              Int                     @id @default(autoincrement())
  userId          Int                     @map("user_id")
  name            String                  @db.VarChar(50)
  strategyId      Int?                    @map("strategy_id")  /// 关联已保存策略（可选）
  filters         Json                    @db.JsonB            /// 选股条件快照（独立存储，策略删除不影响订阅）
  sortBy          String?                 @map("sort_by") @db.VarChar(30)
  sortOrder       String?                 @map("sort_order") @db.VarChar(4)
  frequency       SubscriptionFrequency   @default(DAILY)
  status          SubscriptionStatus      @default(ACTIVE)

  lastRunAt       DateTime?               @map("last_run_at")
  lastRunResult   Json?                   @map("last_run_result") @db.JsonB   /// 上次执行结果摘要
  lastMatchCodes  String[]                @default([]) @map("last_match_codes")  /// 上次匹配的股票代码列表
  consecutiveFails Int                    @default(0) @map("consecutive_fails")

  createdAt       DateTime                @default(now()) @map("created_at")
  updatedAt       DateTime                @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("screener_subscriptions")
  @@index([userId])
  @@index([status, frequency])
}

/// 订阅执行日志
model ScreenerSubscriptionLog {
  id              Int       @id @default(autoincrement())
  subscriptionId  Int       @map("subscription_id")
  tradeDate       String    @map("trade_date") @db.VarChar(8)
  matchCount      Int       @map("match_count")        /// 本次匹配数量
  newEntryCount   Int       @map("new_entry_count")    /// 新进入条件的数量
  exitCount       Int       @map("exit_count")         /// 退出条件的数量
  newEntryCodes   String[]  @default([]) @map("new_entry_codes")   /// 新进入的股票代码
  exitCodes       String[]  @default([]) @map("exit_codes")        /// 退出的股票代码
  executionMs     Int       @map("execution_ms")       /// 执行耗时（毫秒）
  success         Boolean   @default(true)
  errorMessage    String?   @map("error_message") @db.Text
  createdAt       DateTime  @default(now()) @map("created_at")

  @@map("screener_subscription_logs")
  @@index([subscriptionId, createdAt(sort: Desc)])
  @@index([subscriptionId, tradeDate])
}
```

**User 模型关系补充**：

```prisma
model User {
  // ... 现有字段 ...
  screenerSubscriptions ScreenerSubscription[]  // 🆕
}
```

### 5.3 模块结构

```
src/apps/screener-subscription/
├── screener-subscription.module.ts
├── screener-subscription.controller.ts
├── screener-subscription.service.ts
├── screener-subscription.processor.ts        // BullMQ 任务处理器
├── screener-subscription.scheduler.ts        // 定时触发器
├── dto/
│   ├── create-subscription.dto.ts
│   ├── update-subscription.dto.ts
│   └── subscription-query.dto.ts
└── constants/
    └── subscription.constant.ts
```

### 5.4 API 设计

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /screener-subscription` | GET | 获取用户所有订阅 |
| `POST /screener-subscription` | POST | 创建订阅 |
| `PUT /screener-subscription/:id` | PUT | 更新订阅 |
| `DELETE /screener-subscription/:id` | DELETE | 删除订阅 |
| `POST /screener-subscription/:id/pause` | POST | 暂停订阅 |
| `POST /screener-subscription/:id/resume` | POST | 恢复订阅 |
| `POST /screener-subscription/:id/run` | POST | 手动触发一次执行 |
| `GET /screener-subscription/:id/logs` | GET | 获取执行日志 |

### 5.5 DTO 定义

#### `CreateSubscriptionDto`

```typescript
class CreateSubscriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string

  @IsOptional()
  @IsInt()
  strategyId?: number                    // 关联已保存策略（会自动复制 filters）

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ScreenerFiltersDto)
  filters?: ScreenerFiltersDto           // 直接传 filters（与 strategyId 二选一）

  @IsOptional()
  @IsEnum(SubscriptionFrequency)
  frequency?: SubscriptionFrequency = 'DAILY'

  @IsOptional()
  @IsString()
  sortBy?: string

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string
}
```

> **`strategyId` 与 `filters` 的关系**：
> - 如果传 `strategyId`，系统查出对应策略的 `filters` 并**复制一份**存入订阅。策略后续修改不影响已创建的订阅。
> - 如果传 `filters`，直接使用。
> - 二者必传其一，不能都不传。

### 5.6 BullMQ 队列设计

#### 队列定义

```typescript
// src/constant/queue.constant.ts 补充
export const SCREENER_SUBSCRIPTION_QUEUE = 'screener-subscription'

export enum ScreenerSubscriptionJobName {
  EXECUTE_SUBSCRIPTION = 'execute_subscription',
  BATCH_EXECUTE = 'batch_execute',        // 批量执行同频率的所有订阅
}
```

#### 定时触发器

```typescript
// screener-subscription.scheduler.ts

@Injectable()
export class ScreenerSubscriptionScheduler {
  constructor(
    @InjectQueue(SCREENER_SUBSCRIPTION_QUEUE)
    private readonly queue: Queue,
  ) {}

  /**
   * 每个交易日 20:30 触发日频订阅执行。
   * 时间选择原因：18:30 Tushare 数据同步 → 20:00 因子预计算 → 20:30 订阅执行。
   */
  @Cron('0 30 20 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async triggerDailySubscriptions() {
    await this.queue.add(
      ScreenerSubscriptionJobName.BATCH_EXECUTE,
      { frequency: 'DAILY', tradeDate: this.getLatestTradeDate() },
      { removeOnComplete: 100, removeOnFail: 50 },
    )
  }

  /**
   * 每周一 20:30 触发周频订阅。
   */
  @Cron('0 30 20 * * 1', { timeZone: 'Asia/Shanghai' })
  async triggerWeeklySubscriptions() {
    await this.queue.add(
      ScreenerSubscriptionJobName.BATCH_EXECUTE,
      { frequency: 'WEEKLY', tradeDate: this.getLatestTradeDate() },
      { removeOnComplete: 100, removeOnFail: 50 },
    )
  }

  /**
   * 每月 1 日 20:30 触发月频订阅。
   */
  @Cron('0 30 20 1 * *', { timeZone: 'Asia/Shanghai' })
  async triggerMonthlySubscriptions() {
    await this.queue.add(
      ScreenerSubscriptionJobName.BATCH_EXECUTE,
      { frequency: 'MONTHLY', tradeDate: this.getLatestTradeDate() },
      { removeOnComplete: 100, removeOnFail: 50 },
    )
  }
}
```

#### 任务处理器

```typescript
// screener-subscription.processor.ts

@Processor(SCREENER_SUBSCRIPTION_QUEUE)
export class ScreenerSubscriptionProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,         // 复用选股器
    private readonly eventsGateway: EventsGateway,
  ) { super() }

  async process(job: Job) {
    if (job.name === ScreenerSubscriptionJobName.BATCH_EXECUTE) {
      return this.batchExecute(job.data)
    }
    if (job.name === ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION) {
      return this.executeSingle(job.data)
    }
  }

  /**
   * 批量执行指定频率的所有活跃订阅。
   */
  private async batchExecute(data: { frequency: string; tradeDate: string }) {
    const subscriptions = await this.prisma.screenerSubscription.findMany({
      where: { status: 'ACTIVE', frequency: data.frequency as SubscriptionFrequency },
    })

    for (const sub of subscriptions) {
      try {
        await this.executeSingle({ subscriptionId: sub.id, tradeDate: data.tradeDate })
      } catch (error) {
        this.logger.error(`订阅 ${sub.id} 执行失败: ${error.message}`)
      }
    }
  }

  /**
   * 执行单个订阅：运行选股 → 增量检测 → 记录日志 → 通知。
   */
  private async executeSingle(data: { subscriptionId: number; tradeDate: string }) {
    const sub = await this.prisma.screenerSubscription.findUnique({
      where: { id: data.subscriptionId },
    })
    if (!sub || sub.status !== 'ACTIVE') return

    const start = Date.now()

    try {
      // 1. 执行选股器
      const result = await this.stockService.screener({
        ...sub.filters,
        sortBy: sub.sortBy,
        sortOrder: sub.sortOrder,
        page: 1,
        pageSize: 500,   // 最多返回 500 只
      } as StockScreenerQueryDto)

      const currentCodes = result.list.map(s => s.tsCode)
      const previousCodes = new Set(sub.lastMatchCodes)

      // 2. 增量检测
      const newEntryCodes = currentCodes.filter(c => !previousCodes.has(c))
      const exitCodes = sub.lastMatchCodes.filter(c => !currentCodes.includes(c))

      // 3. 更新订阅状态
      await this.prisma.screenerSubscription.update({
        where: { id: sub.id },
        data: {
          lastRunAt: new Date(),
          lastRunResult: {
            tradeDate: data.tradeDate,
            matchCount: currentCodes.length,
            newEntryCount: newEntryCodes.length,
            exitCount: exitCodes.length,
          },
          lastMatchCodes: currentCodes,
          consecutiveFails: 0,
        },
      })

      // 4. 写入日志
      await this.prisma.screenerSubscriptionLog.create({
        data: {
          subscriptionId: sub.id,
          tradeDate: data.tradeDate,
          matchCount: currentCodes.length,
          newEntryCount: newEntryCodes.length,
          exitCount: exitCodes.length,
          newEntryCodes,
          exitCodes,
          executionMs: Date.now() - start,
        },
      })

      // 5. 如果有新进入的股票，通过 WebSocket 通知用户
      if (newEntryCodes.length > 0) {
        this.eventsGateway.emitToUser(sub.userId, 'screener_subscription_alert', {
          subscriptionId: sub.id,
          subscriptionName: sub.name,
          tradeDate: data.tradeDate,
          newEntryCodes,
          exitCodes,
          totalMatch: currentCodes.length,
        })
      }

    } catch (error) {
      // 错误处理：记录失败日志，连续失败 3 次后自动暂停
      const newFails = sub.consecutiveFails + 1
      await this.prisma.screenerSubscription.update({
        where: { id: sub.id },
        data: {
          consecutiveFails: newFails,
          ...(newFails >= 3 && { status: 'ERROR' }),
        },
      })

      await this.prisma.screenerSubscriptionLog.create({
        data: {
          subscriptionId: sub.id,
          tradeDate: data.tradeDate,
          matchCount: 0,
          newEntryCount: 0,
          exitCount: 0,
          executionMs: Date.now() - start,
          success: false,
          errorMessage: error.message,
        },
      })
    }
  }
}
```

### 5.7 配额与限制

```typescript
/** 每用户最大订阅数量 */
export const MAX_SUBSCRIPTIONS_PER_USER = 10

/** 连续失败次数阈值（超过后自动暂停） */
export const MAX_CONSECUTIVE_FAILS = 3

/** 执行日志保留天数 */
export const LOG_RETENTION_DAYS = 90
```

### 5.8 响应格式

#### `GET /screener-subscription` 响应

```typescript
{
  code: 200,
  data: {
    subscriptions: [
      {
        id: 1,
        name: "低估值高成长日监控",
        strategyId: 5,
        filters: { /* ... */ },
        frequency: "DAILY",
        status: "ACTIVE",
        lastRunAt: "2026-04-01T12:30:00Z",
        lastRunResult: {
          tradeDate: "20260401",
          matchCount: 23,
          newEntryCount: 3,
          exitCount: 1
        },
        consecutiveFails: 0,
        createdAt: "2026-03-15T10:00:00Z"
      }
    ]
  }
}
```

#### `GET /screener-subscription/:id/logs` 响应

```typescript
{
  code: 200,
  data: {
    logs: [
      {
        id: 100,
        tradeDate: "20260401",
        matchCount: 23,
        newEntryCount: 3,
        exitCount: 1,
        newEntryCodes: ["000001.SZ", "600036.SH", "000858.SZ"],
        exitCodes: ["601398.SH"],
        executionMs: 1250,
        success: true,
        createdAt: "2026-04-01T12:30:05Z"
      },
      // ...
    ],
    total: 30,
    page: 1,
    pageSize: 20
  }
}
```

---

## 六、Phase 4：策略草稿箱（Strategy Draft）

### 6.1 需求概述

用户在配置回测参数时，可能需要多次调整才能最终提交。草稿箱让用户可以：

- 保存未完成的回测配置（策略类型 + 参数 + 日期范围 + 成本设置等）
- 前端自动保存（类似 Google Docs）
- 下次登录时加载上次的配置继续编辑
- 从草稿快速提交回测
- 管理多个草稿

### 6.2 Prisma Schema

**文件**：`prisma/strategy_draft.prisma`（🆕 新建）

```prisma
/// 策略草稿箱
model StrategyDraft {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  name      String   @db.VarChar(100)
  config    Json     @db.JsonB           /// 回测配置快照（与 CreateBacktestRunDto 结构对齐）
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("strategy_drafts")
  @@index([userId, updatedAt(sort: Desc)])
  @@unique([userId, name])
}
```

**User 模型关系补充**：

```prisma
model User {
  // ... 现有字段 ...
  strategyDrafts StrategyDraft[]  // 🆕
}
```

### 6.3 模块结构

```
src/apps/strategy-draft/
├── strategy-draft.module.ts
├── strategy-draft.controller.ts
├── strategy-draft.service.ts
└── dto/
    ├── create-strategy-draft.dto.ts
    ├── update-strategy-draft.dto.ts
    └── submit-draft.dto.ts
```

### 6.4 API 设计

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /strategy-draft` | GET | 获取用户所有草稿（按更新时间倒序） |
| `GET /strategy-draft/:id` | GET | 获取单个草稿详情 |
| `POST /strategy-draft` | POST | 创建草稿 |
| `PUT /strategy-draft/:id` | PUT | 更新草稿（自动保存调用此接口） |
| `DELETE /strategy-draft/:id` | DELETE | 删除草稿 |
| `POST /strategy-draft/:id/submit` | POST | 从草稿提交回测任务 |

### 6.5 DTO 定义

#### `CreateStrategyDraftDto`

```typescript
class CreateStrategyDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string

  @IsObject()
  config: Record<string, any>            // 灵活 JSON，前端序列化的回测配置
}
```

#### `UpdateStrategyDraftDto`

```typescript
class UpdateStrategyDraftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string

  @IsOptional()
  @IsObject()
  config?: Record<string, any>
}
```

#### `SubmitDraftDto`

```typescript
class SubmitDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string                          // 回测任务名称（不传则用草稿名称）
}
```

### 6.6 Service 实现要点

```typescript
@Injectable()
export class StrategyDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backtestRunService: BacktestRunService,   // 注入回测服务
  ) {}

  async getDrafts(userId: number) {
    return this.prisma.strategyDraft.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async createDraft(userId: number, dto: CreateStrategyDraftDto) {
    // 数量限制
    const count = await this.prisma.strategyDraft.count({ where: { userId } })
    if (count >= MAX_DRAFTS_PER_USER) {
      throw new BadRequestException(`草稿数量已达上限（最多 ${MAX_DRAFTS_PER_USER} 个）`)
    }

    try {
      return await this.prisma.strategyDraft.create({
        data: { userId, name: dto.name, config: dto.config },
      })
    } catch (e) {
      if (e.code === 'P2002') throw new ConflictException('同名草稿已存在')
      throw e
    }
  }

  async updateDraft(userId: number, id: number, dto: UpdateStrategyDraftDto) {
    const existing = await this.prisma.strategyDraft.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('草稿不存在')

    try {
      return await this.prisma.strategyDraft.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.config !== undefined && { config: dto.config }),
        },
      })
    } catch (e) {
      if (e.code === 'P2002') throw new ConflictException('同名草稿已存在')
      throw e
    }
  }

  /**
   * 从草稿提交回测任务。
   * 将草稿中的 config 转换为 CreateBacktestRunDto 并提交。
   */
  async submitDraft(userId: number, draftId: number, dto: SubmitDraftDto) {
    const draft = await this.prisma.strategyDraft.findFirst({
      where: { id: draftId, userId },
    })
    if (!draft) throw new NotFoundException('草稿不存在')

    // 将 config JSON 转换为回测提交 DTO
    const backtestDto = {
      ...draft.config,
      name: dto.name ?? draft.name,
    } as CreateBacktestRunDto

    // 调用回测服务提交任务
    return this.backtestRunService.createRun(backtestDto, userId)
  }

  async deleteDraft(userId: number, id: number) {
    const existing = await this.prisma.strategyDraft.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('草稿不存在')

    await this.prisma.strategyDraft.delete({ where: { id } })
    return { message: '删除成功' }
  }
}
```

### 6.7 `config` 字段结构约定

`config` 是一个灵活的 JSON 字段，其结构与 `CreateBacktestRunDto` 对齐，但所有字段都是可选的（因为草稿可能是不完整的）：

```typescript
interface StrategyDraftConfig {
  strategyType?: string           // 策略类型
  strategyConfig?: Record<string, any>  // 策略配置
  startDate?: string              // 回测起始日
  endDate?: string                // 回测结束日
  benchmarkTsCode?: string        // 基准指数
  universe?: string               // 股票池
  customUniverse?: string[]       // 自定义股票池
  initialCapital?: number         // 初始资金
  rebalanceFrequency?: string     // 调仓频率
  priceMode?: string              // 成交价模式
  commissionRate?: number         // 佣金费率
  stampDutyRate?: number          // 印花税率
  minCommission?: number          // 最低佣金
  slippageBps?: number            // 滑点基点
}
```

### 6.8 配额常量

```typescript
/** 每用户最大草稿数量 */
export const MAX_DRAFTS_PER_USER = 20
```

### 6.9 响应格式

#### `GET /strategy-draft` 响应

```typescript
{
  code: 200,
  data: {
    drafts: [
      {
        id: 1,
        name: "低估值轮动策略 v2",
        config: {
          strategyType: "SCREENING_ROTATION",
          strategyConfig: { /* ... */ },
          startDate: "2024-01-01",
          endDate: "2026-03-31",
          initialCapital: 1000000,
          // ...
        },
        createdAt: "2026-04-01T10:00:00Z",
        updatedAt: "2026-04-01T15:30:00Z"
      },
      // ...
    ]
  }
}
```

#### `POST /strategy-draft/:id/submit` 响应

```typescript
{
  code: 200,
  data: {
    id: "clxxx...",           // 回测任务 ID
    status: "QUEUED",
    jobId: "bull:backtest:123"
  }
}
```

---

## 七、WebSocket 事件设计

### 7.1 现有 EventsGateway 扩展

在 `src/websocket/events.gateway.ts` 中添加以下事件支持：

| 事件名 | 方向 | 触发场景 | Payload |
|--------|------|---------|---------|
| `subscribe_watchlist` | Client→Server | 订阅自选组变更 | `{ watchlistId: number }` |
| `unsubscribe_watchlist` | Client→Server | 取消订阅 | `{ watchlistId: number }` |
| `watchlist_updated` | Server→Client | 自选组成员变更 | `{ watchlistId, action, tsCode? }` |
| `screener_subscription_alert` | Server→Client | 订阅触发新匹配 | `{ subscriptionId, name, newEntryCodes[], exitCodes[], totalMatch }` |

### 7.2 按用户推送机制

当前 `EventsGateway` 使用 `room` 机制推送回测进度。需要扩展为支持按 `userId` 推送：

```typescript
// events.gateway.ts 新增方法

/**
 * 向指定用户推送消息。
 * 客户端连接时自动加入 user:${userId} 房间。
 */
emitToUser(userId: number, event: string, data: any) {
  this.server.to(`user:${userId}`).emit(event, data)
}

// 连接时自动加入用户房间
handleConnection(client: Socket) {
  // ... 现有逻辑 ...
  // 从 JWT 解析 userId
  const userId = this.extractUserId(client)
  if (userId) {
    client.join(`user:${userId}`)
  }
}
```

---

## 八、安全与权限设计

### 8.1 通用安全原则

| 原则 | 实现方式 |
|------|---------|
| **身份验证** | 所有端点使用 `@UseGuards(JwtAuthGuard)` |
| **数据隔离** | 所有查询/修改操作包含 `WHERE userId = ?` |
| **归属校验** | 更新/删除前先查询确认 `userId` 匹配 |
| **配额限制** | 创建前检查当前用户的资源数量 |
| **输入校验** | 使用 `class-validator` 装饰器，严格限制长度/格式/范围 |
| **级联删除** | 所有子表通过 `onDelete: Cascade` 关联，删除用户时自动清理 |

### 8.2 各模块配额汇总

| 资源 | 默认上限 | 可配级别 | 管理员 |
|------|---------|---------|--------|
| 自选组数量 | 10 个 | `User.watchlistLimit` | 无限制 |
| 自选组内股票数 | 200 只 | 常量（全局） | 同 |
| 研究笔记数量 | 500 条 | 常量（全局） | 同 |
| 条件订阅数量 | 10 个 | 常量（全局） | 同 |
| 策略草稿数量 | 20 个 | 常量（全局） | 同 |

### 8.3 防滥用

- **批量操作限流**：批量添加/删除每次最多 50 条
- **订阅执行限流**：每个订阅每天最多触发 1 次（调度器控制）
- **手动执行冷却**：手动触发订阅至少间隔 5 分钟
- **笔记内容限制**：单条笔记最长 10,000 字符

---

## 九、缓存策略

### 9.1 新增缓存命名空间

在 `src/constant/cache.constant.ts` 中添加：

```typescript
export const CACHE_NAMESPACE = {
  // ... 现有 ...
  WATCHLIST: 'watchlist',                  // 自选组列表
  WATCHLIST_STOCKS: 'watchlist-stocks',    // 自选组成员 + 行情
}

export const CACHE_KEY_PREFIX = {
  // ... 现有 ...
  WATCHLIST_LIST: 'watchlist:list',        // watchlist:list:${userId}
  WATCHLIST_STOCKS: 'watchlist:stocks',    // watchlist:stocks:${watchlistId}
  WATCHLIST_SUMMARY: 'watchlist:summary',  // watchlist:summary:${watchlistId}
  WATCHLIST_OVERVIEW: 'watchlist:overview', // watchlist:overview:${userId}
}
```

### 9.2 缓存 TTL

| 数据 | TTL | 说明 |
|------|-----|------|
| 自选组列表 | 5 分钟 | 变更不频繁 |
| 自选组内股票（含行情） | 1 分钟 | 行情数据需要较新 |
| 自选组摘要 | 1 分钟 | 同上 |
| 研究笔记 | 不缓存 | 量小，直接查 DB |
| 订阅列表 | 5 分钟 | 变更不频繁 |

### 9.3 缓存失效

- **自选组 CRUD** → 失效 `watchlist:list:${userId}` + `watchlist:overview:${userId}`
- **自选股增减** → 失效 `watchlist:stocks:${watchlistId}` + `watchlist:summary:${watchlistId}`
- **Tushare 日行情同步完成** → 失效 `watchlist:stocks:*` + `watchlist:summary:*`（通过 `SYNC_INVALIDATION_PREFIXES` 机制）

---

## 十、实施顺序与依赖关系

```
Phase 1: 自选股管理（3-5 天）
├── 1.1 Prisma Schema（watchlist.prisma + user.prisma 关系）
├── 1.2 prisma migrate dev
├── 1.3 常量定义（watchlist.constant.ts）
├── 1.4 DTO 文件（7 个 DTO）
├── 1.5 WatchlistService（CRUD + 行情聚合）
├── 1.6 WatchlistController（13 个端点）
├── 1.7 WatchlistModule 注册到 AppModule
├── 1.8 缓存命名空间 + 失效逻辑
└── 1.9 编译验证 + API 测试

Phase 2: 研究笔记（2-3 天）              ← 可与 Phase 1 并行
├── 2.1 Prisma Schema（research_note.prisma）
├── 2.2 prisma migrate dev
├── 2.3 DTO 文件
├── 2.4 ResearchNoteService
├── 2.5 ResearchNoteController（7 个端点）
├── 2.6 ResearchNoteModule 注册
└── 2.7 编译验证 + API 测试

Phase 3: 条件订阅（3-5 天）
├── 3.1 Prisma Schema（screener_subscription.prisma）
├── 3.2 prisma migrate dev
├── 3.3 BullMQ 队列定义
├── 3.4 DTO 文件
├── 3.5 ScreenerSubscriptionService
├── 3.6 ScreenerSubscriptionProcessor（BullMQ 任务处理）
├── 3.7 ScreenerSubscriptionScheduler（Cron 触发）
├── 3.8 ScreenerSubscriptionController（8 个端点）
├── 3.9 EventsGateway 扩展（emitToUser）
├── 3.10 ScreenerSubscriptionModule 注册
└── 3.11 编译验证 + 定时任务测试

Phase 4: 策略草稿箱（2-3 天）            ← 可与 Phase 3 并行
├── 4.1 Prisma Schema（strategy_draft.prisma）
├── 4.2 prisma migrate dev
├── 4.3 DTO 文件
├── 4.4 StrategyDraftService（含 submit 调用回测）
├── 4.5 StrategyDraftController（6 个端点）
├── 4.6 StrategyDraftModule 注册
└── 4.7 编译验证 + API 测试
```

**时序关系**：

```
                    ┌─ Phase 1: 自选股 (3-5天) ─┐
                    │                           │
          可并行 →  ├─ Phase 2: 研究笔记 (2-3天) ┤
                    │                           │
                    └───────────────────────────┘
                                ↓
                    ┌─ Phase 3: 条件订阅 (3-5天) ─┐
                    │                             │
          可并行 →  ├─ Phase 4: 策略草稿 (2-3天)  ─┤
                    │                             │
                    └─────────────────────────────┘
```

> Phase 3 依赖选股器正常运作，但不依赖 Phase 1/2。
> Phase 4 依赖回测模块基础就绪，但不依赖 Phase 1/2/3。
> 总工时预估：**10-16 天**（可并行时 7-10 天）。

---

## 十一、文件变更汇总

### 新增文件

| 文件路径 | 阶段 | 说明 |
|---------|------|------|
| `prisma/watchlist.prisma` | P1 | Watchlist + WatchlistStock 两个模型 |
| `src/apps/watchlist/watchlist.module.ts` | P1 | 模块注册 |
| `src/apps/watchlist/watchlist.controller.ts` | P1 | 13 个端点 |
| `src/apps/watchlist/watchlist.service.ts` | P1 | CRUD + 行情聚合 |
| `src/apps/watchlist/dto/*.dto.ts` | P1 | 7 个 DTO 文件 |
| `src/apps/watchlist/constants/watchlist.constant.ts` | P1 | 配额和缓存常量 |
| `prisma/research_note.prisma` | P2 | ResearchNote 模型 |
| `src/apps/research-note/research-note.module.ts` | P2 | 模块注册 |
| `src/apps/research-note/research-note.controller.ts` | P2 | 7 个端点 |
| `src/apps/research-note/research-note.service.ts` | P2 | CRUD + 标签查询 |
| `src/apps/research-note/dto/*.dto.ts` | P2 | 3 个 DTO 文件 |
| `prisma/screener_subscription.prisma` | P3 | ScreenerSubscription + ScreenerSubscriptionLog 两个模型 + 两个枚举 |
| `src/apps/screener-subscription/screener-subscription.module.ts` | P3 | 模块注册 |
| `src/apps/screener-subscription/screener-subscription.controller.ts` | P3 | 8 个端点 |
| `src/apps/screener-subscription/screener-subscription.service.ts` | P3 | CRUD |
| `src/apps/screener-subscription/screener-subscription.processor.ts` | P3 | BullMQ 任务处理 |
| `src/apps/screener-subscription/screener-subscription.scheduler.ts` | P3 | Cron 定时触发 |
| `src/apps/screener-subscription/dto/*.dto.ts` | P3 | 3 个 DTO 文件 |
| `src/apps/screener-subscription/constants/subscription.constant.ts` | P3 | 配额常量 |
| `prisma/strategy_draft.prisma` | P4 | StrategyDraft 模型 |
| `src/apps/strategy-draft/strategy-draft.module.ts` | P4 | 模块注册 |
| `src/apps/strategy-draft/strategy-draft.controller.ts` | P4 | 6 个端点 |
| `src/apps/strategy-draft/strategy-draft.service.ts` | P4 | CRUD + 提交回测 |
| `src/apps/strategy-draft/dto/*.dto.ts` | P4 | 3 个 DTO 文件 |

### 修改文件

| 文件路径 | 阶段 | 改动说明 |
|---------|------|---------|
| `prisma/user.prisma` | P1-P4 | 添加 4 个反向关系字段 |
| `src/app.module.ts` | P1-P4 | 逐步 import 4 个新模块 |
| `src/websocket/events.gateway.ts` | P3 | 添加 `emitToUser()` 方法 + 连接时加入用户房间 |
| `src/constant/cache.constant.ts` | P1 | 添加 watchlist 缓存命名空间和 key 前缀 |
| `src/constant/queue.constant.ts` | P3 | 添加 `SCREENER_SUBSCRIPTION_QUEUE` 常量 |

### 新增端点汇总

| 模块 | 端点数 | 方法分布 |
|------|--------|---------|
| 自选股管理 | 13 | GET×4 + POST×3 + PUT×3 + DELETE×3 |
| 研究笔记 | 7 | GET×4 + POST×1 + PUT×1 + DELETE×1 |
| 条件订阅 | 8 | GET×2 + POST×4 + PUT×1 + DELETE×1 |
| 策略草稿 | 6 | GET×2 + POST×2 + PUT×1 + DELETE×1 |
| **合计** | **34** | |

> 实现完成后，系统总端点数将从 ~90 增至 ~124。

---

_本设计文档基于 `quant-code-cpx/server-code` 仓库当前代码状态编写，实施时请以最新代码为准。_
