'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createLandingPage, type LandingActionState, saveLandingHtml } from '@/lib/landings/actions'
import { checkSlugFormat, LANDING_SLUG_HINT, suggestLandingSlug } from '@/lib/landings/schemas'

const INITIAL: LandingActionState = { ok: false, message: '' }

export function NewPageButton({
  tenantSlug,
  urlPrefix,
}: {
  tenantSlug: string
  /** "hubbar.com.ar/p/" — sólo para que se vea el link mientras se escribe. */
  urlPrefix: string
}) {
  const [open, setOpen] = useState(false)
  // Remonta el diálogo en cada apertura: `useActionState` arranca limpio y no
  // arrastra el error del intento anterior.
  const [session, setSession] = useState(0)

  return (
    <>
      <Button
        onClick={() => {
          setSession((n) => n + 1)
          setOpen(true)
        }}
      >
        <Plus className="size-4" aria-hidden />
        Nueva página
      </Button>
      <NewPageDialog
        key={session}
        tenantSlug={tenantSlug}
        urlPrefix={urlPrefix}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

export function NewPageDialog({
  tenantSlug,
  urlPrefix,
  open,
  onOpenChange,
  initialTitle = '',
  initialHtml = null,
}: {
  tenantSlug: string
  urlPrefix: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Cuando llega de un archivo arrastrado: el nombre sale del archivo. */
  initialTitle?: string
  /** El HTML del archivo soltado: se guarda apenas se crea la página. */
  initialHtml?: string | null
}) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [slug, setSlug] = useState('')
  // Mientras el dueño no toque el link a mano, lo derivamos del nombre. Apenas
  // lo edita, deja de moverse solo (si no, escribir el nombre le pisaría lo suyo).
  const [slugTouched, setSlugTouched] = useState(false)

  const effectiveSlug = slugTouched ? slug : suggestLandingSlug(title)
  const slugError = effectiveSlug.length > 0 ? checkSlugFormat(effectiveSlug) : null

  const [state, formAction, pending] = useActionState(
    (prev: LandingActionState, fd: FormData) => createLandingPage(tenantSlug, prev, fd),
    INITIAL,
  )

  useEffect(() => {
    if (state.ok && state.id) {
      const pageId = state.id
      onOpenChange(false)
      // Si vino de un archivo, el HTML se guarda enseguida y el dueño cae en el
      // editor con su landing ya adentro — no en una pantalla en blanco.
      if (initialHtml !== null) {
        void saveLandingHtml(tenantSlug, { id: pageId, html: initialHtml }).then((result) => {
          if (result.ok) toast.success('Archivo cargado. Mirá la previa y publicá.')
          else toast.error(result.message)
          router.push(`/${tenantSlug}/paginas/${pageId}`)
        })
        return
      }
      toast.success('Página creada. Ahora pegá el HTML.')
      router.push(`/${tenantSlug}/paginas/${pageId}`)
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state, onOpenChange, router, tenantSlug, initialHtml])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Nueva página</DialogTitle>
          <DialogDescription>
            {initialHtml !== null
              ? 'Ponele nombre y link a tu archivo. El código ya lo tenemos.'
              : 'Primero el nombre y el link. El HTML lo pegás en la pantalla siguiente.'}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">
              Nombre<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="title"
              name="title"
              required
              autoFocus
              maxLength={80}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Halloween 2026"
            />
            <p className="text-xs text-muted-foreground">
              Es para vos: así la encontrás en la lista. Lo que ve la gente es el título que pongas
              dentro del HTML.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slug">
              Link público<span className="text-destructive"> *</span>
            </Label>
            <div className="flex items-center gap-0 overflow-hidden rounded-lg border border-input bg-background focus-within:ring-[3px] focus-within:ring-ring/50">
              <span className="shrink-0 truncate border-r border-input bg-cream-tint px-2.5 py-2 font-mono text-xs text-muted-foreground">
                {urlPrefix}
              </span>
              <input
                id="slug"
                name="slug"
                required
                maxLength={40}
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(event.target.value.toLowerCase())
                }}
                placeholder="halloween-2026"
                className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground/70"
                aria-describedby="slug-hint"
              />
            </div>
            <p
              id="slug-hint"
              className={slugError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
            >
              {slugError ?? LANDING_SLUG_HINT}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || slugError !== null}>
              {pending
                ? 'Creando…'
                : initialHtml !== null
                  ? 'Crear con este archivo'
                  : 'Crear y cargar el HTML'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
