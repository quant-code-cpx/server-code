# 选股策略保存（Screener Strategy Save）— 后端实现规划

> **目标读者**：AI 代码生成助手。请严格按照本文定义的接口签名、字段名称、数据库模型实现。

---

## 一、功能总览

在现有选股器（`POST /stock/screener`）基础上，新增**用户自定义策略持久化**能力。用户可以将当前选股条件保存为命名策略，后续一键加载、编辑或删除。

> 与现有预设的关系：
>
> - `POST /stock/screener/presets` 返回的是**系统内置预设**（硬编码在 `BUILT_IN_PRESETS` 常量中），不可修改。
> - 新增策略保存功能是**用户级自定义策略**，存储在数据库中，支持 CRUD。
> - 前端加载策略列表时，将系统预设和用户策略合并展示，用户策略支持编辑/删除，系统预设仅支持加载。

| 接口                                    | 方法   | 功能             | 是否需新建 |
| --------------------------------------- | ------ | ---------------- | ---------- |
| `GET /stock/screener/strategies`        | GET    | 获取用户策略列表 | 🆕 新建    |
| `POST /stock/screener/strategies`       | POST   | 创建新策略       | 🆕 新建    |
| `PUT /stock/screener/strategies/:id`    | PUT    | 更新策略         | 🆕 新建    |
| `DELETE /stock/screener/strategies/:id` | DELETE | 删除策略         | 🆕 新建    |
| `POST /stock/screener/presets`          | POST   | 系统预设（已有） | ✅ 已有    |

---

## 二、数据库模型

### 2.1 Prisma Schema — `screener_strategy.prisma`

在 `prisma/` 目录下新建文件：

```prisma
model ScreenerStrategy {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  name      String   @db.VarChar(50)
  description String? @db.VarChar(200)
  filters   Json     @db.JsonB
  sortBy    String?  @map("sort_by") @db.VarChar(30)
  sortOrder String?  @map("sort_order") @db.VarChar(4) // "asc" | "desc"
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("screener_strategies")
  @@index([userId])
  @@unique([userId, name]) // 同一用户不能有重名策略
}
```

**注意**：需要在 `user.prisma` 的 `User` 模型中添加反向关系：

```prisma
model User {
  // ... 现有字段 ...
  screenerStrategies ScreenerStrategy[]
}
```

### 2.2 迁移

```bash
npx prisma migrate dev --name add_screener_strategies
```

### 2.3 字段说明

| 字段          | 类型         | 说明                                                    |
| ------------- | ------------ | ------------------------------------------------------- |
| `id`          | Int (PK)     | 自增主键                                                |
| `userId`      | Int (FK)     | 关联 `User.id`，级联删除                                |
| `name`        | VarChar(50)  | 策略名称，同一用户下唯一                                |
| `description` | VarChar(200) | 可选描述                                                |
| `filters`     | JSONB        | 选股条件，结构同 `ScreenerFilters`（不含分页/排序字段） |
| `sortBy`      | VarChar(30)  | 策略默认排序字段，可选                                  |
| `sortOrder`   | VarChar(4)   | 策略默认排序方向，可选                                  |
| `createdAt`   | DateTime     | 创建时间                                                |
| `updatedAt`   | DateTime     | 最后更新时间                                            |

### 2.4 用户策略数量限制

为避免滥用，每个用户最多保存 **20** 条自定义策略。创建时在 service 层检查数量，超过限制返回 400。

---

## 三、核心接口详细设计

### 3.1 `POST /stock/screener/strategies` — 创建策略

#### 请求 DTO：`CreateScreenerStrategyDto`

```typescript
class CreateScreenerStrategyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string

  @IsObject()
  @ValidateNested()
  @Type(() => ScreenerFiltersDto)
  filters: ScreenerFiltersDto // 复用已有 ScreenerFilters 的字段验证

  @IsOptional()
  @IsEnum(ScreenerSortBy)
  sortBy?: string

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string
}
```

> `ScreenerFiltersDto` 复用 `StockScreenerQueryDto` 中除分页和排序之外的字段定义（提取为独立类）。

#### 响应

```typescript
// 201 Created
interface CreateStrategyResponse {
  id: number
  name: string
  description: string | null
  filters: Partial<ScreenerFilters>
  sortBy: string | null
  sortOrder: string | null
  createdAt: string // ISO 8601
  updatedAt: string
}
```

#### 错误码

| HTTP 状态 | 场景                   |
| --------- | ---------------------- |
| 400       | 参数校验失败           |
| 400       | 策略数量超过 20 条上限 |
| 409       | 同名策略已存在         |
| 401       | 未登录                 |

#### Service 实现要点

```typescript
async createStrategy(userId: number, dto: CreateScreenerStrategyDto) {
  // 1. 检查数量限制
  const count = await this.prisma.screenerStrategy.count({ where: { userId } });
  if (count >= 20) {
    throw new BadRequestException('策略数量已达上限（最多 20 条）');
  }

  // 2. 创建（利用 @@unique([userId, name]) 约束处理重名）
  try {
    return await this.prisma.screenerStrategy.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description ?? null,
        filters: dto.filters as any,
        sortBy: dto.sortBy ?? null,
        sortOrder: dto.sortOrder ?? null,
      },
    });
  } catch (e) {
    if (e.code === 'P2002') {
      throw new ConflictException('同名策略已存在');
    }
    throw e;
  }
}
```

---

