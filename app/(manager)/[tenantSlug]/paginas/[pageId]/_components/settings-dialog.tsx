'use client'

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
import { Switch } from '@/components/ui/switch'
import { type LandingActionState, updateLandingSettings } from '@/lib/landings/actions'
import type { LandingPageDetail } from '@/lib/landings/queries'
import { checkSlugFormat, LANDING_SLUG_HINT } from '@/lib/landings/schemas'

const INITIAL: LandingActionState = { ok: false, message: '' }

export function SettingsDialog({
  tenantSlug,
  page,
  urlPrefix,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  page: LandingPageDetail
  urlPrefix: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [slug, setSlug] = useState(page.slug)
  const [indexable, setIndexable] = useState(page.indexable)

  const slugError = checkSlugFormat(slug)
  const slugChanged = slug !== page.slug

  const [state, formAction, pending] = useActionState(
    (prev: LandingActionState, fd: FormData) => updateLandingSettings(tenantSlug, prev, fd),
    INITIAL,
  )

  useEffect(() => {
    if (state.ok) {
      toast.success('Ajustes guardados.')
      onOpenChange(false)
      router.refresh()
    } else if (state.message) {
      toast.error(state.message)
    }
  }, [state, onOpenChange, router])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Ajustes de la página</DialogTitle>
          <DialogDescription>El nombre interno, el link y si aparece en Google.</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={page.id} />
          <input type="hidden" name="indexable" value={indexable ? 'true' : 'false'} />

          <div className="space-y-1.5">
            <Label htmlFor="settings-title">
              Nombre<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="settings-title"
              name="title"
              required
              maxLength={80}
              defaultValue={page.title}
            />
            <p className="text-xs text-muted-foreground">
              Sólo se ve en esta lista. El título que lee la gente es el {'<title>'} del HTML.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="settings-slug">
              Link público<span className="text-destructive"> *</span>
            </Label>
            <div className="flex items-center overflow-hidden rounded-lg border border-input bg-background focus-within:ring-[3px] focus-within:ring-ring/50">
              <span className="shrink-0 truncate border-r border-input bg-cream-tint px-2.5 py-2 font-mono text-xs text-muted-foreground">
                {urlPrefix}
              </span>
              <input
                id="settings-slug"
                name="slug"
                required
                maxLength={40}
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-sm outline-none"
              />
            </div>
            {slugError ? (
              <p className="text-xs text-destructive">{slugError}</p>
            ) : slugChanged && page.published ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Ojo: la página está publicada. Al cambiar el link, el anterior deja de funcionar —
                si ya lo mandaste por WhatsApp o está en una historia, se rompe.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{LANDING_SLUG_HINT}</p>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-border/70 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="settings-indexable" className="cursor-pointer">
                Que Google la encuentre
              </Label>
              <p className="text-xs text-muted-foreground text-pretty">
                Apagado, la página funciona igual pero le pedimos a los buscadores que no la
                indexen. Prendelo sólo cuando esté terminada y quieras que aparezca en las
                búsquedas.
              </p>
            </div>
            <Switch
              id="settings-indexable"
              checked={indexable}
              onCheckedChange={setIndexable}
              aria-label="Que Google la encuentre"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || slugError !== null}>
              {pending ? 'Guardando…' : 'Guardar ajustes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
