import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Tu local"
        title="QR de la carta y del club"
        description={<Skeleton className="h-4 w-96" />}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        {['carta', 'club'].map((k) => (
          <Skeleton key={k} className="h-80 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
