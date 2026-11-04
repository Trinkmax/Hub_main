'use client'

import { Camera, Check, FileUp, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { readyFile } from '@/components/administracion/adjuntos/ready-file'
import { buttonVariants } from '@/components/ui/button'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_BUCKET,
  ATTACHMENT_MESSAGES,
  attachmentFileName,
} from '@/lib/accounting/attachments'
import { createClient } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'

type Slot = { path: string; token: string }

type Step =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; preview: string | null }
  | { kind: 'error'; message: string }
  | { kind: 'expired' }

const addedSchema = z.object({ ok: z.boolean() })

/** Ya estaba subido (el aviso anterior se perdió): se sigue como si nada. */
function alreadyThere(error: { message?: string; statusCode?: string }): boolean {
  return error.statusCode === '409' || /exists|duplicate/i.test(error.message ?? '')
}

/** Saca la foto, la achica, la sube a su URL firmada y le avisa a la compu. */
async function send(
  file: File,
  slot: Slot,
  token: string,
): Promise<{ ok: true } | { ok: false; message: string; expired?: boolean }> {
  const ready = await readyFile(file)
  if ('message' in ready) return { ok: false, message: ready.message }

  const supabase = createClient()
  try {
    const sent = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .uploadToSignedUrl(slot.path, slot.token, ready.blob, { contentType: ready.mimeType })
    if (sent.error && !alreadyThere(sent.error)) {
      return { ok: false, message: ATTACHMENT_MESSAGES.upload }
    }
    const added = await supabase.rpc('acc_upload_link_add', {
      p_token: token,
      p_path: slot.path,
      p_file_name: attachmentFileName(file.name, ready.mimeType),
      p_mime_type: ready.mimeType,
      p_size_bytes: ready.blob.size,
    })
    if (added.error) return { ok: false, message: ATTACHMENT_MESSAGES.upload }
    const parsed = addedSchema.safeParse(added.data)
    if (!parsed.success || !parsed.data.ok) {
      return { ok: false, message: 'Este QR ya venció.', expired: true }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: ATTACHMENT_MESSAGES.offline }
  }
}

/** Una opción grande: un `<label>` con su `<input type="file">` adentro. */
function PickFile({
  capture = false,
  disabled,
  primary,
  onFile,
  children,
}: {
  capture?: boolean
  disabled: boolean
  primary: boolean
  onFile: (file: File) => void
  children: ReactNode
}) {
  return (
    <label className={cn('relative block', disabled && 'pointer-events-none opacity-60')}>
      <input
        type="file"
        accept={ATTACHMENT_ACCEPT}
        capture={capture ? 'environment' : undefined}
        disabled={disabled}
        className="peer sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          // Para poder sacar otra sin que el navegador crea que es la misma.
          event.currentTarget.value = ''
          if (file) onFile(file)
        }}
      />
      <span
        className={cn(
          buttonVariants({ variant: primary ? 'default' : 'outline' }),
          'w-full cursor-pointer gap-3 rounded-2xl peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
          primary ? 'h-20 text-lg' : 'h-13 text-base',
        )}
      >
        {children}
      </span>
    </label>
  )
}

export function SubirClient({
  token,
  tenantName,
  slots: initialSlots,
  uploaded,
}: {
  token: string
  tenantName: string
  slots: readonly Slot[]
  /** Las que ya había subido este link (se volvió a abrir el QR). */
  uploaded: number
}) {
  const [slots, setSlots] = useState<readonly Slot[]>(initialSlots)
  const [count, setCount] = useState(uploaded)
  const [step, setStep] = useState<Step>({ kind: 'idle' })

  const preview = step.kind === 'done' ? step.preview : null
  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const upload = async (file: File) => {
    const slot = slots[0]
    if (!slot) return
    setStep({ kind: 'working' })
    const result = await send(file, slot, token)
    if (!result.ok) {
      setStep(result.expired ? { kind: 'expired' } : { kind: 'error', message: result.message })
      return
    }
    setSlots((prev) => prev.filter((other) => other.path !== slot.path))
    setCount((n) => n + 1)
    const drawable = file.type.startsWith('image/') && !/hei[cf]/i.test(file.type)
    setStep({ kind: 'done', preview: drawable ? URL.createObjectURL(file) : null })
  }

  if (step.kind === 'expired') {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-sm content-center gap-2 px-6 py-10 text-center">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Este QR ya venció</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Abrí el formulario en la compu de nuevo y escaneá el QR nuevo.
        </p>
      </main>
    )
  }

  const working = step.kind === 'working'
  const done = step.kind === 'done'
  const noRoom = slots.length === 0

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-sm content-center gap-6 px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="text-center">
        <p className="text-sm text-muted-foreground">{tenantName}</p>
        {done ? (
          <>
            <span className="mx-auto mt-3 flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
              <Check className="size-6" aria-hidden />
            </span>
            <h1 role="status" className="mt-3 font-serif text-2xl font-semibold tracking-tight">
              Listo. Ya apareció en la compu
            </h1>
            {count > 1 ? (
              <p className="mt-1 text-sm text-muted-foreground">Llevás {count} fotos.</p>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight">
              Sacale la foto al comprobante
            </h1>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              Poné la factura adentro del recuadro. Que se vea entera y derecha.
            </p>
          </>
        )}
      </header>

      {preview ? (
        // biome-ignore lint/performance/noImgElement: un blob local: next/image no aplica
        <img
          src={preview}
          alt=""
          className="adm-land mx-auto max-h-56 w-auto rounded-md border border-border object-contain shadow-[0_8px_18px_rgb(0_0_0/0.16)]"
        />
      ) : null}

      {noRoom ? (
        <p className="text-center text-sm text-muted-foreground text-pretty">
          Ya subiste todas las que entran acá. Si falta alguna, sumala desde el comprobante.
        </p>
      ) : (
        <div className="grid gap-3">
          <PickFile capture primary disabled={working} onFile={(file) => void upload(file)}>
            {working ? (
              <Loader2 className="size-6 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Camera className="size-6" aria-hidden />
            )}
            {working ? 'Subiendo…' : done ? 'Sacar otra' : 'Sacar la foto'}
          </PickFile>
          <PickFile primary={false} disabled={working} onFile={(file) => void upload(file)}>
            <FileUp className="size-5" aria-hidden />
            Elegir un archivo
          </PickFile>
        </div>
      )}

      {step.kind === 'error' ? (
        <p role="alert" className="text-center text-sm text-destructive text-pretty">
          {step.message}
        </p>
      ) : null}
    </main>
  )
}