### 3.2 `GET /stock/screener/strategies` — 获取用户策略列表

#### 请求：无参数（从 JWT 获取 userId）

#### 响应

```typescript
interface StrategyListResponse {
  strategies: Array<{
    id: number
    name: string
    description: string | null
    filters: Partial<ScreenerFilters>
    sortBy: string | null
    sortOrder: string | null
    createdAt: string
    updatedAt: string
  }>
}
```

#### Service 实现要点

```typescript
async getStrategies(userId: number) {
  const strategies = await this.prisma.screenerStrategy.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
  return { strategies };
}
```

---

### 3.3 `PUT /stock/screener/strategies/:id` — 更新策略

#### 请求 DTO：`UpdateScreenerStrategyDto`

```typescript
class UpdateScreenerStrategyDto {
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
  @IsObject()
  @ValidateNested()
  @Type(() => ScreenerFiltersDto)
  filters?: ScreenerFiltersDto

  @IsOptional()
  @IsEnum(ScreenerSortBy)
  sortBy?: string

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string
}
```

#### 响应

与创建接口相同结构，返回更新后的完整策略对象。

#### 错误码

| HTTP 状态 | 场景                       |
| --------- | -------------------------- |
| 400       | 参数校验失败               |
| 404       | 策略不存在或不属于当前用户 |
| 409       | 更新后的名称与已有策略重名 |
| 401       | 未登录                     |

#### Service 实现要点

```typescript
async updateStrategy(userId: number, id: number, dto: UpdateScreenerStrategyDto) {
  // 1. 查找并验证归属
  const existing = await this.prisma.screenerStrategy.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    throw new NotFoundException('策略不存在');
  }

  // 2. 更新
  try {
    return await this.prisma.screenerStrategy.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.filters !== undefined && { filters: dto.filters as any }),
        ...(dto.sortBy !== undefined && { sortBy: dto.sortBy }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  } catch (e) {
    if (e.code === 'P2002') {
      throw new ConflictException('同名策略已存在');
    }
    throw e;
  }
}
```

---

### 3.4 `DELETE /stock/screener/strategies/:id` — 删除策略

#### 请求：URL 参数 `id`（从 JWT 获取 userId）

#### 响应

```typescript
// 200 OK
{
  message: '删除成功'
}
```

#### 错误码

| HTTP 状态 | 场景                       |
| --------- | -------------------------- |
| 404       | 策略不存在或不属于当前用户 |
| 401       | 未登录                     |

#### Service 实现要点

```typescript
async deleteStrategy(userId: number, id: number) {
  const existing = await this.prisma.screenerStrategy.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    throw new NotFoundException('策略不存在');
  }

  await this.prisma.screenerStrategy.delete({ where: { id } });
  return { message: '删除成功' };
}
```

---

## 四、Controller 实现

在现有 `stock.controller.ts` 中新增以下端点（放在 screener 相关端点附近）：

```typescript
@Get('screener/strategies')
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: '获取用户选股策略列表' })
getStrategies(@Req() req: RequestWithUser) {
  return this.stockService.getStrategies(req.user.id);
}

@Post('screener/strategies')
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: '创建选股策略' })
createStrategy(@Req() req: RequestWithUser, @Body() dto: CreateScreenerStrategyDto) {
  return this.stockService.createStrategy(req.user.id, dto);
}

@Put('screener/strategies/:id')
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: '更新选股策略' })
updateStrategy(
  @Req() req: RequestWithUser,
  @Param('id', ParseIntPipe) id: number,
  @Body() dto: UpdateScreenerStrategyDto,
) {
  return this.stockService.updateStrategy(req.user.id, id, dto);
}

@Delete('screener/strategies/:id')
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: '删除选股策略' })
deleteStrategy(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number) {
  return this.stockService.deleteStrategy(req.user.id, id);
}
```

---

## 五、修改现有预设接口

`POST /stock/screener/presets` 的响应中为每个预设增加 `type: 'builtin'` 字段，便于前端区分：

```typescript
async getScreenerPresets() {
  return {
    presets: BUILT_IN_PRESETS.map((p) => ({ ...p, type: 'builtin' as const })),
  };
}
```

用户策略列表返回时自动加上 `type: 'user'`：

```typescript
async getStrategies(userId: number) {
  const strategies = await this.prisma.screenerStrategy.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
  return {
    strategies: strategies.map((s) => ({ ...s, type: 'user' as const })),
  };
}
```

---

## 六、安全要点

1. **所有策略接口需 `JwtAuthGuard`**：确保只有已登录用户可操作。
2. **归属校验**：更新和删除时必须校验 `userId === req.user.id`，防止越权。
3. **filters 字段校验**：使用与 `StockScreenerQueryDto` 相同的验证装饰器，防止注入恶意 JSON。
4. **名称长度限制**：50 字符，防止超长输入。
5. **数量限制**：每用户最多 20 条，在 service 创建时检查。

---

## 七、实现顺序

1. 新建 `prisma/screener_strategy.prisma`，修改 `user.prisma` 添加关系
2. 执行 `prisma migrate dev`
3. 新建 `CreateScreenerStrategyDto` 和 `UpdateScreenerStrategyDto`（可复用已有 `ScreenerFiltersDto`）
4. 在 `stock.service.ts` 中实现 4 个方法
5. 在 `stock.controller.ts` 中添加 4 个端点
6. 修改 `getScreenerPresets()` 返回 `type` 字段
7. 测试 CRUD 流程
