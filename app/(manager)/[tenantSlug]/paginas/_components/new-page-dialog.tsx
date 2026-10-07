'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FormError } from '@/components/ui/field'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
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
        <Plus aria-hidden />
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

  const [state, formAction] = useActionState(
    (prev: LandingActionState, fd: FormData) => createLandingPage(tenantSlug, prev, fd),
    INITIAL,
  )

  // El error del server se ve adentro del formulario (FormError).
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
    }
  }, [state, onOpenChange, router, tenantSlug, initialHtml])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva página</DialogTitle>
          <DialogDescription>
            {initialHtml !== null
              ? 'Ponele nombre y link a tu archivo. El código ya lo tenemos.'
              : 'Primero el nombre y el link. El HTML lo pegás en la pantalla siguiente.'}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="grid gap-4">
            <FormError message={state.ok ? null : state.message} />

            <Field
              label="Nombre"
              name="title"
              required
              hint="Es para vos: así la encontrás en la lista. Lo que ve la gente es el título que pongas dentro del HTML."
            >
              <Input
                autoFocus
                maxLength={80}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Halloween 2026"
              />
            </Field>

            <Field
              label="Link público"
              name="slug"
              required
              hint={slugError ? undefined : LANDING_SLUG_HINT}
              error={slugError}
            >
              <SlugInput
                prefix={urlPrefix}
                value={effectiveSlug}
                onChange={(next) => {
                  setSlugTouched(true)
                  setSlug(next.toLowerCase())
                }}
                placeholder="halloween-2026"
              />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <SubmitButton pendingText="Creando…" disabled={slugError !== null}>
              {initialHtml !== null ? 'Crear con este archivo' : 'Crear y cargar el HTML'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * El final del link, con la dirección fija adelante («hubbar.com.ar/p/»). Va
 * adentro de un `Field`: el Input toma de ahí id, name y la ayuda.
 */
export function SlugInput({
  prefix,
  value,
  onChange,
  placeholder,
}: {
  prefix: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <InputGroup>
      <InputAddon className="min-w-0 max-w-[55%] shrink">
        <span className="truncate font-mono type-caption">{prefix}</span>
      </InputAddon>
      <Input
        maxLength={40}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="font-mono"
      />
    </InputGroup>
  )
}
