import { SearchX } from 'lucide-react'

export default function ReviewNotFound(): React.JSX.Element {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10">
      <section className="card-hairline w-full max-w-md rounded-3xl border bg-card p-9 text-center shadow-lg">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-full border border-border/80 bg-[--cream-tint] text-muted-foreground">
          <SearchX className="size-6" aria-hidden="true" />
        </div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Enlace no encontrado</h1>
        <p className="mx-auto mt-2 max-w-[34ch] text-pretty text-sm text-muted-foreground">
          No reconocimos este enlace de reseña. Puede haber expirado o estar mal copiado. Probá
          escaneando el QR de tu pantalla personal otra vez.
        </p>
      </section>
    </main>
  )
}
