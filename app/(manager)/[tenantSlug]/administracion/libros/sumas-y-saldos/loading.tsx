import { BookSkeleton } from '../_components/book-skeleton'

/** Sumas y saldos mientras carga: la barra, el nivel y la planilla de cuentas. */
export default function SumasYSaldosLoading() {
  return <BookSkeleton picker="range" filters rows={14} columns={6} />
}
