import { BookSkeleton } from '../_components/book-skeleton'

/** Mayor mientras carga: la cuenta con sus flechas, el período y la hoja. */
export default function MayorLoading() {
  return <BookSkeleton picker="range" filters rows={10} columns={6} />
}
