'use client'

import { PlusIcon } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { MetaActionState } from '@/lib/meta/actions'
import { createTemplateAction } from '@/lib/meta/template-actions'
import { TEMPLATE_CATEGORIES } from '@/lib/meta/template-schemas'

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidad',
  AUTHENTICATION: 'Autenticación',
}

const initial: MetaActionState = { ok: true }

export function CreateTemplateDialog({
  tenantSlug,
  channelId,
}: {
  tenantSlug: string
  channelId: string
}) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<string>('')
  const formRef = useRef<HTMLFormElement>(null)

  const boundAction = createTemplateAction.bind(null, tenantSlug)
  const [state, action, pending] = useActionState(boundAction, initial)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      setOpen(false)
      formRef.current?.reset()
      setCategory('')
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <PlusIcon className="size-4" />
          Nueva plantilla
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva plantilla de WhatsApp</DialogTitle>
          <DialogDescription>
            Completá los campos y enviá a revisión de Meta. La plantilla aparecerá como{' '}
            <strong>Pendiente</strong> hasta que Meta la apruebe (normalmente 24&ndash;48 h).
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={action} className="grid gap-4">
          {/* Hidden channel_id not needed for create — resolved server-side by tenantSlug */}
          <input type="hidden" name="channel_id" value={channelId} />

          <div className="grid gap-1.5">
            <Label htmlFor="tmpl-name">
              Nombre <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tmpl-name"
              name="name"
              placeholder="ej. bienvenida_nuevo_cliente"
              required
              pattern="^[a-z0-9_]+$"
              title="Solo letras minúsculas, números y guiones bajos"
              autoComplete="off"
            />
            <p className="text-muted-foreground text-xs">
              Solo minúsculas, números y guiones bajos. Sin espacios.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="tmpl-category">
                Categoría <span className="text-destructive">*</span>
              </Label>
              <Select name="category" value={category} onValueChange={setCategory} required>
                <SelectTrigger id="tmpl-category" className="w-full">
                  <SelectValue placeholder="Seleccioná…" />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORY_LABELS[cat] ?? cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="tmpl-language">
                Idioma <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tmpl-language"
                name="language"
                defaultValue="es"
                placeholder="ej. es, es_AR, en_US"
                required
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tmpl-header">Encabezado (opcional)</Label>
            <Input
              id="tmpl-header"
              name="headerText"
              placeholder="ej. ¡Hola, {{1}}!"
              maxLength={60}
            />
            <p className="text-muted-foreground text-xs">Máximo 60 caracteres.</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tmpl-body">
              Cuerpo del mensaje <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="tmpl-body"
              name="bodyText"
              placeholder="ej. Hola {{1}}, tu reserva para el {{2}} está confirmada."
              required
              maxLength={1024}
              className="min-h-24 resize-y"
            />
            <p className="text-muted-foreground text-xs">
              Usá <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>… para variables. Máximo 1024
              caracteres.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tmpl-footer">Pie (opcional)</Label>
            <Input
              id="tmpl-footer"
              name="footerText"
              placeholder="ej. Responder STOP para darse de baja"
              maxLength={60}
            />
            <p className="text-muted-foreground text-xs">Máximo 60 caracteres.</p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !category}>
              {pending ? 'Enviando a Meta…' : 'Enviar a revisión'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
