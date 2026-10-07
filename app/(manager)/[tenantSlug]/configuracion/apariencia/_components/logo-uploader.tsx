'use client'

import { Trash2, Upload } from 'lucide-react'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { deleteTenantLogoAction, uploadTenantLogoAction } from '@/lib/tenant/logo-actions'
import { cn } from '@/lib/utils'

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/svg+xml'
const MAX_BYTES = 2 * 1024 * 1024

export function LogoUploader({
  tenantSlug,
  tenantName,
  initialLogoUrl,
}: {
  tenantSlug: string
  tenantName: string
  initialLogoUrl: string | null
}) {
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
  const [uploading, startUpload] = useTransition()
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const initial = tenantName.charAt(0).toUpperCase()

  const handleFile = (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error('Pesa más de 2 MB. Comprimila o achicala y probá de nuevo.')
      return
    }
    startUpload(async () => {
      const fd = new FormData()
      fd.append('logo', file)
      const result = await uploadTenantLogoAction(tenantSlug, fd)
      if (result.ok) {
        setLogoUrl(result.logoUrl)
        toast.success('Logo actualizado.')
      } else {
        toast.error(result.message)
      }
    })
  }

  // Borra el archivo del logo: espera con el diálogo abierto y, si falla, el
  // error queda adentro.
  const handleDelete = async (): Promise<ConfirmResult> => {
    if (!logoUrl) return
    const result = await deleteTenantLogoAction(tenantSlug)
    if (!result.ok) return { ok: false, error: result.message }
    setLogoUrl(null)
    toast.success('Quitamos el logo.')
  }

  return (
    <div className="flex flex-col gap-3">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handlers son augment al botón "Subir logo" — el flujo accesible está cubierto por el input file + button */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file) handleFile(file)
        }}
        className={cn(
          'flex items-center gap-4 rounded-xl border border-dashed p-4 transition-colors duration-(--duration-quick)',
          dragOver ? 'border-primary bg-selected' : 'border-border-strong bg-card',
        )}
      >
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
          {logoUrl ? (
            // biome-ignore lint/performance/noImgElement: preview de upload, URL externa con cache-buster
            <img src={logoUrl} alt="Logo del bar" className="size-full object-contain" />
          ) : (
            <span aria-hidden className="font-display text-3xl font-semibold text-primary">
              {initial}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="type-label text-foreground">
            {logoUrl ? 'Logo cargado' : 'Sin logo todavía'}
          </p>
          <p className="text-pretty type-small text-muted-foreground">
            Arrastrá una imagen acá o tocá{' '}
            <strong>{logoUrl ? 'Cambiar logo' : 'Subir logo'}</strong>. PNG con fondo transparente,
            de 256 × 256 px o más y hasta 2&nbsp;MB.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          loading={uploading}
          loadingText="Subiendo…"
        >
          <Upload aria-hidden />
          {logoUrl ? 'Cambiar logo' : 'Subir logo'}
        </Button>
        {logoUrl ? (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="danger-ghost" disabled={uploading}>
                <Trash2 aria-hidden />
                Quitar logo
              </Button>
            }
            title="¿Quitar el logo?"
            description="Borramos la imagen. En el panel, la carta y los emails vuelve a aparecer el wordmark HUB! hasta que subas otro."
            confirmLabel="Quitar logo"
            pendingLabel="Quitando…"
            tone="danger"
            onConfirm={handleDelete}
          />
        ) : null}
      </div>
    </div>
  )
}
