'use client'

import { Download, FileCheck, FileUp, KeyRound, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { type DragEvent, useId, useState } from 'react'
import {
  CERT_PRECHECK_MESSAGES,
  precheckCertFile,
  textToBase64,
} from '@/components/administracion/guias/arca-guide-model'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { downloadArcaCsr, startArcaCertificate, uploadArcaCertificate } from '@/lib/arca/actions'
import type { ArcaEnvironment } from '@/lib/arca/endpoints'
import { ALIAS_MESSAGE, CERT_FILE_MAX_BYTES } from '@/lib/arca/schemas'
import type { ArcaCertificateResult, ArcaConnectionView } from '@/lib/arca/views'
import { formatDate } from '@/lib/dates'
import { formatCuit, isValidCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import {
  ArcaFailureNotice,
  downloadTextFile,
  failureKey,
  useArcaRun,
  useFocusWhen,
} from './arca-shared'
import { describedBy, Field } from './form-bits'
import { CuitInput, INPUT_CLASS } from './inputs'

// ─── Paso 5: el pedido (.csr) ────────────────────────────────────────────────

function cleanAlias(text: string): string {
  return text.trim().toLowerCase()
}

function aliasIssue(text: string): string | null {
  return /^[a-z0-9]{3,30}$/.test(cleanAlias(text)) ? null : ALIAS_MESSAGE
}

const HOMO_CUIT_HINT =
  'Tu CUIT personal: en las pruebas (WSASS) el certificado sale a nombre de quien lo genera.'

/**
 * «Qué te traés» del paso 5: generar el pedido (.csr) con el alias, bajarlo, copiar el alias, y
 * «Descargar de nuevo» (es el mismo pedido) o «Empezar de cero» (con confirmación: el pedido
 * anterior deja de servir y, si ya había certificado, también él). La clave nunca viaja: al
 * navegador vuelve solo el pedido, que es público.
 */
export function ArcaCsrAction({
  slug,
  environment,
  connection,
  suggestedAlias,
  guideHref,
  showPem = false,
}: {
  slug: string
  environment: ArcaEnvironment
  connection: ArcaConnectionView | null
  suggestedAlias: string
  guideHref?: string
  /** «Ver el texto del pedido» para copiarlo (WSASS pide pegarlo, en homologación). */
  showPem?: boolean
}) {
  const pemId = useId()
  const [pem, setPem] = useState<string | null>(null)
  const aliasId = useId()
  const cuitId = useId()
  const hasCsr = Boolean(connection?.hasCsr) && connection?.status !== 'disconnected'
  const hasCertificate = Boolean(connection?.certificate)
  const homo = environment === 'homologacion'
  const [alias, setAlias] = useState(
    hasCsr && connection?.alias ? connection.alias : suggestedAlias,
  )
  const [certCuit, setCertCuit] = useState(
    homo && connection?.certCuit ? formatCuit(connection.certCuit) : '',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const [fresh, setFresh] = useState<{ alias: string; fileName: string; csrPem: string } | null>(
    null,
  )
  const [restartOpen, setRestartOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const { pending, run } = useArcaRun()
  const freshRef = useFocusWhen<HTMLDivElement>(fresh)

  const ready = fresh !== null || hasCsr
  const shownAlias = fresh?.alias ?? connection?.alias ?? alias
  const fileName = fresh?.fileName ?? connection?.csrFileName ?? `arca-${shownAlias}.csr`

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    const issue = aliasIssue(alias)
    if (issue) next.alias = issue
    if (homo && !isValidCuit(certCuit)) next.certCuit = 'Poné tu CUIT personal (11 números).'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const generate = (mode: 'new' | 'replace') => {
    setFailure(null)
    if (!validate()) return
    run(
      () =>
        startArcaCertificate(slug, {
          environment,
          alias: cleanAlias(alias),
          certCuit: homo ? certCuit : null,
          mode,
        }),
      {
        onSuccess: (data) => {
          setFresh({ alias: data.alias, fileName: data.fileName, csrPem: data.csrPem })
          setRestartOpen(false)
          setReplaceOpen(false)
          downloadTextFile(data.fileName, data.csrPem)
        },
        onFailure: (f) => {
          if (failureKey(f) === 'arca_key_replace_requires_confirm') {
            setRestartOpen(false)
            setReplaceOpen(true)
            return
          }
          if (f.fieldErrors && Object.keys(f.fieldErrors).length > 0) {
            setErrors(f.fieldErrors)
            return
          }
          setFailure(f)
        },
      },
    )
  }

  const revealPem = () => {
    if (fresh) {
      setPem(fresh.csrPem)
      return
    }
    setFailure(null)
    run(() => downloadArcaCsr(slug, { environment }), {
      quiet: true,
      onSuccess: (data) => setPem(data.csrPem),
      onFailure: setFailure,
    })
  }

  const downloadAgain = () => {
    if (fresh) {
      downloadTextFile(fresh.fileName, fresh.csrPem)
      return
    }
    setFailure(null)
    run(() => downloadArcaCsr(slug, { environment }), {
      quiet: true,
      onSuccess: (data) => downloadTextFile(data.fileName, data.csrPem),
      onFailure: setFailure,
    })
  }

  const fields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        id={aliasId}
        label="Alias del certificado"
        hint="El nombre que va a tener en ARCA. Solo letras y números, sin espacios."
        error={errors.alias}
      >
        <Input
          id={aliasId}
          value={alias}
          autoComplete="off"
          spellCheck={false}
          maxLength={30}
          aria-invalid={errors.alias ? true : undefined}
          aria-describedby={describedBy(aliasId, true, errors.alias)}
          onChange={(event) => {
            setAlias(event.target.value.replace(/\s+/g, ''))
            setErrors((prev) => ({ ...prev, alias: '' }))
          }}
          className={cn(INPUT_CLASS, 'font-mono')}
        />
      </Field>
      {homo ? (
        <Field id={cuitId} label="Tu CUIT personal" hint={HOMO_CUIT_HINT} error={errors.certCuit}>
          <CuitInput
            id={cuitId}
            value={certCuit}
            onChange={(text) => {
              setCertCuit(text)
              setErrors((prev) => ({ ...prev, certCuit: '' }))
            }}
            invalid={Boolean(errors.certCuit)}
            describedBy={describedBy(cuitId, true, errors.certCuit)}
          />
        </Field>
      ) : null}
    </div>
  )

  return (
    <div className="space-y-3">
      {ready ? (
        <div
          ref={freshRef}
          tabIndex={-1}
          aria-live="polite"
          className="space-y-3 rounded-lg border border-success/30 bg-success/10 p-4 outline-none"
        >
          <div className="flex items-start gap-3">
            <FileCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-success">
                {fresh ? 'Listo: tu pedido está listo y se bajó.' : 'Ya generaste el pedido.'}
              </p>
              <p className="text-sm text-muted-foreground text-pretty">
                Es el archivo <span className="font-mono text-foreground">{fileName}</span>. No es
                secreto: es un pedido. La clave queda guardada en la plataforma y nunca sale de acá.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Alias (lo vas a escribir en ARCA)</p>
              <p className="truncate font-mono text-base font-medium">{shownAlias}</p>
            </div>
            <CopyButton
              value={shownAlias}
              label="Copiar el alias"
              copiedLabel="Alias copiado"
              className="h-11 md:h-9"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="h-11 gap-2 md:h-9"
              onClick={downloadAgain}
              disabled={pending}
            >
              <Download className="size-4" aria-hidden />
              {fresh ? `Descargar ${fileName}` : 'Descargar de nuevo'}
            </Button>
            {showPem && pem === null ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 md:h-9"
                onClick={revealPem}
                disabled={pending}
              >
                Ver el texto del pedido
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="h-11 gap-2 text-muted-foreground md:h-9"
              onClick={() => setRestartOpen(true)}
              disabled={pending}
            >
              <RotateCcw className="size-4" aria-hidden />
              Empezar de cero
            </Button>
          </div>
          {showPem && pem !== null ? (
            <div className="space-y-2">
              <Label htmlFor={pemId} className="text-xs text-muted-foreground">
                El texto del pedido (para pegar en WSASS)
              </Label>
              <Textarea
                id={pemId}
                readOnly
                value={pem}
                rows={6}
                spellCheck={false}
                className="font-mono text-[11px]"
              />
              <CopyButton
                value={pem}
                label="Copiar el pedido"
                copiedLabel="Pedido copiado"
                className="h-11 md:h-9"
              />
            </div>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            generate('new')
          }}
        >
          {fields}
          <Button type="submit" className="h-11 w-full gap-2 sm:w-auto md:h-10" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <KeyRound className="size-4" aria-hidden />
            )}
            {pending ? 'Generando…' : 'Generar el pedido y bajarlo'}
          </Button>
        </form>
      )}

      <ArcaFailureNotice failure={failure} slug={slug} guideHref={guideHref} />

      <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Empezar de cero con otro pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasCertificate
                ? 'El certificado que subiste deja de servir y la emisión de facturas se apaga. Vas a tener que repetir los pasos 6 a 9 con el pedido nuevo.'
                : 'El pedido que bajaste antes deja de servir. Si ya lo subiste a ARCA, hacé el paso 6 de nuevo con el pedido nuevo.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {fields}
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                'h-11 md:h-9',
                hasCertificate &&
                  'bg-destructive text-destructive-foreground hover:bg-destructive/90',
              )}
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                generate(hasCertificate ? 'replace' : 'new')
              }}
            >
              {pending ? 'Generando…' : 'Generar uno nuevo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ya hay un certificado cargado</AlertDialogTitle>
            <AlertDialogDescription>
              Si generás otro pedido, el certificado actual deja de servir y la emisión de facturas
              se apaga hasta que subas el nuevo y vuelvas a probar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 md:h-9"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                generate('replace')
              }}
            >
              {pending ? 'Generando…' : 'Reemplazar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Paso 6: el certificado (.crt) ───────────────────────────────────────────

function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    } catch {
      resolve(null)
    }
  })
}

