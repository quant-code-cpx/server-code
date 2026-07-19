# Tool 公共 Schema

## 输入公共类型

```json
{
  "$defs": {
    "TsCode": {
      "type": "string",
      "pattern": "^[0-9A-Z]{5,8}\\.(SH|SZ|BJ|HK)$",
      "maxLength": 12
    },
    "IsoDate": {
      "type": "string",
      "format": "date"
    },
    "DateRange": {
      "type": "object",
      "additionalProperties": false,
      "required": ["start", "end"],
      "properties": {
        "start": { "$ref": "#/$defs/IsoDate" },
        "end": { "$ref": "#/$defs/IsoDate" }
      }
    }
  }
}
```

日期先做 JSON Schema 校验，再做 `start <= end`、交易日和 Tool 最大跨度的语义校验。证券无法唯一解析时必须先调用 `resolve_security`。

## 输出公共类型

```ts
type ToolResult<T> = {
  ok: true;
  toolCallId: string;
  toolKey: string;
  toolVersion: number;
  data: T;
  provenance: {
    sourceType: 'DATABASE' | 'PROGRAM_CALCULATION' | 'OFFICIAL' | 'MEDIA' | 'INSTITUTION';
    sourceServices: string[];
    sourceModels: string[];
    asOf: {
      tradeDate?: string;
      reportPeriod?: string;
      announcementDate?: string;
      availableAt?: string;
      retrievedAt: string;
    };
    timezone: string;
    unit?: string;
    currency?: string;
    adjustment?: 'NONE' | 'FORWARD' | 'BACKWARD';
    dataVersion?: string;
    algorithmVersion?: string;
    inputHash?: string;
    outputHash?: string;
  };
  citationSourceIds: string[];
  warnings: Array<{ code: string; message: string; affectedFields?: string[] }>;
  truncated: boolean;
  nextCursor?: string;
};
```

失败结果不与成功 union 混在模型事实中，由执行器抛出/持久化标准 `ToolError`。`sourceModels` 使用真实 Prisma model 名，外部来源则使用 `citationSourceIds`。

## 事实包

大结果先存数据库或对象存储，模型只接收：

```ts
type ToolFactPacket = {
  toolCallId: string;
  summaryFacts: Array<{
    factId: string;
    statement: string;
    value?: number | string | null;
    unit?: string;
    asOf?: string;
    citationSourceIds: string[];
  }>;
  previewRows?: Record<string, unknown>[];
  resultRef?: string;
  warnings: string[];
};
```

`statement` 由确定性 formatter 生成，不含未经验证的模型推断。
