'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarPlus,
  Check,
  FileText,
  Globe,
  ImageIcon,
  Images,
  ListOrdered,
  Loader2,
  Minus,
  Palette,
  Plus,
  ReceiptText,
  ScrollText,
  Trash2,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from 'react'
import {
  Controller,
  type FieldErrors,
  type FieldPath,
  FormProvider,
  useForm,
  useFormContext,
  useWatch,
} from 'react-hook-form'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { eventInk } from '@/lib/salon/event-ink'
import { deleteExperience, saveExperience, setExperiencePublished } from '@/lib/ticketing/actions'
import type { AdminExperience } from '@/lib/ticketing/queries'
import { type ExperienceFormInput, experienceFormSchema } from '@/lib/ticketing/schemas'
import { cn } from '@/lib/utils'
import { FunctionChip } from '../../_components/function-chip'
import { PanelSection } from '../../_components/panel-section'
import { PesosField } from '../../_components/pesos-field'
import {
  experienceToFormValues,
  finalizeSlug,
  invalidFormMessage,
  isExperienceFieldPath,
  MAX_PARTY_SIZE,
  priceExample,
  sanitizeSlugInput,
} from '../../_lib/experience-form'
import { CharCount, describedBy, Field } from './form-bits'
import { GalleryEditor } from './gallery-editor'
import { ImageField } from './image-field'
import { StepsEditor } from './steps-editor'

const HEX_RE = /^#[0-9a-f]{6}$/i

/** Lista plana de los campos con error («steps.2.title»), para el aviso de «revisá…». */
function errorPaths(errors: FieldErrors<ExperienceFormInput>): string[] {
  return Object.keys(errors)
}

/**
 * El editor de la página de una película.
 *
 * El formulario trabaja en lo que ve el dueño (pesos, textos) y `saveExperience`
 * lo vuelve a validar con el mismo `experienceFormSchema`, que pasa los pesos a
 * centavos: por eso el resolver va en modo `raw` (valida, pero manda lo
 * tipeado).
 *
 * Publicar es al toque, como en la lista. Si hay cambios sin guardar, publicar
 * guarda todo junto: si no, se publicaría la versión vieja.
 */
