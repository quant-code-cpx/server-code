import { ExportService } from '../export.service'

describe('ExportService — generateCsv', () => {
  let service: ExportService

  beforeEach(() => {
    // generateCsv 是纯函数，不依赖 Prisma，直接实例化即可
    service = new ExportService(null as any, null as any, null as any)
  })

  it('简单数据生成正确的 CSV', () => {
    const columns = ['name', 'age', 'city']
    const rows = [
      { name: 'Alice', age: 30, city: 'Beijing' },
      { name: 'Bob', age: 25, city: 'Shanghai' },
    ]
    const csv = service.generateCsv(columns, rows)
    expect(csv).toBe('name,age,city\r\nAlice,30,Beijing\r\nBob,25,Shanghai')
  })

  it('null 和 undefined 值输出为空字符串', () => {
    const columns = ['a', 'b', 'c']
    const rows = [{ a: 'x', b: null, c: undefined }]
    const csv = service.generateCsv(columns, rows)
    expect(csv).toBe('a,b,c\r\nx,,')
  })

  it('值包含逗号时用双引号包裹', () => {
    const columns = ['desc']
    const rows = [{ desc: 'buy,sell' }]
    const csv = service.generateCsv(columns, rows)
    expect(csv).toBe('desc\r\n"buy,sell"')
  })

  it('值包含双引号时用双双引号转义', () => {
    const columns = ['note']
    const rows = [{ note: 'say "hello"' }]
    const csv = service.generateCsv(columns, rows)
    expect(csv).toBe('note\r\n"say ""hello"""')
  })

  it('值同时包含逗号和双引号时正确转义', () => {
    const columns = ['text']
    const rows = [{ text: 'a "b", c' }]
    const csv = service.generateCsv(columns, rows)
    expect(csv).toBe('text\r\n"a ""b"", c"')
  })

  it('值包含换行符时用双引号包裹', () => {
    const columns = ['reason']
    const rows = [{ reason: 'line1\nline2' }]
    const csv = service.generateCsv(columns, rows)
    expect(csv).toBe('reason\r\n"line1\nline2"')
  })

  it('空行数组只输出表头', () => {
    const columns = ['a', 'b']
    const rows: Record<string, unknown>[] = []
    const csv = service.generateCsv(columns, rows)
    expect(csv).toBe('a,b')
  })

  it('数值类型正确转为字符串', () => {
    const columns = ['price', 'quantity']
    const rows = [{ price: 12.5, quantity: 100 }]
    const csv = service.generateCsv(columns, rows)
    expect(csv).toBe('price,quantity\r\n12.5,100')
  })

  it('行中缺失列名对应的键时输出空', () => {
    const columns = ['a', 'b', 'c']
    const rows = [{ a: '1' }] // b 和 c 不存在
    const csv = service.generateCsv(columns, rows)
    expect(csv).toBe('a,b,c\r\n1,,')
  })
})