async function readHead(file: File): Promise<string | null> {
  if (file.size <= 0 || file.size > CERT_FILE_MAX_BYTES) return null
  try {
    return await file.slice(0, 4096).text()
  } catch {
    return null
  }
}

/**
 * «Qué te traés» del paso 6: la zona para soltar el .crt (o elegirlo con el botón, que anda con
 * el teclado). Antes de mandarlo se mira el tamaño y el encabezado: el pedido (.csr), una clave
 * privada o un .p12 no salen de la compu. Con el certificado válido muestra hasta cuándo vale.
 */
export function ArcaCertUpload({
  slug,
  environment,
  connection,
  allowPaste = false,
  guideHref,
  title = 'Subí el certificado (.crt) que bajaste de ARCA',
}: {
  slug: string
  environment: ArcaEnvironment
  connection: ArcaConnectionView | null
  /** Pegar el texto del certificado (WSASS lo muestra en pantalla, en homologación). */
  allowPaste?: boolean
  guideHref?: string
  title?: string
}) {
  const inputId = useId()
  const pasteId = useId()
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const [result, setResult] = useState<ArcaCertificateResult | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [paste, setPaste] = useState('')
  const { pending, run } = useArcaRun()
  const resultRef = useFocusWhen<HTMLDivElement>(result)
  const errorRef = useFocusWhen<HTMLParagraphElement>(error)
  const busy = pending || reading

  const upload = (fileBase64: string) => {
    run(
      () =>
        uploadArcaCertificate(slug, {
          environment,
          fileBase64,
          expectedUpdatedAt: connection?.updatedAt || null,
        }),
      {
        onSuccess: (data) => setResult(data),
        onFailure: (f) => {
          const field = f.fieldErrors?.fileBase64
          if (field) setError(field)
          else setFailure(f)
        },
      },
    )
  }

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return
    setError(null)
    setFailure(null)
    setResult(null)
    setFileName(file.name)
    setReading(true)
    const head = await readHead(file)
    const check = precheckCertFile({ name: file.name, size: file.size, headText: head })
    if (!check.ok) {
      setReading(false)
      setError(check.message)
      return
    }
    const dataUrl = await readAsDataUrl(file)
    setReading(false)
    if (!dataUrl) {
      setError(CERT_PRECHECK_MESSAGES.unreadable)
      return
    }
    upload(dataUrl)
  }

  const submitPaste = () => {
    setError(null)
    setFailure(null)
    setResult(null)
    setFileName(null)
    const text = paste.trim()
    const bytes = new TextEncoder().encode(text).length
    const check = precheckCertFile({ name: 'certificado.crt', size: bytes, headText: text })
    if (!check.ok) {
      setError(check.message)
      return
    }
    if (!text.includes('-----BEGIN CERTIFICATE-----')) {
      setError(CERT_PRECHECK_MESSAGES.unreadable)
      return
    }
    upload(textToBase64(text))
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void handleFile(event.dataTransfer.files[0])
  }

  return (
    <div className="space-y-3">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: soltar el archivo es un atajo; el botón de adentro hace lo mismo con teclado. */}
      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!dragging) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors motion-reduce:transition-none',
          dragging ? 'border-primary bg-primary/5' : 'border-border/80 bg-background/40',
          error && 'border-destructive/50',
        )}
      >
        <span className="mb-3 flex size-11 items-center justify-center rounded-full border border-primary/20 bg-cream-tint text-primary">
          {busy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <FileUp className="size-5" aria-hidden />
          )}
        </span>
        <p className="text-sm font-medium">{busy ? 'Revisando el certificado…' : title}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground text-pretty">
          Arrastralo acá o elegilo de tu compu. Es el archivo que bajaste con el ícono «Descargar»
          (termina en .crt).
        </p>
        <label className="mt-4">
          <input
            id={inputId}
            type="file"
            accept=".crt,.cer,.pem,application/x-x509-ca-cert,application/pkix-cert"
            className="peer sr-only"
            disabled={busy}
            onChange={(event) => {
              void handleFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <span className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-2xs transition-colors hover:bg-cream-tint peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 md:h-9">
            <FileUp className="size-4" aria-hidden />
            Elegir el archivo
          </span>
        </label>
        {fileName && !busy ? (
          <p className="mt-2 max-w-full truncate text-xs text-muted-foreground">
            Elegiste: <span className="font-mono">{fileName}</span>
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive outline-none text-pretty"
        >
          {error}
        </p>
      ) : null}

      {allowPaste ? (
        <div className="space-y-2">
          <Label htmlFor={pasteId} className="text-sm">
            O pegá el texto del certificado{' '}
            <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id={pasteId}
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            rows={4}
            spellCheck={false}
            placeholder="-----BEGIN CERTIFICATE-----"
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            disabled={busy || paste.trim() === ''}
            onClick={submitPaste}
          >
            Usar este texto
          </Button>
        </div>
      ) : null}

      <div aria-live="polite">
        {result ? (
          <div
            ref={resultRef}
            tabIndex={-1}
            className="space-y-1.5 rounded-lg border border-success/30 bg-success/10 p-4 text-sm outline-none"
          >
            <p className="font-medium text-success">
              Listo: certificado válido hasta el {formatDate(result.notAfter)}.
            </p>
            <p className="text-muted-foreground text-pretty">
              Es de la CUIT {formatCuit(result.subjectCuit)}
              {result.subjectCn ? `, alias «${result.subjectCn}»` : ''}.
              {result.renewal ? ' La renovación quedó hecha: ya usamos el certificado nuevo.' : ''}
            </p>
            {result.warnings.map((w) => (
              <p key={w} className="text-warning-text text-pretty">
                {w}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <ArcaFailureNotice failure={failure} slug={slug} guideHref={guideHref} />
    </div>
  )
}

// ─── Renovar el certificado ──────────────────────────────────────────────────

/**
 * «Renovar el certificado» (cada 2 años): un pedido nuevo con el mismo alias, mientras la
 * conexión sigue andando con el certificado actual; después se sube el .crt nuevo y reemplaza
 * al vigente. Con el mismo alias no hace falta volver a autorizar los servicios.
 */
export function ArcaRenewAction({
  slug,
  connection,
  guideHref,
}: {
  slug: string
  connection: ArcaConnectionView
  guideHref?: string
}) {
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const { pending, run } = useArcaRun()
  const pendingRenewal = connection.renewalPending

  const start = () => {
    setFailure(null)
    run(
      () =>
        startArcaCertificate(slug, {
          environment: connection.environment,
          alias: connection.alias,
          mode: 'renew',
        }),
      {
        onSuccess: (data) => downloadTextFile(data.fileName, data.csrPem),
        onFailure: setFailure,
      },
    )
  }

  const downloadPending = () => {
    setFailure(null)
    run(() => downloadArcaCsr(slug, { environment: connection.environment, pending: true }), {
      quiet: true,
      onSuccess: (data) => downloadTextFile(data.fileName, data.csrPem),
      onFailure: setFailure,
    })
  }

  return (
    <div className="space-y-4">
      {pendingRenewal ? (
        <>
          <p className="text-sm text-pretty">
            Hay una renovación en curso: el pedido nuevo ya está generado. Mientras tanto la
            conexión sigue andando con el certificado actual.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full gap-2 sm:w-auto md:h-9"
            onClick={downloadPending}
            disabled={pending}
          >
            <Download className="size-4" aria-hidden />
            Descargar el pedido de renovación
          </Button>
          <ArcaCertUpload
            slug={slug}
            environment={connection.environment}
            connection={connection}
            guideHref={guideHref}
            title="Subí el certificado nuevo (.crt)"
          />
        </>
      ) : (
        <Button
          type="button"
          className="h-11 w-full gap-2 sm:w-auto md:h-9"
          onClick={start}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          {pending ? 'Generando…' : 'Generar el pedido para renovar'}
        </Button>
      )}
      <ArcaFailureNotice failure={failure} slug={slug} guideHref={guideHref} />
    </div>
  )
}
