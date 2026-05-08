'use client'

import { Loader2, Trash2, Upload } from 'lucide-react'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { deleteTenantLogoAction, uploadTenantLogoAction } from '@/lib/tenant/logo-actions'

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
  const [pending, startTransition] = useTransition()
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const initial = tenantName.charAt(0).toUpperCase()

  const handleFile = (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error('Máximo 2 MB. Comprimí o reducí el tamaño.')
      return
    }
    startTransition(async () => {
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

  const handleDelete = () => {
    if (!logoUrl) return
    startTransition(async () => {
      const result = await deleteTenantLogoAction(tenantSlug)
      if (result.ok) {
        setLogoUrl(null)
        toast.success('Logo eliminado.')
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handlers son augment al botón "Subir archivo" — el flujo accesible está cubierto por el input file + button */}
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
        className={`flex items-center gap-4 rounded-xl border-2 border-dashed p-4 transition-colors ${
          dragOver ? 'border-primary bg-[--cream-tint]' : 'border-border/70 bg-background/40'
        }`}
      >
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-card">
          {logoUrl ? (
            // biome-ignore lint/performance/noImgElement: preview de upload, URL externa con cache-buster
            <img src={logoUrl} alt="Logo del bar" className="size-full object-contain" />
          ) : (
            <span className="font-serif text-3xl font-semibold text-primary">{initial}</span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">{logoUrl ? 'Logo cargado' : 'Sin logo todavía'}</p>
          <p className="text-xs text-muted-foreground">
            Arrastrá una imagen acá o tocá <strong>Subir archivo</strong>. PNG transparente
            recomendado, mínimo 256×256, máx. 2&nbsp;MB.
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
          disabled={pending}
          size="sm"
          className="gap-2"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {logoUrl ? 'Cambiar logo' : 'Subir logo'}
        </Button>
        {logoUrl ? (
          <Button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            size="sm"
            variant="outline"
            className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
            Quitar
          </Button>
        ) : null}
      </div>
    </div>
  )
}
