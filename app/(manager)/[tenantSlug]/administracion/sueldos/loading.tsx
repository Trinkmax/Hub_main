import { SheetSkeleton } from '../gastos-fijos/_components/sheet-skeleton'

/** Sueldos mientras carga: los meses, el totalizador y la planilla con su forma. */
export default function SueldosLoading() {
  return <SheetSkeleton label="Cargando Sueldos…" rows={5} />
}
