'use client'

import { CircleAlert } from 'lucide-react'
import * as React from 'react'
import { Callout } from '@/components/ui/callout'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Lo que el Field le pasa a su control (por contexto o por render-prop). */
export type FieldControlProps = {
  id: string
  name?: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
}

/** Lo que un control puede traer propio, con los tipos amplios de React. */
export type OwnFieldControlProps = {
  id?: string
  name?: string
  'aria-describedby'?: string
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
}

export type FieldLayout = 'stack' | 'inline' | 'toggle'

/**
 * Contrato recomendado para la Server Action de un formulario con Field
 * (§3.2): `fieldErrors` es lo que da `z.flattenError()` y entra tal cual en el
 * `error` de cada Field; `error` va al `FormError`.
 */
export type FormActionState = {
  ok: boolean
  error?: string
  fieldErrors?: Record<string, string[] | undefined>
} | null

/** Lo que un control del kit puede leer del Field que lo envuelve. */
export type FieldContextValue = {
  id: string
  /** Para los controles que no son `<label for>`-ables (grupos de radio): `aria-labelledby`. */
  labelId: string
  name?: string
  describedBy?: string
  invalid: boolean
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
  layout: FieldLayout
  reportError: (message: string | null) => void
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

function joinIds(...ids: Array<string | undefined | null | false>): string | undefined {
  const joined = ids.filter(Boolean).join(' ')
  return joined === '' ? undefined : joined
}

/** `fieldErrors` de zod vienen como arreglo: se muestra el primero. */
function firstError(error: string | readonly string[] | null | undefined): string | null {
  if (error == null) return null
  const message = typeof error === 'string' ? error : error[0]
  return message && message.trim() !== '' ? message : null
}

function noop() {}

/** El Field que envuelve al control, o `null` si va suelto. */
function useField(): FieldContextValue | null {
  return React.useContext(FieldContext)
}

/**
 * Para los controles del kit: mezcla lo del Field con lo propio (lo propio
 * gana). Afuera de un Field devuelve lo propio, con un `id` generado si no
 * vino uno (los compuestos lo necesitan para sus `aria-controls`).
 *
 * - `aria-describedby` se suma (primero la ayuda y el error del Field, después
 *   lo propio): un control con su propia descripción no pierde la del error.
 * - `aria-invalid` se normaliza a `true` o nada. Un `false` propio gana.
 */
function useFieldControl<P extends OwnFieldControlProps>(
  own: P,
): Omit<P, keyof FieldControlProps> & FieldControlProps {
  const field = React.useContext(FieldContext)
  const fallbackId = React.useId()
  const ownInvalid = own['aria-invalid']
  const invalid =
    ownInvalid === undefined
      ? field?.invalid === true
      : ownInvalid !== false && ownInvalid !== 'false'

  return {
    ...own,
    id: own.id ?? field?.id ?? fallbackId,
    name: own.name ?? field?.name,
    'aria-describedby': joinIds(field?.describedBy, own['aria-describedby']),
    'aria-invalid': invalid ? true : undefined,
    required: own.required ?? field?.required,
    disabled: own.disabled ?? field?.disabled,
    readOnly: own.readOnly ?? field?.readOnly,
  }
}

/**
 * Los controles con parseo propio (plata, fecha, hora, CUIT) avisan su error
 * local; el Field lo muestra en el mismo lugar que el del server. Afuera de un
 * Field no hace nada.
 */
function useFieldErrorReporter(): (message: string | null) => void {
  return React.useContext(FieldContext)?.reportError ?? noop
}

/** El id de la etiqueta del Field, para `aria-labelledby` en grupos (RadioCards, IconPicker). */
function useFieldLabelId(): string | undefined {
  return React.useContext(FieldContext)?.labelId
}

/**
 * Para los controles compuestos (CodeField, MoneyField, DatePicker…): el
 * `<input>` visible queda adentro de este scope y no se lleva el `name` del
 * Field, que va en el `<input type="hidden">` con el valor canónico. Sin esto
 * el FormData recibiría dos valores con el mismo nombre (lo tipeado y lo
 * canónico). Id, ayuda, error y required siguen llegando.
 */
function WithoutFieldName({ children }: { children: React.ReactNode }) {
  const field = React.useContext(FieldContext)
  const scoped = React.useMemo(() => (field ? { ...field, name: undefined } : null), [field])
  return <FieldContext.Provider value={scoped}>{children}</FieldContext.Provider>
}

/**
 * `form.reset()`: los controles compuestos (los que guardan el valor en un
 * `<input type="hidden">` o lo formatean) escuchan el `reset` del `<form>` y
 * vuelven a su `defaultValue`. `ref` es cualquier elemento adentro del form.
 */
function useFormReset(ref: React.RefObject<HTMLElement | null>, onReset: () => void) {
  const handleReset = React.useEffectEvent(onReset)
  React.useEffect(() => {
    const el = ref.current
    // Un input con `form="…"` puede vivir afuera del <form>: su `.form` lo sabe.
    const form = el instanceof HTMLInputElement ? el.form : (el?.closest('form') ?? null)
    if (!form) return
    const listener = () => handleReset()
    form.addEventListener('reset', listener)
    return () => form.removeEventListener('reset', listener)
  }, [ref])
}

/**
 * Después de la respuesta del server, enfoca el primer `[aria-invalid="true"]`
 * del formulario o, si no hay, el `FormError`. Va en el componente del form:
 * corre después de los efectos de sus hijos, así gana al foco del FormError.
 */
function useFocusFirstInvalid(formRef: React.RefObject<HTMLFormElement | null>, state: unknown) {
  React.useEffect(() => {
    if (state == null) return
    const form = formRef.current
    if (!form) return
    const target =
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      form.querySelector<HTMLElement>('[data-slot="form-error"]')
    target?.focus()
  }, [formRef, state])
}

export type FieldProps = Omit<React.ComponentProps<'div'>, 'children' | 'id'> & {
  label: React.ReactNode
  /** Llega al control; los compuestos lo ponen en su `<input type="hidden">`. */
  name?: string
  /** Id del control. Default `useId()`. */
  id?: string
  hint?: React.ReactNode
  /** Admite los `fieldErrors` de zod tal cual (se muestra el primero). */
  error?: string | readonly string[] | null
  /** « (opcional)» al lado de la etiqueta. Lo obligatorio no se marca. */
  optional?: boolean
  /** Atributo `required` en el control, sin marca visual. */
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
  /**
   * stack: etiqueta arriba · inline: a la izquierda desde md (ajustes) ·
   * toggle: etiqueta y descripción a la izquierda, switch o casilla a la
   * derecha, toda la fila clickeable.
   */
  layout?: FieldLayout
  /** Etiqueta solo para el lector (buscadores). */
  labelHidden?: boolean
  children: React.ReactNode | ((control: FieldControlProps) => React.ReactNode)
}

function FieldMessage({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p
      id={id}
      data-slot="field-error"
      className="flex items-start gap-1 type-caption text-destructive-text"
    >
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/**
 * Etiqueta, control, ayuda y error, cableados y accesibles (§3.2). Pensado
 * para Server Actions + `useActionState` + FormData; también sirve controlado.
 *
 * - Ids: `${id}-hint` y `${id}-error`, en `aria-describedby` en ese orden.
 * - El error del server llega por `error`; el local (plata ilegible, CUIT que
 *   no cierra) lo avisa el control con `useFieldErrorReporter` después del
 *   blur. Se muestra el local si hay, si no el del server.
 * - Espacios: etiqueta → control 8 px; control → ayuda o error 4 px.
 */
function Field({
  label,
  name,
  id: idProp,
  hint,
  error,
  optional = false,
  required,
  disabled,
  readOnly,
  layout = 'stack',
  labelHidden = false,
  className,
  children,
  ...props
}: FieldProps) {
  const autoId = React.useId()
  const id = idProp ?? autoId
  const labelId = `${id}-label`
  const [localError, setLocalError] = React.useState<string | null>(null)
  const message = localError ?? firstError(error)
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = message ? `${id}-error` : undefined
  const describedBy = joinIds(hintId, errorId)
  const invalid = message !== null

  const reportError = React.useCallback((next: string | null) => {
    setLocalError(next && next.trim() !== '' ? next : null)
  }, [])

  const context = React.useMemo<FieldContextValue>(
    () => ({
      id,
      labelId,
      name,
      describedBy,
      invalid,
      required,
      disabled,
      readOnly,
      layout,
      reportError,
    }),
    [id, labelId, name, describedBy, invalid, required, disabled, readOnly, layout, reportError],
  )

  const control =
    typeof children === 'function'
      ? children({
          id,
          name,
          'aria-describedby': describedBy,
          'aria-invalid': invalid ? true : undefined,
          required,
          disabled,
          readOnly,
        })
      : children

  const labelNode = (
    <Label
      id={labelId}
      htmlFor={id}
      optional={optional}
      className={cn(
        labelHidden && 'sr-only',
        layout === 'inline' && 'md:min-h-(--control-md)',
        // Toggle: la etiqueta tapa la fila entera con su ::after, así un toque en
        // la descripción o en el aire también cambia el switch (htmlFor). El
        // control va encima (es relative y viene después) y recibe su toque.
        layout === 'toggle' && 'after:absolute after:inset-0',
      )}
    >
      {label}
    </Label>
  )
  const hintNode = hint ? (
    <p
      id={hintId}
      data-slot="field-hint"
      className="type-caption text-pretty text-subtle-foreground"
    >
      {hint}
    </p>
  ) : null
  const errorNode = message && errorId ? <FieldMessage id={errorId}>{message}</FieldMessage> : null

  const rootProps = {
    'data-slot': 'field',
    'data-layout': layout,
    'data-invalid': invalid ? 'true' : undefined,
    'data-disabled': disabled ? 'true' : undefined,
    ...props,
  }

  let body: React.ReactNode
  if (layout === 'toggle') {
    body = (
      <div
        {...rootProps}
        className={cn(
          'group/field relative flex min-h-11 items-center justify-between gap-4',
          className,
        )}
      >
        <div className="grid min-w-0 gap-0.5">
          {labelNode}
          {hintNode}
          {errorNode}
        </div>
        <div data-slot="field-control" className="relative flex shrink-0 items-center">
          {control}
        </div>
      </div>
    )
  } else {
    body = (
      <div
        {...rootProps}
        className={cn(
          'group/field grid gap-2',
          layout === 'inline' &&
            'md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-start md:gap-x-6',
          className,
        )}
      >
        {labelNode}
        <div data-slot="field-body" className="grid min-w-0 gap-1">
          {control}
          {hintNode}
          {errorNode}
        </div>
      </div>
    )
  }

  return <FieldContext.Provider value={context}>{body}</FieldContext.Provider>
}

export type FieldRowProps = React.ComponentProps<'div'> & {
  /** Pares cortos: punto de venta + número, desde + hasta. Una columna en el celular. */
  columns?: 2 | 3
}

function FieldRow({ columns = 2, className, ...props }: FieldRowProps) {
  return (
    <div
      data-slot="field-row"
      className={cn(
        'grid items-start gap-4',
        columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        className,
      )}
      {...props}
    />
  )
}

export type FormSectionProps = Omit<React.ComponentProps<'section'>, 'title'> & {
  title?: React.ReactNode
  description?: React.ReactNode
}

/**
 * Un bloque del formulario: título en `type-subtitle`, descripción en
 * `type-small`, campos a 16 px. Dos secciones seguidas se separan con un pelo
 * y 24 px de cada lado.
 */
function FormSection({ title, description, className, children, ...props }: FormSectionProps) {
  const headingId = React.useId()
  return (
    <section
      data-slot="form-section"
      aria-labelledby={title ? headingId : undefined}
      className={cn(
        'grid gap-4',
        '[[data-slot=form-section]+&]:mt-6 [[data-slot=form-section]+&]:border-t [[data-slot=form-section]+&]:border-border [[data-slot=form-section]+&]:pt-6',
        className,
      )}
      {...props}
    >
      {title || description ? (
        <div className="grid gap-1">
          {title ? (
            <h2 id={headingId} className="type-subtitle text-foreground">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="max-w-prose type-small text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export type FormErrorProps = Omit<React.ComponentProps<'div'>, 'title' | 'children'> & {
  message?: string | null
  title?: React.ReactNode
}

/**
 * El error general de un envío (§3.2): un `Callout tone="danger"
 * announce="assertive"` (fondo suave de peligro, ícono, `role="alert"`) que
 * recibe el foco cuando aparece (`tabIndex={-1}`). Sin mensaje no dibuja nada.
 */
function FormError({ message, title, className, ...props }: FormErrorProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (message) ref.current?.focus()
  }, [message])

  if (!message) return null
  return (
    <Callout
      ref={ref}
      tone="danger"
      announce="assertive"
      title={title}
      tabIndex={-1}
      data-slot="form-error"
      className={cn('outline-offset-2 outline-(--ring) focus-visible:outline-2', className)}
      {...props}
    >
      {message}
    </Callout>
  )
}

// La barra de acciones (§3.2) tiene una sola implementación, en
// `form-actions.tsx` (con el foco al primer error); acá se re-exporta para el
// import del spec. El import va en un solo sentido (field → form-actions): no
// arma ciclo.
export { FormActions, type FormActionsProps } from '@/components/ui/form-actions'
// El spec la ubica acá (§3.2, MoneyField punto 8). Vive en lib/dom porque es
// DOM puro y la usan campos que no pasan por Field; esto deja andando el import
// del spec (`@/components/ui/field`).
export { scrollIntoViewOnTouch } from '@/lib/dom/form-control'
export {
  Field,
  FieldRow,
  FormError,
  FormSection,
  useField,
  useFieldControl,
  useFieldErrorReporter,
  useFieldLabelId,
  useFocusFirstInvalid,
  useFormReset,
  WithoutFieldName,
}
