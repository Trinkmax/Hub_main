import { BookSkeleton } from './_components/book-skeleton'

/** `/libros` redirige a Sumas y saldos: mientras tanto, su misma forma. */
export default function LibrosLoading() {
  return <BookSkeleton picker="range" filters rows={14} columns={6} />
}