export function ExperienceEditor({
  tenantSlug,
  tenantId,
  experience,
  publicBase,
}: {
  tenantSlug: string
  tenantId: string
  experience: AdminExperience
  /** `https://…/entradas/<bar>`: el link de la película es `${publicBase}/${slug}`. */
  publicBase: string
}) {
  const router = useRouter()
  // Una sola vez por película (el editor va con `key={experience.id}`): son los valores del
  // formulario y también el `defaultValue` de cada input, así el primer paint (SSR) ya los muestra
  // en vez de esperar a que React Hook Form los ponga al hidratar.
  const [initial] = useState(() => experienceToFormValues(experience))
  const form = useForm<ExperienceFormInput>({
    resolver: zodResolver(experienceFormSchema, undefined, { raw: true }),
    defaultValues: initial,
  })
  const { control, register, handleSubmit, getValues, setValue, reset, resetField, setError } = form
  const { isDirty, errors } = form.formState

  const [saving, startSaving] = useTransition()
  const [publishing, startPublishing] = useTransition()
  const [deleting, startDeleting] = useTransition()
  const [uploads, setUploads] = useState(0)
  const [leaveTo, setLeaveTo] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const title = useWatch({ control, name: 'title' })
  const slug = useWatch({ control, name: 'slug' })
  const published = useWatch({ control, name: 'published' })
  const price = useWatch({ control, name: 'price' })
  const deposit = useWatch({ control, name: 'deposit' })
  const cashPrice = useWatch({ control, name: 'cash_price' })
  const minParty = useWatch({ control, name: 'min_party_size' })
  const maxParty = useWatch({ control, name: 'max_party_size' })
  const priceNote = useWatch({ control, name: 'price_note' })
  const synopsis = useWatch({ control, name: 'synopsis' })
  const stepsNote = useWatch({ control, name: 'steps_note' })
  const terms = useWatch({ control, name: 'terms' })

  const overviewHref = `/${tenantSlug}/entradas`
  const calendarHref = `/${tenantSlug}/eventos/programados`
  // El link guardado (el que ya anda) y el que va a quedar si se guarda.
  const savedSlug = experience.slug
  const publicHref = `/entradas/${tenantSlug}/${savedSlug}`
  const publicUrl = `${publicBase}/${savedSlug}`
  const previewUrl = `${publicBase}/${slug || '…'}`
  const busy = saving || publishing || deleting
  const example = priceExample({
    price,
    deposit,
    cashPrice,
    maxPartySize: maxParty,
    minPartySize: minParty,
  })
  const ink = eventInk(experience.templateColor)

  const applyServerError = useCallback(
    (result: { message: string; field?: string }) => {
      if (result.field && isExperienceFieldPath(result.field)) {
        setError(result.field as FieldPath<ExperienceFormInput>, {
          type: 'server',
          message: result.message,
        })
      }
    },
    [setError],
  )

  /** Guarda todo. Resuelve `true` si quedó guardado. */
  const save = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        void handleSubmit(
          (values) => {
            startSaving(async () => {
              const result = await saveExperience(tenantSlug, values)
              if (result.ok) {
                // keepValues: si siguió escribiendo mientras se guardaba, eso
                // sigue en pantalla (y vuelve a marcar «sin guardar»).
                reset(values, { keepValues: true })
                toast.success(result.message ?? 'Guardado.')
                resolve(true)
              } else {
                applyServerError(result)
                toast.error(result.message)
                resolve(false)
              }
            })
          },
          (invalid) => {
            toast.error(invalidFormMessage(errorPaths(invalid)))
            resolve(false)
          },
        )()
      }),
    [applyServerError, handleSubmit, reset, tenantSlug],
  )

  // ⌘S / Ctrl+S, como en el editor de Páginas.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (isDirty && !busy && uploads === 0) void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, isDirty, save, uploads])

  // Cerrar la pestaña con cambios sin guardar tiene que costar una pregunta.
  useEffect(() => {
    if (!isDirty) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  /**
   * Los links que salen del editor dentro del panel. La navegación del App
   * Router no dispara `beforeunload`: sin esto, salir con cambios los perdía
   * sin una pregunta.
   */
  function guard(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!isDirty || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    setLeaveTo(href)
  }

  function togglePublished(next: boolean) {
    const previous = getValues('published')
    // Fuera de la transición: así el switch se mueve al toque (lo de adentro espera a la acción).
    setValue('published', next)
    startPublishing(async () => {
      if (next && isDirty) {
        // Publicar con cambios sin guardar publicaría la versión vieja: va todo junto.
        const valid = await form.trigger()
        if (!valid) {
          setValue('published', previous)
          toast.error(invalidFormMessage(errorPaths(form.formState.errors), 'publicar'))
          return
        }
        const values = getValues()
        const result = await saveExperience(tenantSlug, values)
        if (result.ok) {
          reset(values, { keepValues: true })
          toast.success(result.message ?? 'Guardado y publicado.')
        } else {
          setValue('published', previous)
          applyServerError(result)
          toast.error(result.message)
        }
        return
      }
      const result = await setExperiencePublished(tenantSlug, experience.id, next)
      if (result.ok) {
        // Solo cambia «publicada»: lo demás que no se guardó sigue sin guardar.
        resetField('published', { defaultValue: next })
        toast.success(result.message ?? (next ? 'Publicada.' : 'Apagada.'))
      } else {
        setValue('published', previous)
        toast.error(result.message)
      }
    })
  }

  function onDelete() {
    startDeleting(async () => {
      const result = await deleteExperience(tenantSlug, experience.id)
      if (result.ok) {
        setConfirmDelete(false)
        // Ya no hay nada que perder: que no salte el aviso de cambios sin guardar.
        reset(getValues())
        toast.success(result.message ?? 'Página borrada.')
        router.push(overviewHref)
      } else {
        toast.error(result.message)
      }
    })
  }

  const onBusyChange = useCallback((delta: 1 | -1) => setUploads((n) => n + delta), [])

  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && uploads === 0) void save()
        }}
        className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      >
        {/* ── Encabezado ───────────────────────────────────── */}
        <header className="flex items-start gap-3">
          <Button asChild variant="ghost" size="icon" className="mt-1 size-11 shrink-0 sm:size-9">
            <Link
              href={overviewHref}
              aria-label="Volver a Entradas"
              onClick={(event) => guard(event, overviewHref)}
            >
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Marketing · Entradas
            </div>
            <h1 className="truncate font-serif text-3xl font-semibold leading-tight tracking-[-0.015em]">
              {title?.trim() || experience.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: experience.templateColor }}
                />
                Formato del calendario: {experience.templateName}
              </span>
              {published ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-foreground">
                  Publicada
                </span>
              ) : (
                <span className="rounded-full border border-dashed border-border px-2 py-0.5 font-medium text-muted-foreground">
                  Apagada
                </span>
              )}
              {isDirty ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning-text">
                  <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                  Sin guardar
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[auto_auto_1fr]">
          {/* ── Publicación (arriba en el celu, a la derecha en la compu) ── */}
          <PanelSection
            id="publicacion"
            icon={Globe}
            title="Publicación"
            className="lg:col-start-2 lg:row-start-1"
          >
            <div className="space-y-3">
              <label
                htmlFor="published"
                className={cn(
                  'flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition-colors',
                  published ? 'border-primary/40 bg-primary/5' : 'border-border bg-background/60',
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Publicada en la cartelera</span>
                  <span className="block text-xs text-muted-foreground text-pretty">
                    {published
                      ? 'Se ve en la cartelera y se puede comprar.'
                      : 'Apagada: no aparece en la cartelera y el link no abre para el público.'}
                  </span>
                </span>
                {publishing ? (
                  <Loader2
                    className="size-4 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : null}
                {/* Con Controller y no solo setValue: `resetField('published')` no hace nada
                    si el campo no está registrado, y quedaba «sin guardar» después de publicar. */}
                <Controller
                  control={control}
                  name="published"
                  render={({ field }) => (
                    <Switch
                      id="published"
                      ref={field.ref}
                      checked={Boolean(field.value)}
                      onCheckedChange={togglePublished}
                      disabled={busy}
                      aria-label="Publicada en la cartelera"
                    />
                  )}
                />
              </label>

              <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 truncate font-mono text-xs" title={publicUrl}>
                  {publicUrl.replace(/^https?:\/\//, '')}
                </code>
                <CopyButton
                  value={publicUrl}
                  iconOnly
                  variant="ghost"
                  label="Copiar el link de la película"
                  copiedLabel="¡Copiado!"
                />
              </div>

              <Button asChild variant="outline" className="h-11 w-full sm:h-9">
                <a href={publicHref} target="_blank" rel="noopener noreferrer">
                  {published ? 'Ver página' : 'Vista previa'}
                  <ArrowUpRight className="size-4" aria-hidden />
                  <span className="sr-only">(se abre en otra pestaña)</span>
                </a>
              </Button>
              {isDirty ? (
                <p className="text-xs text-muted-foreground text-pretty">
                  La página muestra lo último guardado: guardá para ver los cambios.
                </p>
              ) : null}
            </div>
          </PanelSection>

          {/* ── El formulario ───────────────────────────────── */}
          <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-3 lg:row-start-1">
            <PanelSection
              id="textos"
              icon={FileText}
              title="Textos"
              description="Lo que se lee en la cartelera y en la página de la película."
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="title" label="Título" required error={errors.title?.message}>
                    <Input
                      id="title"
                      maxLength={80}
                      className="h-11"
                      aria-required
                      aria-invalid={errors.title ? true : undefined}
                      aria-describedby={describedBy('title', { error: !!errors.title })}
                      defaultValue={initial.title ?? ''}
                      {...register('title')}
                    />
                  </Field>
                  <Field
                    id="series"
                    label="Colección"
                    optional
                    hint="Agrupa las películas en la cartelera."
                    error={errors.series?.message}
                  >
                    <Input
                      id="series"
                      maxLength={60}
                      placeholder="Cine y degustación"
                      className="h-11"
                      aria-invalid={errors.series ? true : undefined}
                      aria-describedby={describedBy('series', {
                        hint: true,
                        error: !!errors.series,
                      })}
                      defaultValue={initial.series ?? ''}
                      {...register('series')}
                    />
                  </Field>
                </div>

                <Field
                  id="tagline"
                  label="Frase"
                  optional
                  hint="Una línea debajo del título."
                  error={errors.tagline?.message}
                >
                  <Input
                    id="tagline"
                    maxLength={160}
                    placeholder="Un ogro, un burro y un menú de pantano."
                    className="h-11"
                    aria-invalid={errors.tagline ? true : undefined}
                    aria-describedby={describedBy('tagline', {
                      hint: true,
                      error: !!errors.tagline,
                    })}
                    defaultValue={initial.tagline ?? ''}
                    {...register('tagline')}
                  />
                </Field>

                <Field
                  id="synopsis"
                  label="Sinopsis"
                  optional
                  error={errors.synopsis?.message}
                  counter={<CharCount value={synopsis} max={1500} />}
                >
                  <Textarea
                    id="synopsis"
                    rows={5}
                    maxLength={1500}
                    placeholder="De qué va la película y qué se vive esa noche."
                    aria-invalid={errors.synopsis ? true : undefined}
                    aria-describedby={describedBy('synopsis', { error: !!errors.synopsis })}
                    defaultValue={initial.synopsis ?? ''}
                    {...register('synopsis')}
                  />
                </Field>

                <Field
                  id="schedule_note"
                  label="Horario"
                  optional
                  hint="Texto libre: el día y la hora salen de cada función."
                  error={errors.schedule_note?.message}
                >
                  <Input
                    id="schedule_note"
                    maxLength={120}
                    placeholder="Ingreso 21:00 · Película 21:20"
                    className="h-11"
                    aria-invalid={errors.schedule_note ? true : undefined}
                    aria-describedby={describedBy('schedule_note', {
                      hint: true,
                      error: !!errors.schedule_note,
                    })}
                    defaultValue={initial.schedule_note ?? ''}
                    {...register('schedule_note')}
                  />
                </Field>

                <Controller
                  control={control}
                  name="slug"
                  render={({ field }) => (
                    <Field
                      id="slug"
                      label="Link"
                      required
                      error={errors.slug?.message}
                      hint={
                        <>
                          Así queda:{' '}
                          <span className="break-all font-mono text-foreground">
                            {previewUrl.replace(/^https?:\/\//, '')}
                          </span>
                          {published && slug !== savedSlug
                            ? '. Ojo: el link viejo deja de andar, y si ya lo compartiste, la gente cae en un error.'
                            : null}
                        </>
                      }
                    >
                      <div
                        className={cn(
                          'flex items-center overflow-hidden rounded-md border border-input bg-background/60 shadow-2xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40',
                          errors.slug && 'border-destructive',
                        )}
                      >
                        <span className="hidden max-w-[55%] shrink-0 truncate border-r border-input bg-cream-tint px-2.5 py-3 font-mono text-xs text-muted-foreground sm:block">
                          …/entradas/{tenantSlug}/
                        </span>
                        <input
                          id="slug"
                          ref={field.ref}
                          name={field.name}
                          value={field.value ?? ''}
                          onChange={(event) =>
                            field.onChange(sanitizeSlugInput(event.target.value))
                          }
                          onBlur={() => {
                            const clean = finalizeSlug(field.value ?? '')
                            if (clean !== field.value) field.onChange(clean)
                            field.onBlur()
                          }}
                          maxLength={60}
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          aria-required
                          aria-invalid={errors.slug ? true : undefined}
                          aria-describedby={describedBy('slug', {
                            hint: true,
                            error: !!errors.slug,
                          })}
                          className="h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-base outline-none md:text-sm"
                        />
                      </div>
                    </Field>
                  )}
                />
              </div>
            </PanelSection>

            <PanelSection
              id="imagenes"
              icon={ImageIcon}
              title="Imágenes"
              description="JPG, PNG, WebP o GIF de hasta 10 MB. Las achicamos al formato más liviano."
            >
              <div className="grid gap-6 sm:grid-cols-[13rem_minmax(0,1fr)]">
                <Controller
                  control={control}
                  name="poster_url"
                  render={({ field }) => (
                    <ImageField
                      id="poster"
                      label="Afiche vertical"
                      hint="Proporción 2:3 (por ejemplo, 1000 × 1500). Es lo que se ve en la cartelera."
                      tenantId={tenantId}
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      shape="poster"
                      onBusyChange={onBusyChange}
                      buttonRef={field.ref}
                      error={errors.poster_url?.message}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="hero_url"
                  render={({ field }) => (
                    <ImageField
                      id="hero"
                      label="Imagen de portada"
                      hint="Horizontal, 16:9 (por ejemplo, 1920 × 1080). Va de fondo arriba de la página; sin portada se usa una escena o el afiche."
                      tenantId={tenantId}
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      shape="wide"
                      onBusyChange={onBusyChange}
                      buttonRef={field.ref}
                      error={errors.hero_url?.message}
                    />
                  )}
                />
              </div>
            </PanelSection>

            <PanelSection
              id="color"
              icon={Palette}
              title="Color de la página"
              description="El de los botones y los detalles de la página de la película."
            >
              <Controller
                control={control}
                name="accent_hex"
                render={({ field }) => {
                  const valid = HEX_RE.test(field.value ?? '')
                  return (
                    <Field id="accent_hex" label="Color" error={errors.accent_hex?.message}>
                      <div className="flex flex-wrap items-center gap-3">
                        <label
                          className="relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border shadow-xs focus-within:ring-[3px] focus-within:ring-ring/50"
                          style={{
                            backgroundColor: valid ? (field.value ?? undefined) : undefined,
                          }}
                        >
                          <span className="sr-only">Elegir el color</span>
                          <input
                            type="color"
                            value={valid ? (field.value ?? '').toLowerCase() : '#000000'}
                            onChange={(event) => field.onChange(event.target.value.toLowerCase())}
                            className="absolute inset-0 size-full cursor-pointer opacity-0"
                          />
                        </label>
                        <Input
                          id="accent_hex"
                          ref={field.ref}
                          value={field.value ?? ''}
                          onChange={(event) => field.onChange(event.target.value.trim())}
                          onBlur={field.onBlur}
                          maxLength={7}
                          placeholder="#c0573e"
                          autoCapitalize="off"
                          spellCheck={false}
                          aria-invalid={errors.accent_hex ? true : undefined}
                          aria-describedby={describedBy('accent_hex', {
                            error: !!errors.accent_hex,
                          })}
                          className="h-11 w-32 font-mono"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-11 sm:h-9"
                          onClick={() => field.onChange(experience.templateColor.toLowerCase())}
                        >
                          <span
                            aria-hidden
                            className="size-3 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: experience.templateColor }}
                          />
                          Usar el del formato
                        </Button>
                      </div>
                    </Field>
                  )
                }}
              />
            </PanelSection>

            <PanelSection
              id="precios"
              icon={Wallet}
              title="Precios"
              description="Todo por persona. Con seña, el resto se paga en efectivo en el bar."
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Controller
                    control={control}
                    name="price"
                    render={({ field }) => (
                      <PesosField
                        id="price"
                        label="Mercado Pago"
                        required
                        value={String(field.value ?? '')}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        inputRef={field.ref}
                        placeholder="35.000"
                        hint="Si paga todo online."
                        error={errors.price?.message}
                      />
                    )}
                  />
                  <Controller
                    control={control}
                    name="cash_price"
                    render={({ field }) => (
                      <PesosField
                        id="cash_price"
                        label="Efectivo"
                        value={String(field.value ?? '')}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        inputRef={field.ref}
                        placeholder="30.000"
                        hint="Seña + lo que paga en el bar. Vacío: el mismo."
                        error={errors.cash_price?.message}
                      />
                    )}
                  />
                  <Controller
                    control={control}
                    name="deposit"
                    render={({ field }) => (
                      <PesosField
                        id="deposit"
                        label="Seña"
                        value={String(field.value ?? '')}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        inputRef={field.ref}
                        placeholder="5.000"
                        hint="0 = solo pago total."
                        error={errors.deposit?.message}
                      />
                    )}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <PartySizeField
                    name="min_party_size"
                    label="Mínimo por compra"
                    hint="Desde cuántas personas se vende."
                  />
                  <PartySizeField
                    name="max_party_size"
                    label="Máximo por compra"
                    hint="Personas en una misma compra."
                  />
                </div>

                <Field
                  id="price_note"
                  label="Aclaración junto al total"
                  optional
                  hint="Va en la entrada, debajo de lo que se paga: lo que no incluye el precio."
                  error={errors.price_note?.message}
                  counter={<CharCount value={priceNote} max={140} />}
                >
                  <Input
                    id="price_note"
                    maxLength={140}
                    placeholder="Las bebidas se pagan aparte."
                    className="h-11"
                    aria-invalid={errors.price_note ? true : undefined}
                    aria-describedby={describedBy('price_note', {
                      hint: true,
                      error: !!errors.price_note,
                    })}
                    defaultValue={initial.price_note ?? ''}
                    {...register('price_note')}
                  />
                </Field>

                <div className="flex items-start gap-2.5 rounded-xl bg-cream-tint px-3.5 py-3 text-sm">
                  <ReceiptText
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  {example ? (
                    <p className="text-pretty">
                      <span className="font-medium">{example.people}:</span>{' '}
                      {example.deposit ? (
                        <>
                          seña <strong className="tabular-nums">{example.deposit.today}</strong> hoy
                          y <strong className="tabular-nums">{example.deposit.cash}</strong> en
                          efectivo, o <strong className="tabular-nums">{example.full}</strong> todo
                          junto.
                        </>
                      ) : (
                        <>
                          <strong className="tabular-nums">{example.full}</strong> todo junto (sin
                          seña).
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">Poné el precio para ver la cuenta.</p>
                  )}
                </div>
              </div>
            </PanelSection>

            <PanelSection
              id="menu"
              icon={ListOrdered}
              title="Menú paso a paso"
              description="Un paso por momento de la película. Se muestran en este orden."
            >
              <div className="space-y-5">
                <StepsEditor />
                <Field
                  id="steps_note"
                  label="Nota del menú"
                  optional
                  hint="Se lee mientras el menú no tenga pasos (por ejemplo, si todavía se está armando)."
                  error={errors.steps_note?.message}
                  counter={<CharCount value={stepsNote} max={400} />}
                >
                  <Textarea
                    id="steps_note"
                    rows={2}
                    maxLength={400}
                    placeholder="El menú se confirma una semana antes de cada función."
                    aria-invalid={errors.steps_note ? true : undefined}
                    aria-describedby={describedBy('steps_note', {
                      hint: true,
                      error: !!errors.steps_note,
                    })}
                    defaultValue={initial.steps_note ?? ''}
                    {...register('steps_note')}
                  />
                </Field>
              </div>
            </PanelSection>

            <PanelSection
              id="fotos"
              icon={Images}
              title="Fotos"
              description="Escenas de la película y fotos reales de una función en el bar."
            >
              <GalleryEditor tenantId={tenantId} onBusyChange={onBusyChange} />
            </PanelSection>

            <PanelSection
              id="condiciones"
              icon={ScrollText}
              title="Condiciones"
              description="Se muestran antes de pagar."
            >
              <Field
                id="terms"
                label="Condiciones de la compra"
                optional
                error={errors.terms?.message}
                counter={<CharCount value={terms} max={800} />}
              >
                <Textarea
                  id="terms"
                  rows={4}
                  maxLength={800}
                  placeholder="La seña no se devuelve si cancelás con menos de 48 horas. Menores acompañados por un adulto."
                  aria-invalid={errors.terms ? true : undefined}
                  aria-describedby={describedBy('terms', { error: !!errors.terms })}
                  defaultValue={initial.terms ?? ''}
                  {...register('terms')}
                />
              </Field>
            </PanelSection>
          </div>

          {/* ── Funciones (solo lectura) ─────────────────────── */}
          <PanelSection
            id="funciones"
            icon={CalendarPlus}
            title="Funciones"
            description={`Las fechas de «${experience.templateName}» en el Calendario. El cupo se cambia ahí.`}
            className="lg:col-start-2 lg:row-start-2"
          >
            <div className="space-y-3">
              {experience.functions.length === 0 ? (
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  No hay fechas a la venta. Programalas en el Calendario con este formato.
                </p>
              ) : (
                <ul
                  aria-label="Funciones a la venta"
                  style={
                    ink ? ({ '--ev-l': ink.light, '--ev-d': ink.dark } as CSSProperties) : undefined
                  }
                  className="ev-ink flex flex-wrap gap-2"
                >
                  {experience.functions.map((fn) => {
                    const href = `${calendarHref}?day=${fn.date}`
                    return (
                      <li key={fn.eventId}>
                        <Link
                          href={href}
                          onClick={(event) => guard(event, href)}
                          className="block rounded-lg outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <FunctionChip fn={fn} />
                          <span className="sr-only">(ver ese día en el Calendario)</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
              <Button asChild variant="outline" className="h-11 w-full sm:h-9">
                <Link href={calendarHref} onClick={(event) => guard(event, calendarHref)}>
                  <CalendarPlus className="size-4" aria-hidden />
                  Sumar fechas en el Calendario
                </Link>
              </Button>
            </div>
          </PanelSection>

          {/* ── Borrar ───────────────────────────────────────── */}
          <section
            aria-label="Borrar la página"
            className="rounded-xl border border-dashed border-destructive/40 p-4 lg:col-start-2 lg:row-start-3 lg:self-start"
          >
            <p className="text-sm font-medium">Borrar la página</p>
            <p className="mt-1 text-xs text-muted-foreground text-pretty">
              Se borra la página de la película. Las fechas del Calendario, las compras y sus
              reservas no se tocan.
            </p>
            <Button
              type="button"
              variant="ghost"
              className="mt-3 h-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-9"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" aria-hidden />
              Borrar página
            </Button>
          </section>
        </div>

        {/* ── Barra de guardado ───────────────────────────── */}
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/90 px-4 py-3 shadow-lg backdrop-blur">
          <p className="flex items-center gap-2 text-sm" aria-live="polite">
            {uploads > 0 ? (
              <>
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                Subiendo imágenes…
              </>
            ) : isDirty ? (
              <>
                <span aria-hidden className="size-2 rounded-full bg-warning" />
                Tenés cambios sin guardar
              </>
            ) : (
              <>
                <Check className="size-4 text-success" aria-hidden />
                <span className="text-muted-foreground">Todo guardado</span>
              </>
            )}
          </p>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <Button asChild variant="ghost" className="hidden h-11 sm:inline-flex sm:h-10">
              <a href={publicHref} target="_blank" rel="noopener noreferrer">
                {published ? 'Ver página' : 'Vista previa'}
                <ArrowUpRight className="size-4" aria-hidden />
                <span className="sr-only">(se abre en otra pestaña)</span>
              </a>
            </Button>
            <Button
              type="submit"
              className="h-11 min-w-[9rem] text-base sm:h-10 sm:text-sm"
              disabled={!isDirty || busy || uploads > 0}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {saving ? 'Guardando…' : isDirty ? 'Guardar' : 'Guardado'}
            </Button>
          </div>
        </div>
      </form>

      {/* Salir con cambios sin guardar */}
      <AlertDialog open={leaveTo !== null} onOpenChange={(open) => !open && setLeaveTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tenés cambios sin guardar</AlertDialogTitle>
            <AlertDialogDescription>
              Si salís ahora se pierde lo que cambiaste desde la última vez que guardaste.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={busy || uploads > 0}
              onClick={async () => {
                const target = leaveTo
                const ok = await save()
                if (ok && target) {
                  setLeaveTo(null)
                  router.push(target)
                }
              }}
            >
              Guardar y salir
            </Button>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                const target = leaveTo
                setLeaveTo(null)
                if (target) router.push(target)
              }}
            >
              Salir sin guardar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Borrar la página */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la página de «{experience.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {experience.published
                ? 'Está publicada: sale de la cartelera y su link deja de andar al instante. '
                : ''}
              Las fechas del Calendario, las compras que ya entraron y sus reservas quedan como
              están. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                onDelete()
              }}
            >
              {deleting ? 'Borrando…' : 'Sí, borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormProvider>
  )
}

/**
 * Personas por compra (mínimo o máximo): − número +, de 1 a MAX_PARTY_SIZE.
 * Al salir del campo, lo tipeado se acomoda al rango.
 */
function PartySizeField({
  name,
  label,
  hint,
}: {
  name: 'min_party_size' | 'max_party_size'
  label: string
  hint: string
}) {
  const {
    control,
    formState: { errors },
  } = useFormContext<ExperienceFormInput>()
  const error = errors[name]
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const raw = field.value
        const typed = raw === '' || raw === null || raw === undefined ? '' : String(raw)
        const value = Number(typed)
        const current = typed !== '' && Number.isFinite(value) && value >= 1 ? value : 1
        const set = (next: number) =>
          field.onChange(Math.min(MAX_PARTY_SIZE, Math.max(1, Math.round(next))))
        return (
          <Field
            id={name}
            label={label}
            hint={hint}
            // El «mínimo mayor que el máximo» trae su texto; para lo demás, el
            // rango (zod lo diría en inglés si el campo queda vacío).
            error={
              error
                ? error.type === 'custom'
                  ? error.message
                  : `Entre 1 y ${MAX_PARTY_SIZE} personas.`
                : undefined
            }
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                aria-label={`${label}: una persona menos`}
                disabled={current <= 1}
                onClick={() => set(current - 1)}
              >
                <Minus className="size-4" aria-hidden />
              </Button>
              <Input
                id={name}
                ref={field.ref}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_PARTY_SIZE}
                value={typed}
                onChange={(event) =>
                  field.onChange(event.target.value === '' ? '' : Number(event.target.value))
                }
                onBlur={() => {
                  set(current)
                  field.onBlur()
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy(name, { hint: true, error: !!error })}
                className="h-11 w-20 text-center text-base tabular-nums md:text-base"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                aria-label={`${label}: una persona más`}
                disabled={current >= MAX_PARTY_SIZE}
                onClick={() => set(current + 1)}
              >
                <Plus className="size-4" aria-hidden />
              </Button>
            </div>
          </Field>
        )
      }}
    />
  )
}
