export type PointsRuleType = 'per_amount' | 'per_item'

export type PerAmountConfig = { every_cents: number; points: number }
export type PerItemByIdConfig = { item_id: string; points: number }
export type PerItemByCategoryConfig = { category_id: string; points: number }
export type PointsRuleConfig = PerAmountConfig | PerItemByIdConfig | PerItemByCategoryConfig

export type PointsRule = {
  id: string
  type: PointsRuleType
  config: PointsRuleConfig
  priority: number
  active: boolean
}

export type VisitItemForEngine = {
  menu_item_id: string
  category_id: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  points_override: number | null
}

export type VisitForEngine = {
  total_amount_cents: number
  items: VisitItemForEngine[]
}

export type PointsBreakdownSource =
  | 'per_amount'
  | 'per_item_id'
  | 'per_item_category'
  | 'item_override'

export type PointsBreakdownEntry = {
  rule_id: string | null
  source: PointsBreakdownSource
  description: string
  points: number
}

export type PointsCalculation = {
  delta: number
  breakdown: PointsBreakdownEntry[]
}
