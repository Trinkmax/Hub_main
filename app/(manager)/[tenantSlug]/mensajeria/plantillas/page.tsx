import { format } from 'date-fns'
import { MessageSquareText, Plug } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import type { TemplateStatus } from '@/types/database'
import { CreateTemplateDialog } from './_create-template-dialog'
import { DeleteTemplateButton } from './_delete-template-button'
import { TemplateSyncButton } from './_sync-button'
import {
  categoryLabel,
  humanizeTemplateName,
  languageLabel,
  STATUS_META,
} from './_template-display'

export const metadata = { title: 'Plantillas' }
export const dynamic = 'force-dynamic'

type TemplateRow = {
  id: string
  name: string
  language: string
  category: string
  status: TemplateStatus
  last_synced_at: string | null
  components: unknown
}

type ParsedTemplate = {
  header: string | null
  body: string
  footer: string | null
  buttons: string[]
}

/**
 * El JSON `components` viene en el formato de Meta (HEADER/BODY/FOOTER/BUTTONS).
 * Parseo defensivo: si algo no matchea, simplemente no se muestra esa parte.
 */
function parseComponents(components: unknown): ParsedTemplate {
  const parsed: ParsedTemplate = { header: null, body: '', footer: null, buttons: [] }
  if (!Array.isArray(components)) return parsed
  for (const item of components) {
    if (!item || typeof item !== 'object') continue
    const comp = item as Record<string, unknown>
    const type = typeof comp.type === 'string' ? comp.type.toUpperCase() : ''
    if (type === 'HEADER' && typeof comp.text === 'string') {
      parsed.header = comp.text
    } else if (type === 'BODY' && typeof comp.text === 'string') {
      parsed.body = comp.text
    } else if (type === 'FOOTER' && typeof comp.text === 'string') {
      parsed.footer = comp.text
    } else if (type === 'BUTTONS' && Array.isArray(comp.buttons)) {
      for (const button of comp.buttons) {
        if (button && typeof button === 'object') {
          const text = (button as Record<string, unknown>).text
          if (typeof text === 'string' && text.trim()) parsed.buttons.push(text)
        }
      }
    }
  }
  return parsed
}

const VAR_SPLIT_RE = /(\{\{\s*\d+\s*\}\})/g
const VAR_EXACT_RE = /^\{\{\s*\d+\s*\}\}$/

/** Resalta los huecos `{{1}}` dentro del texto para que se vean como "dato del cliente". */
function renderWithVariables(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let offset = 0
  for (const part of text.split(VAR_SPLIT_RE)) {
    const key = `p-${offset}`
    offset += part.length
    if (!part) continue
    if (VAR_EXACT_RE.test(part)) {
      nodes.push(
        <span
          key={key}
          className="rounded bg-black/10 px-1 font-mono text-[0.85em] dark:bg-white/15"
          title="Se completa solo con el dato de cada cliente"
        >
          {part}
        </span>,
      )
    } else {
      nodes.push(<span key={key}>{part}</span>)
    }
  }
  return nodes
}

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const supabase = await createClient()
  const { data: channel } = await supabase
    .from('channels')
    .select('id, status')
    .eq('tenant_id', access.tenant.id)
    .eq('type', 'whatsapp')
    .maybeSingle()

  const { data: templatesRaw } = await supabase
    .from('message_templates')
    .select('id, name, language, category, status, last_synced_at, components')
    .eq('tenant_id', access.tenant.id)
    .order('name', { ascending: true })

  const templates = (templatesRaw ?? []) as TemplateRow[]

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Mensajería"
        title="Plantillas de WhatsApp"
        description="Tus mensajes aprobados: WhatsApp los revisa una sola vez y después los usás en difusiones, automatizaciones o para escribirle primero a un cliente."
        actions={
          channel ? (
            <div className="flex flex-wrap items-center gap-2">
              <TemplateSyncButton channelId={channel.id} tenantSlug={tenantSlug} />
              <CreateTemplateDialog tenantSlug={tenantSlug} channelId={channel.id} />
            </div>
          ) : null
        }
      />

      {!channel ? (
        <EmptyState
          icon={Plug}
          title="Conectá WhatsApp primero"
          description="Para crear mensajes aprobados necesitás tener tu número de WhatsApp conectado. Se hace una sola vez desde Canales."
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/mensajeria/canales`}>
                <Plug className="size-4" />
                Ir a Canales
              </Link>
            </Button>
          }
        />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="Todavía no tenés plantillas"
          description="Tocá «Nueva plantilla» para escribir tu primer mensaje, o «Traer las novedades de WhatsApp» si ya tenés mensajes aprobados en tu cuenta."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} tenantSlug={tenantSlug} channelId={channel.id} />
          ))}
        </div>
      )}
    </PageShell>
  )
}

function TemplateCard({
  template,
  tenantSlug,
  channelId,
}: {
  template: TemplateRow
  tenantSlug: string
  channelId: string
}) {
  const statusMeta = STATUS_META[template.status]
  const content = parseComponents(template.components)

  return (
    <article className="card-hairline flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-sm">
      <header className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium tracking-tight">
            {humanizeTemplateName(template.name)}
          </h2>
          {/* Meta exige el nombre técnico único; se muestra chiquito por si hay que buscarlo. */}
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {template.name}
          </p>
        </div>
        <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
      </header>

      <div className="flex-1 px-5 py-4">
        {/* El mensaje tal como sale: mini burbuja saliente con los tokens del frame .wa */}
        <div className="max-w-[92%] rounded-lg rounded-tr-sm bg-(--wa-bubble-out) px-3.5 py-2.5 text-(--wa-text) shadow-2xs">
          {content.header ? (
            <p className="mb-1 text-sm font-semibold leading-snug">
              {renderWithVariables(content.header)}
            </p>
          ) : null}
          {content.body ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-snug">
              {renderWithVariables(content.body)}
            </p>
          ) : (
            <p className="text-sm italic text-(--wa-bubble-meta)">
              Esta plantilla no tiene texto (puede ser de imagen o documento).
            </p>
          )}
          {content.footer ? (
            <p className="mt-1 text-[11px] leading-snug text-(--wa-bubble-meta-out)">
              {content.footer}
            </p>
          ) : null}
        </div>

        {content.buttons.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {content.buttons.map((buttonText) => (
              <span
                key={buttonText}
                className="rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {buttonText}
              </span>
            ))}
          </div>
        ) : null}

        {statusMeta.hint ? (
          <p
            className={`mt-3 text-xs ${
              template.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {statusMeta.hint}
          </p>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border/50 px-5 py-2.5">
        <p className="truncate text-xs text-muted-foreground">
          {categoryLabel(template.category)} · {languageLabel(template.language)}
          {template.last_synced_at
            ? ` · Actualizada ${format(new Date(template.last_synced_at), 'dd/MM/yyyy HH:mm')}`
            : ''}
        </p>
        <DeleteTemplateButton
          tenantSlug={tenantSlug}
          channelId={channelId}
          templateName={template.name}
        />
      </footer>
    </article>
  )
}
