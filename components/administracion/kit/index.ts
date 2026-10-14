// Las piezas compartidas de Administración (rediseño de experiencia, oct 2026).
// El contrato de cada una está en su archivo: para qué es y cuándo NO usarla.
// Todas son server-safe salvo las islas cliente: `MoneyTicker`,
// `CategoryPicker` y `RetryButton`. `category.ts` es puro (sin React).
export { ActionTile } from './action-tile'
export { AdmHeader, AdmPage } from './adm-page'
export {
  type CategoryAccount,
  type CategoryGroup,
  type CategoryOption,
  categoryGroups,
  categoryOptions,
  categoryShortName,
  FIXED_ASSETS_GROUP_ID,
  FIXED_ASSETS_GROUP_NAME,
  FIXED_ASSETS_GROUP_NOTE,
  featuredCategories,
  topCategories,
} from './category'
export { CategoryPicker } from './category-picker'
export { ChoiceCard } from './choice-card'
export { EmptyTeach } from './empty-teach'
export { Explain, MathRow } from './explain'
export { HeroPanel, MoneyHero } from './hero'
export { LedgerGroup, LedgerList, LedgerRail, LedgerRow, type LedgerTone } from './ledger'
export { MoneyTicker } from './money-ticker'
export { Panel, PanelSection } from './panel'
export { PanelError, PanelLink } from './panel-states'
export { PaperSheet } from './paper'
export { LegendPill, Pill, PillLink } from './pill'
export { RetryButton } from './retry-button'
export { StatusPill } from './status-pill'
export { StepCard, StepRail, type StepRailItem, type StepState } from './step'
export { Term } from './term'
export {
  Ticket,
  TicketHeader,
  TicketLabel,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from './ticket'
export { type ViewPillItem, ViewPills } from './view-pills'
export { WALLET_ICONS, WalletCard } from './wallet-card'
