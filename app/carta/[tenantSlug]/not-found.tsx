import { UtensilsCrossed } from 'lucide-react'

export default function CartaNotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <UtensilsCrossed className="size-7" aria-hidden />
      </div>
      <h1 className="font-serif text-2xl font-semibold">Carta no encontrada</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        El enlace puede estar vencido o el bar todavía no publicó su carta. Pedile el QR actualizado
        al personal.
      </p>
    </div>
  )
}
