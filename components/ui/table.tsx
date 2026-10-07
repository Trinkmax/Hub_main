import type * as React from 'react'
import {
  DataTableBody,
  DataTableCaption,
  DataTableCell,
  DataTableFoot,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
} from '@/components/ui/data-table'
import { cn } from '@/lib/utils'

/**
 * Compatibilidad con la tabla de shadcn (kit HUB §3.6, «una sola tabla»): los
 * nombres viejos son los primitivos de `DataTable`, con su misma apariencia.
 * Queda un solo uso (`local/mesas/_components/tables-list-fallback.tsx`); lo
 * nuevo va con `DataTable` o los `DataTable*` de `@/components/ui/data-table`.
 */

/**
 * @deprecated Es `DataTableScroll` + `DataTableRoot` de `@/components/ui/data-table`.
 * Como el de shadcn, sin caja propia y con el `<caption>` abajo.
 */
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <DataTableScroll data-slot="table-container">
      <DataTableRoot className={cn('caption-bottom', className)} {...props} />
    </DataTableScroll>
  )
}

/** @deprecated Es `DataTableHead`. */
const TableHeader = DataTableHead
/** @deprecated Es `DataTableBody`. */
const TableBody = DataTableBody
/** @deprecated Es `DataTableFoot` (el `<tfoot>` con la regla contable). */
const TableFooter = DataTableFoot
/** @deprecated Es `DataTableRow`. */
const TableRow = DataTableRow
/** @deprecated Es `DataTableHeader`. */
const TableHead = DataTableHeader
/** @deprecated Es `DataTableCell`. */
const TableCell = DataTableCell
/** @deprecated Es `DataTableCaption`. */
const TableCaption = DataTableCaption

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow }
