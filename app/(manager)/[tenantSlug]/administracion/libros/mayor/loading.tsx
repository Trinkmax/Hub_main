import { BookSkeleton } from '../_components/book-skeleton'

/** Mayor: período, la cuenta y el estado de cuenta con su saldo. */
export default function MayorLoading() {
  return <BookSkeleton picker="range" filters rows={10} columns={6} />
}
