import { DataTableToolbar } from '@/components/ui/data-table'
import { SearchField } from '@/components/ui/input'

/*
 * Compatibilidad (kit HUB §3.6 y §3.9): `FilterBar` y `FilterSearch` son alias
 * de `DataTableToolbar` y `SearchField`. El sucesor acepta las mismas props de
 * siempre (`className` y `children`; `name`, `placeholder` y `defaultValue`)
 * con los mismos defaults (`name="q"`, «Buscar…»), así que el que llama no
 * cambia: solo se ve como el resto de la tabla, con todos los controles en
 * `sm`. El salón y lo público tienen su copia vieja en
 * `components/ui-legacy/filter-bar.tsx`.
 */

/** @deprecated Usá `DataTableToolbar` de `@/components/ui/data-table`. */
export const FilterBar = DataTableToolbar

/** @deprecated Usá `SearchField` de `@/components/ui/input`. */
export const FilterSearch = SearchField
