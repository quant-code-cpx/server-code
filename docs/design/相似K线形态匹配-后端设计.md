# 相似 K 线形态匹配（Similar K-line Pattern Matching）— 后端设计方案

> **目标读者**：AI 代码生成助手 / 开发者。请严格按照本文定义的接口签名、字段名称、算法逻辑实现。
>
> **对应待办**：`待办清单.md` P3 → 高级量化工具 → 相似 K 线形态匹配
>
> **日期**：2026-04-11

---

## 目录

1. [功能总览](#一功能总览)
2. [现状评估与数据源](#二现状评估与数据源)
3. [算法设计](#三算法设计)
4. [接口详细设计](#四接口详细设计)
5. [性能优化策略](#五性能优化策略)
6. [文件变更汇总](#六文件变更汇总)

---

## 一、功能总览

用户选择一段 K 线形态（指定股票 + 起止日期），系统在全市场历史数据中搜索最相似的 K 线片段，按相似度排序返回。

| 接口                  | 路径                                  | 功能说明                                   | 是否需新建表 |
| --------------------- | ------------------------------------- | ------------------------------------------ | ------------ |
| 形态搜索              | `POST /pattern/search`                | 输入查询形态，全市场搜索相似 K 线          | 否           |
| 预定义形态模板列表    | `GET /pattern/templates`              | 返回经典形态模板（头肩顶、双底、旗形等）   | 否           |
| 形态搜索（自定义序列）| `POST /pattern/search-by-series`      | 输入自定义价格序列，全市场搜索相似形态     | 否           |

**不需要新增 Tushare 数据同步**。所有功能基于已有的 `stock_daily_prices` + `stock_adjustment_factors` 表实现。

---

## 二、现状评估与数据源

### 2.1 可用数据

| 数据             | Prisma Model | 数据库表名                   | 说明                                    |
| ---------------- | ------------ | ---------------------------- | --------------------------------------- |
| 个股日线（OHLCV）| `Daily`      | `stock_daily_prices`         | 含 open/high/low/close/vol/amount       |
| 复权因子         | `AdjFactor`  | `stock_adjustment_factors`   | 前复权价格 = 原始价 × (当日因子/最新因子) |
| 股票基本信息     | `StockBasic` | `stock_basic_profiles`       | 过滤退市股/ST 股                        |

### 2.2 已有能力

| 能力                       | 位置                                          | 说明                               |
| -------------------------- | --------------------------------------------- | ---------------------------------- |
| OHLCV 查询 + 前复权处理   | `StockAnalysisService.fetchOhlcvRows()`       | 已实现带 adjFactor 的行情查询      |
| 前复权计算                 | `StockAnalysisService.applyAdjFactor()`       | 已有前复权处理逻辑                 |
| 技术指标纯函数库           | `stock/utils/technical-indicators.ts`         | 可复用 `OhlcvBar` 接口定义         |
| 多周期支持                 | `PERIOD_TABLE_MAP`（D / W / M）               | 日/周/月三种粒度                   |

### 2.3 功能差距

| 缺失环节             | 当前状态 | 本文覆盖 |
| -------------------- | -------- | -------- |
| 归一化价格序列提取   | 无       | ✅       |
| DTW 距离计算         | 无       | ✅       |
| 归一化欧氏距离计算   | 无       | ✅       |
| 全市场滑动窗口搜索   | 无       | ✅       |
| 预定义经典形态模板   | 无       | ✅       |

---

## 三、算法设计

### 3.1 形态归一化

K 线形态匹配的核心前提是消除价格绝对值差异，只保留**形状特征**。

```typescript
/**
 * 将价格序列归一化到 [0, 1] 区间。
 * 归一化公式：normalized[i] = (price[i] - min) / (max - min)
 * 如果 max === min（平盘），返回全 0.5 序列。
 */
function normalizeToUnitRange(prices: number[]): number[] {
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min
  if (range === 0) return prices.map(() => 0.5)
  return prices.map(p => (p - min) / range)
}
```

使用**前复权收盘价**作为输入序列。

### 3.2 相似度距离算法

提供两种算法，用户可选：

#### 归一化欧氏距离（Normalized Euclidean Distance）

计算复杂度 $O(n)$，适合快速粗筛。

$$
d_{NED}(A, B) = \sqrt{\frac{1}{n} \sum_{i=1}^{n} (a_i - b_i)^2}
$$

其中 $A = (a_1, \ldots, a_n)$、$B = (b_1, \ldots, b_n)$ 为归一化后的等长序列。

```typescript
function normalizedEuclideanDistance(a: number[], b: number[]): number {
  const n = a.length
  let sumSqDiff = 0
  for (let i = 0; i < n; i++) {
    const diff = a[i] - b[i]
    sumSqDiff += diff * diff
  }
  return Math.sqrt(sumSqDiff / n)
}
```

#### 动态时间弯曲（DTW，Dynamic Time Warping）

允许时间轴伸缩，适合检测变速相似形态。计算复杂度 $O(n \times m)$，通过带约束的 Sakoe-Chiba Band 降低到 $O(n \times w)$（$w$ 为带宽）。

```typescript
/**
 * DTW 距离（带 Sakoe-Chiba Band 约束）
 *
 * @param a 查询序列（归一化后）
 * @param b 候选序列（归一化后）
 * @param bandWidth 弯曲带宽，默认 Math.ceil(a.length * 0.1)
 */
function dtwDistance(a: number[], b: number[], bandWidth?: number): number {
  const n = a.length
  const m = b.length
  const w = bandWidth ?? Math.max(Math.ceil(Math.max(n, m) * 0.1), Math.abs(n - m))

  // DTW 矩阵，初始化为 Infinity
  const dtw: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(Infinity),
  )
  dtw[0][0] = 0

  for (let i = 1; i <= n; i++) {
    const jStart = Math.max(1, i - w)
    const jEnd = Math.min(m, i + w)
    for (let j = jStart; j <= jEnd; j++) {
      const cost = (a[i - 1] - b[j - 1]) ** 2
      dtw[i][j] = cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1])
    }
  }

  return Math.sqrt(dtw[n][m] / Math.max(n, m))
}
```

### 3.3 全市场搜索流程

```
输入：查询形态 Q（tsCode + startDate + endDate，或自定义序列）
参数：匹配算法 algorithm（NED / DTW）、返回数量 topK、目标股票池 scope

1. 提取查询序列
   - 从 stock_daily_prices + stock_adjustment_factors 加载前复权收盘价
   - 归一化 → Q_norm（长度 L）

2. 确定候选股票池
   - scope = 'all'     → 全市场上市股（list_status = 'L'），约 5000 只
   - scope = 'index'   → 指定指数成分股（利用 index_constituent_weights）
   - scope = 'exclude_self' → 排除查询股票自身

3. 对每只候选股票 S：
   a. 加载 S 的全部前复权日线收盘价（近 N 年，默认 5 年）
   b. 滑动窗口扫描（窗口大小 = L，步长 = 1）：
      - 归一化窗口内序列 → W_norm
      - 计算 distance(Q_norm, W_norm)
      - 记录 (tsCode, windowStartDate, windowEndDate, distance)
   c. 保留 S 中 distance 最小的 1 条（去重：同一股票只返回最优匹配）

4. 全局排序（distance ASC），取 top K 返回
```

### 3.4 预定义经典形态模板

使用归一化序列定义经典技术形态：

```typescript
export const PATTERN_TEMPLATES: Record<string, { name: string; description: string; series: number[] }> = {
  HEAD_SHOULDERS_TOP: {
    name: '头肩顶',
    description: '左肩 → 头部 → 右肩，看跌反转形态',
    series: [0.3, 0.5, 0.6, 0.5, 0.3, 0.5, 0.8, 1.0, 0.8, 0.5, 0.3, 0.5, 0.6, 0.5, 0.3, 0.2, 0.0],
  },
  HEAD_SHOULDERS_BOTTOM: {
    name: '头肩底',
    description: '反向头肩，看涨反转形态',
    series: [0.7, 0.5, 0.4, 0.5, 0.7, 0.5, 0.2, 0.0, 0.2, 0.5, 0.7, 0.5, 0.4, 0.5, 0.7, 0.8, 1.0],
  },
  DOUBLE_TOP: {
    name: '双顶（M 顶）',
    description: '两个高点接近，中间有回调，看跌形态',
    series: [0.0, 0.3, 0.6, 0.9, 1.0, 0.8, 0.5, 0.4, 0.5, 0.8, 1.0, 0.9, 0.6, 0.3, 0.0],
  },
  DOUBLE_BOTTOM: {
    name: '双底（W 底）',
    description: '两个低点接近，中间有反弹，看涨形态',
    series: [1.0, 0.7, 0.4, 0.1, 0.0, 0.2, 0.5, 0.6, 0.5, 0.2, 0.0, 0.1, 0.4, 0.7, 1.0],
  },
  ASCENDING_TRIANGLE: {
    name: '上升三角形',
    description: '顶部水平，底部逐步抬高，通常向上突破',
    series: [0.0, 0.5, 1.0, 0.6, 0.2, 0.6, 1.0, 0.65, 0.35, 0.7, 1.0, 0.7, 0.5, 0.75, 1.0],
  },
  DESCENDING_TRIANGLE: {
    name: '下降三角形',
    description: '底部水平，顶部逐步降低，通常向下突破',
    series: [1.0, 0.5, 0.0, 0.4, 0.8, 0.4, 0.0, 0.35, 0.65, 0.3, 0.0, 0.3, 0.5, 0.25, 0.0],
  },
  FLAG_BULLISH: {
    name: '牛旗',
    description: '急涨后小幅回调整理，看涨延续',
    series: [0.0, 0.1, 0.3, 0.6, 0.85, 1.0, 0.95, 0.9, 0.85, 0.8, 0.78, 0.82, 0.8, 0.78, 0.82],
  },
  V_REVERSAL: {
    name: 'V 形反转',
    description: '急跌后快速回升',
    series: [1.0, 0.8, 0.6, 0.3, 0.1, 0.0, 0.1, 0.3, 0.6, 0.8, 1.0],
  },
}
```

---

## 四、接口详细设计

### 4.1 DTO 定义

#### `pattern-search.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min, IsArray, ArrayMinSize, IsNumber } from 'class-validator'

export enum PatternAlgorithm {
  /** 归一化欧氏距离（快速） */
  NED = 'NED',
  /** 动态时间弯曲（精确） */
  DTW = 'DTW',
}

export enum PatternScope {
  /** 全市场 */
  ALL = 'ALL',
  /** 指定指数成分股 */
  INDEX = 'INDEX',
}

export class PatternSearchDto {
  @ApiProperty({ description: '查询形态的股票代码', example: '000001.SZ' })
  @IsString()
  tsCode: string

  @ApiProperty({ description: '形态起始日期（YYYYMMDD）', example: '20260301' })
  @Matches(/^\d{8}$/)
  startDate: string

  @ApiProperty({ description: '形态截止日期（YYYYMMDD）', example: '20260401' })
  @Matches(/^\d{8}$/)
  endDate: string

  @ApiPropertyOptional({
    description: '相似度算法',
    enum: PatternAlgorithm,
    default: PatternAlgorithm.NED,
  })
  @IsOptional()
  @IsEnum(PatternAlgorithm)
  algorithm?: PatternAlgorithm = PatternAlgorithm.NED

  @ApiPropertyOptional({ description: '返回数量', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  topK?: number = 20

  @ApiPropertyOptional({ description: '搜索范围', enum: PatternScope, default: PatternScope.ALL })
  @IsOptional()
  @IsEnum(PatternScope)
  scope?: PatternScope = PatternScope.ALL

  @ApiPropertyOptional({ description: '指数代码（scope=INDEX 时必填）', example: '000300.SH' })
  @IsOptional()
  @IsString()
  indexCode?: string

  @ApiPropertyOptional({ description: '候选序列历史回溯年数', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  lookbackYears?: number = 5

  @ApiPropertyOptional({ description: '是否排除查询股票本身', default: true })
  @IsOptional()
  excludeSelf?: boolean = true
}

export class PatternSearchBySeriesDto {
  @ApiProperty({ description: '自定义价格序列（至少 5 个点）', type: [Number], example: [10, 12, 15, 13, 16] })
  @IsArray()
  @ArrayMinSize(5)
  @IsNumber({}, { each: true })
  series: number[]

  @ApiPropertyOptional({ enum: PatternAlgorithm, default: PatternAlgorithm.NED })
  @IsOptional()
  @IsEnum(PatternAlgorithm)
  algorithm?: PatternAlgorithm = PatternAlgorithm.NED

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  topK?: number = 20

  @ApiPropertyOptional({ enum: PatternScope, default: PatternScope.ALL })
  @IsOptional()
  @IsEnum(PatternScope)
  scope?: PatternScope = PatternScope.ALL

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  indexCode?: string

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  lookbackYears?: number = 5
}
```

#### `pattern-response.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** 单条匹配结果 */
export class PatternMatchDto {
  @ApiProperty({ description: '股票代码' })
  tsCode: string

  @ApiPropertyOptional({ description: '股票名称' })
  name: string | null

  @ApiProperty({ description: '匹配片段起始日期' })
  startDate: string

  @ApiProperty({ description: '匹配片段截止日期' })
  endDate: string

  @ApiProperty({ description: '相似度距离（越小越相似）' })
  distance: number

  @ApiProperty({ description: '相似度百分比（0-100，越高越相似）' })
  similarity: number

  @ApiProperty({ description: '匹配片段后续 N 日涨跌幅（%），用于参考后续走势', type: [Number] })
  futureReturns: number[]

  @ApiProperty({ description: '匹配片段的归一化价格序列', type: [Number] })
  normalizedSeries: number[]
}

/** 搜索结果 */
export class PatternSearchResultDto {
  @ApiProperty({ description: '查询形态长度（交易日数）' })
  patternLength: number

  @ApiProperty({ description: '使用的算法' })
  algorithm: string

  @ApiProperty({ description: '搜索范围内候选股票数' })
  candidateCount: number

  @ApiProperty({ description: '搜索耗时（ms）' })
  elapsedMs: number

  @ApiProperty({ description: '查询形态的归一化序列', type: [Number] })
  querySeries: number[]

  @ApiProperty({ description: '匹配结果列表', type: [PatternMatchDto] })
  matches: PatternMatchDto[]
}
```

### 4.2 核心服务

**文件**：`src/apps/pattern/pattern.service.ts`

```typescript
@Injectable()
export class PatternService {
  private readonly logger = new Logger(PatternService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** 获取预定义形态模板 */
  getTemplates() {
    return Object.entries(PATTERN_TEMPLATES).map(([key, val]) => ({
      id: key,
      name: val.name,
      description: val.description,
      length: val.series.length,
    }))
  }

  /** 基于股票日线的形态搜索 */
  async search(dto: PatternSearchDto): Promise<PatternSearchResultDto> {
    const startTime = Date.now()

    // 1. 提取查询形态
    const queryPrices = await this.loadAdjustedCloses(dto.tsCode, dto.startDate, dto.endDate)
    if (queryPrices.length < 5) throw new BusinessException('查询形态至少需要 5 个交易日数据')
    const queryNorm = normalizeToUnitRange(queryPrices.map(p => p.close))

    // 2. 确定候选股票池
    const candidates = await this.getCandidateStocks(dto.scope, dto.indexCode)
    const filteredCandidates = dto.excludeSelf
      ? candidates.filter(c => c.tsCode !== dto.tsCode)
      : candidates

    // 3. 全市场滑动窗口搜索
    const matches = await this.slidingWindowSearch(
      queryNorm,
      filteredCandidates,
      dto.algorithm ?? PatternAlgorithm.NED,
      dto.topK ?? 20,
      dto.lookbackYears ?? 5,
    )

    return {
      patternLength: queryNorm.length,
      algorithm: dto.algorithm ?? 'NED',
      candidateCount: filteredCandidates.length,
      elapsedMs: Date.now() - startTime,
      querySeries: queryNorm.map(v => round(v, 4)),
      matches,
    }
  }

  /** 基于自定义序列的形态搜索 */
  async searchBySeries(dto: PatternSearchBySeriesDto): Promise<PatternSearchResultDto> {
    const startTime = Date.now()
    const queryNorm = normalizeToUnitRange(dto.series)

    const candidates = await this.getCandidateStocks(dto.scope ?? PatternScope.ALL, dto.indexCode)

    const matches = await this.slidingWindowSearch(
      queryNorm,
      candidates,
      dto.algorithm ?? PatternAlgorithm.NED,
      dto.topK ?? 20,
      dto.lookbackYears ?? 5,
    )

    return {
      patternLength: queryNorm.length,
      algorithm: dto.algorithm ?? 'NED',
      candidateCount: candidates.length,
      elapsedMs: Date.now() - startTime,
      querySeries: queryNorm.map(v => round(v, 4)),
      matches,
    }
  }

  // ── 核心搜索引擎 ─────────────────────────────────────────────────

  /**
   * 对候选股票池进行滑动窗口搜索。
   *
   * 性能策略：
   * - 按批处理候选股票（每批 50 只），避免单次加载过多数据
   * - 每只股票只保留最优匹配
   * - 使用小顶堆维护全局 topK
   */
  private async slidingWindowSearch(
    queryNorm: number[],
    candidates: { tsCode: string; name: string | null }[],
    algorithm: PatternAlgorithm,
    topK: number,
    lookbackYears: number,
  ): Promise<PatternMatchDto[]> {
    const windowLen = queryNorm.length
    const cutoffDate = dayjs().subtract(lookbackYears, 'year').format('YYYYMMDD')
    const distanceFn = algorithm === PatternAlgorithm.DTW ? dtwDistance : normalizedEuclideanDistance

    // 全局结果收集器（按 distance ASC 排序，保留 topK）
    const results: PatternMatchDto[] = []

    const BATCH_SIZE = 50
    for (let b = 0; b < candidates.length; b += BATCH_SIZE) {
      const batch = candidates.slice(b, b + BATCH_SIZE)
      const tsCodes = batch.map(c => c.tsCode)

      // 批量加载日线数据（前复权）
      const batchData = await this.batchLoadAdjustedCloses(tsCodes, cutoffDate)

      for (const { tsCode, name } of batch) {
        const priceData = batchData.get(tsCode)
        if (!priceData || priceData.length < windowLen) continue

        let bestMatch: { startIdx: number; endIdx: number; distance: number } | null = null

        // 滑动窗口
        for (let i = 0; i <= priceData.length - windowLen; i++) {
          const windowCloses = priceData.slice(i, i + windowLen).map(p => p.close)
          const windowNorm = normalizeToUnitRange(windowCloses)
          const dist = distanceFn(queryNorm, windowNorm)

          if (!bestMatch || dist < bestMatch.distance) {
            bestMatch = { startIdx: i, endIdx: i + windowLen - 1, distance: dist }
          }
        }

        if (bestMatch) {
          // 计算后续 N 日收益（匹配片段结束后的 5/10/20 日）
          const futureReturns = this.computeFutureReturns(priceData, bestMatch.endIdx)

          const matchSlice = priceData.slice(bestMatch.startIdx, bestMatch.endIdx + 1)
          results.push({
            tsCode,
            name,
            startDate: matchSlice[0].date,
            endDate: matchSlice[matchSlice.length - 1].date,
            distance: round(bestMatch.distance, 6),
            similarity: round(Math.max(0, (1 - bestMatch.distance) * 100), 2),
            futureReturns,
            normalizedSeries: normalizeToUnitRange(matchSlice.map(p => p.close)).map(v => round(v, 4)),
          })
        }
      }
    }

    // 全局排序，取 topK
    results.sort((a, b) => a.distance - b.distance)
    return results.slice(0, topK)
  }

  /**
   * 计算匹配片段结束后的未来 N 日累计涨跌幅。
   * 返回 [T+5, T+10, T+20] 三个时间节点的累计涨跌幅（%）。
   */
  private computeFutureReturns(
    priceData: { date: string; close: number }[],
    endIdx: number,
  ): number[] {
    const baseClose = priceData[endIdx]?.close
    if (!baseClose) return []

    return [5, 10, 20].map(offset => {
      const futureIdx = endIdx + offset
      if (futureIdx >= priceData.length) return null
      return round(((priceData[futureIdx].close - baseClose) / baseClose) * 100, 2)
    }).filter((v): v is number => v !== null)
  }

  // ── 数据加载 ─────────────────────────────────────────────────────

  /**
   * 批量加载多只股票的前复权收盘价序列。
   *
   * SQL 逻辑：
   *   SELECT d.ts_code, d.trade_date, d.close, a.adj_factor
   *   FROM stock_daily_prices d
   *   JOIN stock_adjustment_factors a
   *        ON d.ts_code = a.ts_code AND d.trade_date = a.trade_date
   *   WHERE d.ts_code IN (:tsCodes) AND d.trade_date >= :cutoffDate
   *   ORDER BY d.ts_code, d.trade_date
   *
   * 前复权价 = close × (adj_factor / latest_adj_factor)
   */
  private async batchLoadAdjustedCloses(
    tsCodes: string[],
    cutoffDate: string,
  ): Promise<Map<string, { date: string; close: number }[]>> {
    // 实现：$queryRaw 批量查询 → 按 tsCode 分组 → 前复权处理
    // ...
  }

  /** 加载单只股票的前复权收盘价 */
  private async loadAdjustedCloses(tsCode: string, startDate: string, endDate: string) {
    // 复用已有 batchLoadAdjustedCloses 逻辑
  }

  /** 获取候选股票池 */
  private async getCandidateStocks(
    scope: PatternScope,
    indexCode?: string,
  ): Promise<{ tsCode: string; name: string | null }[]> {
    if (scope === PatternScope.INDEX && indexCode) {
      // 从 index_constituent_weights 获取成分股
      return this.prisma.$queryRaw`
        SELECT DISTINCT iw.con_code AS "tsCode", sb.name
        FROM index_constituent_weights iw
        JOIN stock_basic_profiles sb ON iw.con_code = sb.ts_code
        WHERE iw.index_code = ${indexCode}
          AND sb.list_status = 'L'
      `
    }
    // 全市场
    return this.prisma.stockBasic.findMany({
      where: { listStatus: 'L' },
      select: { tsCode: true, name: true },
    })
  }
}
```

### 4.3 Controller

**文件**：`src/apps/pattern/pattern.controller.ts`

```typescript
@ApiTags('Pattern - 相似 K 线形态匹配')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pattern')
export class PatternController {
  constructor(private readonly patternService: PatternService) {}

  @Get('templates')
  @ApiOperation({ summary: '获取预定义经典形态模板列表' })
  getTemplates() {
    return this.patternService.getTemplates()
  }

  @Post('search')
  @ApiOperation({ summary: '相似 K 线形态搜索（基于股票日线）' })
  @ApiSuccessResponse(PatternSearchResultDto)
  search(@Body() dto: PatternSearchDto) {
    return this.patternService.search(dto)
  }

  @Post('search-by-series')
  @ApiOperation({ summary: '相似形态搜索（基于自定义价格序列）' })
  @ApiSuccessResponse(PatternSearchResultDto)
  searchBySeries(@Body() dto: PatternSearchBySeriesDto) {
    return this.patternService.searchBySeries(dto)
  }
}
```

### 4.4 Module

**文件**：`src/apps/pattern/pattern.module.ts`

```typescript
@Module({
  controllers: [PatternController],
  providers: [PatternService],
})
export class PatternModule {}
```

---

## 五、性能优化策略

### 5.1 计算量估算

| 场景                 | 候选股票数 | 每只股票日线长度（5 年） | 滑动窗口步数 | 总距离计算次数        |
| -------------------- | ---------- | ----------------------- | ------------ | --------------------- |
| 全市场 NED（20 日）  | 5,000      | ~1,200                  | ~1,180       | ~5,900,000            |
| 沪深300 NED（20 日） | 300        | ~1,200                  | ~1,180       | ~354,000              |
| 全市场 DTW（20 日）  | 5,000      | ~1,200                  | ~1,180       | ~5,900,000 × 20²     |

### 5.2 优化手段

| 策略                   | 说明                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------- |
| **分批加载**           | 每批 50 只股票，避免同时加载全市场 500 万行日线数据                                     |
| **提前剪枝（LB_Keogh）** | DTW 搜索时先用 $O(n)$ 的 LB_Keogh 下界过滤，距离下界已超当前 topK 阈值则跳过 DTW 计算 |
| **NED 优先粗筛**      | 全市场搜索建议先用 NED 快速筛出 top 200，再用 DTW 精排                                 |
| **Redis 缓存**         | 对高频查询的股票池日线数据做 Redis 缓存（TTL 1 天）                                    |
| **超时保护**           | 全市场 DTW 搜索设置 30 秒超时，超时则返回已有最优结果                                  |
| **结果缓存**           | 相同查询参数的结果缓存 5 分钟                                                          |

### 5.3 接口超时建议

| 搜索范围     | 算法 | 建议超时 | 预估耗时     |
| ------------ | ---- | -------- | ------------ |
| 指数成分     | NED  | 5s       | ~500ms       |
| 指数成分     | DTW  | 15s      | ~3s          |
| 全市场       | NED  | 15s      | ~3-5s        |
| 全市场       | DTW  | 60s      | ~15-30s      |

---

## 六、文件变更汇总

| 操作 | 文件路径                                                | 说明                          |
| ---- | ------------------------------------------------------- | ----------------------------- |
| 新增 | `src/apps/pattern/pattern.module.ts`                    | 模块定义                      |
| 新增 | `src/apps/pattern/pattern.controller.ts`                | 路由（3 个端点）              |
| 新增 | `src/apps/pattern/pattern.service.ts`                   | 核心搜索引擎                  |
| 新增 | `src/apps/pattern/utils/similarity.ts`                  | NED / DTW / 归一化等纯函数    |
| 新增 | `src/apps/pattern/utils/pattern-templates.ts`           | 预定义经典形态模板            |
| 新增 | `src/apps/pattern/dto/pattern-search.dto.ts`            | 搜索请求 DTO                  |
| 新增 | `src/apps/pattern/dto/pattern-response.dto.ts`          | 搜索响应 DTO                  |
| 修改 | `src/app.module.ts`                                     | 注册 PatternModule            |
