import { Link2 } from 'lucide-react'

export default function PublicLinksNotFound() {
  return (
    <div className="force-light flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Link2 className="size-7" aria-hidden />
      </div>
      <h1 className="font-serif text-2xl font-semibold">Esta página no está disponible</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        El enlace puede haber cambiado o estar apagado por el momento. Probá entrar de nuevo desde
        el perfil de Instagram del bar.
      </p>
    </div>
  )
}
