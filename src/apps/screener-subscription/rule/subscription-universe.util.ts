/**
 * 与因子快照预计算保持一致：排除 ST 时同时覆盖 *ST 与退市整理标的。
 * 不能只判断 startsWith('ST')，否则 *ST 会进入订阅规则宇宙却永远没有因子快照。
 */
export function isSpecialTreatmentStockName(name: string): boolean {
  const normalized = name.toUpperCase()
  return normalized.includes('ST') || normalized.includes('退')
}
