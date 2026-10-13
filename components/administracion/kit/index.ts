// Las piezas compartidas de Administración (rediseño de experiencia, oct 2026).
// El contrato de cada una está en su archivo: para qué es y cuándo NO usarla.
// Todas son server-safe salvo `MoneyTicker`, que es una isla cliente.
export { ActionTile } from './action-tile'
export { AdmHeader, AdmPage } from './adm-page'
export { ChoiceCard } from './choice-card'
export { EmptyTeach } from './empty-teach'
export { Explain, MathRow } from './explain'
export { HeroPanel, MoneyHero } from './hero'
export { MoneyTicker } from './money-ticker'
export { Panel, PanelSection } from './panel'
export { LegendPill, Pill, PillLink } from './pill'
export { StatusPill } from './status-pill'
export { StepCard, StepRail, type StepRailItem, type StepState } from './step'
export { Term } from './term'
export {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from './ticket'
