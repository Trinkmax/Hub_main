/**
 * La grilla de `KPIGroup` (kit HUB §3.5), compartida con `SkeletonKPIGroup`:
 * el esqueleto tiene que caer en las mismas celdas que los KPIs que reemplaza,
 * en cada ancho, o la fila salta al cargar. Server-safe y sin React.
 */

export type KPIGroupColumns = 2 | 3 | 4

/**
 * Grilla y divisores por cantidad de columnas. Celular: 2 × 2 para 2 o 4 KPIs
 * y 1 × 3 para 3 (§5.1 y §5.3). Escritorio: 3 desde `md`; 4 recién desde `xl`,
 * porque con plata de 8 cifras cuatro celdas no entran antes. Los pelos se
 * dibujan por posición (`nth-child`), así una fila incompleta no deja una
 * línea suelta. Clases enteras para que Tailwind las genere.
 */
export const KPI_GRID_CLASS: Readonly<Record<1 | KPIGroupColumns, string>> = {
  1: 'grid-cols-1 [&>*+*]:border-t',
  2: 'grid-cols-2 [&>*:nth-child(2n)]:border-l [&>*:nth-child(n+3)]:border-t',
  3: 'grid-cols-1 max-md:[&>*+*]:border-t md:grid-cols-3 md:[&>*:not(:nth-child(3n+1))]:border-l md:[&>*:nth-child(n+4)]:border-t',
  4: 'grid-cols-2 max-xl:[&>*:nth-child(2n)]:border-l max-xl:[&>*:nth-child(n+3)]:border-t xl:grid-cols-4 xl:[&>*:not(:nth-child(4n+1))]:border-l xl:[&>*:nth-child(n+5)]:border-t',
}

/** La raíz del grupo: los pelos de las celdas van en `--border`. */
export const KPI_GROUP_CLASS = 'grid [&>*]:border-border'

/** `framed` (default): una sola tarjeta con los divisores adentro. */
export const KPI_GROUP_FRAME_CLASS =
  'overflow-hidden rounded-xl border border-border bg-card text-card-foreground'

/** Cada KPI de un grupo: su celda, con el aire del kit. */
export const KPI_CELL_PADDING = 'p-4 sm:p-6'

/** Sin `columns`, las columnas salen de la cantidad de KPIs. */
export function kpiGroupColumns(count: number): 1 | KPIGroupColumns {
  if (count <= 1) return 1
  if (count <= 4) return count as KPIGroupColumns
  return count <= 6 ? 3 : 4
}
