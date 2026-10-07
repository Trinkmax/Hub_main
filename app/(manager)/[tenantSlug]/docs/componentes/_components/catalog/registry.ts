/**
 * El índice del catálogo de componentes (kit HUB §6.2): las familias, sus
 * bloques y lo que cada bloque monta con `data-tour`. Puro y sin React: lo
 * leen el índice de la izquierda, las familias (las anclas salen de acá) y el
 * test de render del catálogo (tests/lib/kit-catalog-render.test.tsx), que
 * verifica que cada bloque se dibuja y que cada `data-tour` llega al DOM
 * (§3.0: los 46 anclajes de los tours dependen de eso).
 */

export type CatalogBlockMeta = {
  /** Ancla del bloque (`#button`). Única en la página. */
  id: string
  /** El nombre que se ve en el índice y en el título del bloque. */
  name: string
  /**
   * Los `data-tour` que el bloque monta (`catalogo-<probe>`). Los fundamentos
   * y los avisos no montan un componente propio: van vacíos.
   */
  probes: readonly string[]
}

export type CatalogFamilyMeta = {
  id: string
  label: string
  /** Qué incluye, en una línea (la tabla de familias de §6.2). */
  summary: string
  blocks: readonly CatalogBlockMeta[]
}

/** El valor de `data-tour` de una sonda: `catalogo-button`. */
export function tourId(probe: string): string {
  return `catalogo-${probe}`
}

export const CATALOG_FAMILIES: readonly CatalogFamilyMeta[] = [
  {
    id: 'fundamentos',
    label: 'Fundamentos',
    summary: 'Color, contraste, tipografía, radios, elevación, movimiento, densidad y foco.',
    blocks: [
      { id: 'color', name: 'Color', probes: [] },
      { id: 'contraste', name: 'Contraste en vivo', probes: [] },
      { id: 'tipografia', name: 'Tipografía', probes: [] },
      { id: 'radios', name: 'Radios', probes: [] },
      { id: 'elevacion', name: 'Elevación', probes: [] },
      { id: 'movimiento', name: 'Movimiento', probes: [] },
      { id: 'densidad', name: 'Densidad', probes: [] },
      { id: 'foco', name: 'Foco y selección', probes: [] },
    ],
  },
  {
    id: 'acciones',
    label: 'Acciones',
    summary: 'Botones y afines.',
    blocks: [
      { id: 'button', name: 'Button', probes: ['button', 'button-link'] },
      { id: 'submit-button', name: 'SubmitButton', probes: ['submit-button'] },
      { id: 'spinner', name: 'Spinner', probes: ['spinner'] },
      { id: 'copy-button', name: 'CopyButton', probes: ['copy-button'] },
    ],
  },
  {
    id: 'campos',
    label: 'Campos',
    summary: 'Todos los controles de formulario.',
    blocks: [
      {
        id: 'input',
        name: 'Input, InputGroup y SearchField',
        probes: ['input', 'input-group', 'search-field'],
      },
      { id: 'textarea', name: 'Textarea', probes: ['textarea'] },
      { id: 'label', name: 'Label', probes: ['label'] },
      {
        id: 'field',
        name: 'Field y el formulario',
        // `FormError` no se monta al cargar: con mensaje se enfoca solo (aparece al enviar).
        probes: ['field', 'field-row', 'form-section', 'form-actions'],
      },
      { id: 'select', name: 'Select', probes: ['select'] },
      { id: 'combobox', name: 'Combobox y EntityPicker', probes: ['combobox', 'entity-picker'] },
      { id: 'money-field', name: 'MoneyField', probes: ['money-field'] },
      { id: 'number-field', name: 'NumberField', probes: ['number-field'] },
      { id: 'date-picker', name: 'DatePicker y Calendar', probes: ['date-picker', 'calendar'] },
      { id: 'period-picker', name: 'PeriodPicker', probes: ['period-picker'] },
      {
        id: 'time-field',
        name: 'TimeField y DateTimeField',
        probes: ['time-field', 'date-time-field'],
      },
      { id: 'checkbox', name: 'Checkbox', probes: ['checkbox'] },
      { id: 'switch', name: 'Switch', probes: ['switch'] },
      { id: 'radio-cards', name: 'RadioCards', probes: ['radio-cards'] },
      { id: 'icon-picker', name: 'IconPicker', probes: ['icon-picker'] },
      { id: 'code-field', name: 'CodeField', probes: ['code-field'] },
    ],
  },
  {
    id: 'navegacion',
    label: 'Navegación',
    summary: 'Pestañas, segmentados, chips y pasos.',
    blocks: [
      { id: 'tabs', name: 'Tabs y TabsNav', probes: ['tabs-list', 'tabs-content', 'tabs-nav'] },
      { id: 'section-nav', name: 'SectionNav', probes: ['section-nav'] },
      { id: 'segmented-control', name: 'SegmentedControl', probes: ['segmented-control'] },
      { id: 'filter-chip', name: 'FilterChip y ChipGroup', probes: ['filter-chip', 'chip-group'] },
      { id: 'steps', name: 'Steps', probes: ['steps'] },
    ],
  },
  {
    id: 'estado',
    label: 'Estado',
    summary: 'Etiquetas, semáforo, avisos, progreso, esqueletos, vacíos y errores.',
    blocks: [
      { id: 'badge', name: 'Badge y StatusBadge', probes: ['badge', 'status-badge'] },
      { id: 'due-status', name: 'DueStatus', probes: ['due-status'] },
      { id: 'callout', name: 'Callout', probes: ['callout'] },
      { id: 'progress', name: 'Progress', probes: ['progress'] },
      { id: 'skeleton', name: 'Skeleton y presets', probes: ['skeleton', 'skeleton-table'] },
      { id: 'empty-state', name: 'EmptyState', probes: ['empty-state'] },
      { id: 'error-state', name: 'ErrorState', probes: ['error-state'] },
      { id: 'toast', name: 'Avisos (Toaster y toastUndo)', probes: [] },
    ],
  },
  {
    id: 'estructura',
    label: 'Estructura',
    summary: 'Página, encabezado, secciones, tarjetas y KPIs.',
    blocks: [
      { id: 'page-shell', name: 'PageShell', probes: ['page-shell'] },
      { id: 'page-header', name: 'PageHeader y Breadcrumb', probes: ['page-header', 'breadcrumb'] },
      { id: 'section', name: 'Section', probes: ['section'] },
      { id: 'card', name: 'Card', probes: ['card'] },
      { id: 'kpi', name: 'KPI y KPIGroup', probes: ['kpi-group', 'kpi'] },
      {
        id: 'separator',
        name: 'Separator, ScrollArea, Kbd y Avatar',
        probes: ['separator', 'scroll-area', 'kbd', 'kbd-shortcut', 'avatar'],
      },
      { id: 'tooltip', name: 'Tooltip e InfoTip', probes: ['tooltip-trigger', 'info-tip'] },
    ],
  },
  {
    id: 'datos',
    label: 'Datos',
    summary: 'Importes y tablas.',
    blocks: [
      { id: 'amount', name: 'Amount', probes: ['amount'] },
      {
        id: 'data-table',
        name: 'DataTable',
        probes: ['data-table', 'data-table-toolbar', 'export-button'],
      },
      { id: 'pagination', name: 'Pagination', probes: ['pagination'] },
    ],
  },
  {
    id: 'superposiciones',
    label: 'Superposiciones',
    summary: 'Diálogos, hojas, confirmación, menús y la paleta.',
    blocks: [
      { id: 'dialog', name: 'Dialog', probes: ['dialog-trigger'] },
      { id: 'sheet', name: 'Sheet', probes: ['sheet-trigger'] },
      {
        id: 'confirm-dialog',
        name: 'ConfirmDialog, useConfirm y AlertDialog',
        probes: ['confirm-trigger', 'alert-dialog-trigger'],
      },
      { id: 'popover', name: 'Popover', probes: ['popover-trigger'] },
      { id: 'dropdown-menu', name: 'DropdownMenu', probes: ['dropdown-menu-trigger'] },
      { id: 'command', name: 'Command', probes: ['command'] },
    ],
  },
  {
    id: 'contables',
    label: 'Contables',
    summary: 'Las piezas de §3.8: asiento, plan de cuentas, libros, antigüedad e importes.',
    blocks: [
      { id: 'entry-preview', name: 'EntryPreview', probes: ['entry-preview', 'balance-seal'] },
      { id: 'account-picker', name: 'AccountPicker', probes: ['account-picker'] },
      { id: 'ledger-table', name: 'LedgerTable', probes: ['ledger-table'] },
      { id: 'aging-bar', name: 'AgingBar', probes: ['aging-bar'] },
      { id: 'amount-stack', name: 'AmountStack', probes: ['amount-stack', 'amount-stack-row'] },
      {
        id: 'entry-editor',
        name: 'LineItems y EntryEditor',
        probes: ['line-items', 'entry-editor'],
      },
      { id: 'payment-methods', name: 'PaymentMethodsEditor', probes: ['payment-methods'] },
      { id: 'voucher-number', name: 'VoucherNumberFields', probes: ['voucher-number'] },
    ],
  },
  {
    id: 'plantillas',
    label: 'Plantillas',
    summary: 'Las seis de §5 y los patrones de §5.7.',
    blocks: [
      { id: 'summary-template', name: 'Resumen', probes: ['summary-template'] },
      { id: 'list-template', name: 'Lista', probes: ['list-template', 'list-empty-state'] },
      { id: 'detail-template', name: 'Ficha', probes: ['detail-template'] },
      { id: 'form-template', name: 'Formulario', probes: ['form-template'] },
      { id: 'report-template', name: 'Libro o reporte', probes: ['report-template'] },
      { id: 'statement-template', name: 'Estado de cuenta', probes: ['statement-template'] },
      { id: 'read-only', name: 'Solo lectura', probes: ['read-only-callout'] },
      { id: 'closed-period', name: 'Período cerrado', probes: ['closed-period-callout'] },
      { id: 'journal', name: 'Libro diario', probes: ['journal'] },
      { id: 'chart-of-accounts', name: 'Plan de cuentas', probes: ['chart-of-accounts'] },
    ],
  },
  {
    id: 'shell',
    label: 'Shell',
    summary: 'Menú lateral, topbar y paleta.',
    blocks: [
      { id: 'sidebar', name: 'Menú lateral', probes: [] },
      { id: 'topbar', name: 'Topbar y menú de usuario', probes: [] },
      { id: 'palette', name: 'Paleta ⌘K', probes: [] },
    ],
  },
]

/** La familia de un id; tira si no existe (un id mal escrito es un error de programación). */
export function catalogFamily(id: string): CatalogFamilyMeta {
  const family = CATALOG_FAMILIES.find((candidate) => candidate.id === id)
  if (!family) throw new Error(`Catálogo: no existe la familia «${id}»`)
  return family
}

/** El bloque de un id, en cualquier familia; tira si no existe. */
export function catalogBlock(id: string): CatalogBlockMeta {
  for (const family of CATALOG_FAMILIES) {
    const block = family.blocks.find((candidate) => candidate.id === id)
    if (block) return block
  }
  throw new Error(`Catálogo: no existe el bloque «${id}»`)
}

/** Todas las sondas, en el orden del índice. */
export function catalogProbes(): string[] {
  return CATALOG_FAMILIES.flatMap((family) => family.blocks.flatMap((block) => block.probes))
}
