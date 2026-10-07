'use client'

import { Download, Pencil, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Spinner } from '@/components/ui/spinner'
import { SubmitButton } from '@/components/ui/submit-button'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack } from './catalog-block'
import { useCatalog } from './catalog-provider'
import { wait } from './demo-utils'
import { tourId } from './registry'

function ButtonDemo() {
  const { basePath } = useCatalog()
  return (
    <DemoStack>
      <DemoRow label="Variantes (una sola primary por vista)">
        <Button type="button" data-tour={tourId('button')}>
          Guardar
        </Button>
        <Button type="button" variant="secondary">
          Cancelar
        </Button>
        <Button type="button" variant="ghost">
          Ver más
        </Button>
        <Button type="button" variant="danger">
          Borrar regla
        </Button>
        <Button type="button" variant="danger-ghost">
          <Trash2 aria-hidden="true" />
          Borrar
        </Button>
        <Button type="button" variant="link">
          Ver el detalle
        </Button>
      </DemoRow>
      <DemoRow label="Tamaños: sm 32 · md 36 · lg 44 px (36 · 44 · 48 con el dedo)">
        <Button type="button" size="sm">
          Chico
        </Button>
        <Button type="button" size="md">
          Mediano
        </Button>
        <Button type="button" size="lg">
          Grande
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Editar, chico">
          <Pencil aria-hidden="true" />
        </Button>
        <Button type="button" size="icon" variant="secondary" aria-label="Agregar">
          <Plus aria-hidden="true" />
        </Button>
        <Button type="button" size="icon-lg" aria-label="Descargar">
          <Download aria-hidden="true" />
        </Button>
      </DemoRow>
      <DemoRow label="Estados fijos">
        <Button type="button" disabled>
          Deshabilitado
        </Button>
        <Button type="button" loading>
          Guardar
        </Button>
        <Button type="button" variant="secondary" loading>
          <Download aria-hidden="true" />
          Exportar
        </Button>
        <Button type="button" loading loadingText="Guardando…">
          Guardar
        </Button>
        <Button type="button" variant="secondary" aria-disabled="true">
          Sin permiso
        </Button>
      </DemoRow>
      <DemoRow label="Como link (asChild): lo que navega es un <a>">
        <Button asChild variant="secondary" data-tour={tourId('button-link')}>
          <Link href={`${basePath}#button`}>Ver la guía del botón</Link>
        </Button>
      </DemoRow>
    </DemoStack>
  )
}

function SubmitButtonDemo() {
  const [last, setLast] = React.useState<string | null>(null)

  // Una «Server Action» de mentira: tarda un poco y dice qué botón la mandó.
  async function save(formData: FormData) {
    await wait(1200)
    setLast(formData.get('intent') === 'pagar' ? 'Guardado y pagado.' : 'Guardado.')
  }

  return (
    <form action={save} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SubmitButton variant="secondary" name="intent" value="pagar" pendingText="Guardando…">
          Guardar y pagar
        </SubmitButton>
        <SubmitButton
          name="intent"
          value="guardar"
          pendingText="Guardando…"
          data-tour={tourId('submit-button')}
        >
          Guardar
        </SubmitButton>
      </div>
      <p role="status" className="min-h-5 type-small text-muted-foreground">
        {last}
      </p>
    </form>
  )
}

function SpinnerDemo() {
  return (
    <DemoStack>
      <DemoRow label="Tamaños: 14 · 16 · 20 · 24 (suelto lleva role=status)">
        <Spinner size={14} />
        <Spinner size={16} data-tour={tourId('spinner')} />
        <Spinner size={20} />
        <Spinner size={24} label="Cargando las facturas…" />
      </DemoRow>
      <DemoRow label="En texto: hereda el color">
        <span className="inline-flex items-center gap-2 type-small text-muted-foreground">
          <Spinner size={14} aria-hidden />
          Buscando…
        </span>
      </DemoRow>
    </DemoStack>
  )
}

function CopyButtonDemo() {
  return (
    <DemoStack>
      <DemoRow label="Con etiqueta y solo ícono">
        <CopyButton value="20-12345678-6" label="Copiar CUIT" data-tour={tourId('copy-button')} />
        <CopyButton value="0003-00001234" iconOnly label="Copiar el número de factura" />
        <CopyButton
          value="https://ejemplo.com/carta"
          variant="ghost"
          size="md"
          label="Copiar link"
        />
      </DemoRow>
    </DemoStack>
  )
}

export function ActionsFamily() {
  return (
    <CatalogFamily id="acciones">
      <CatalogBlock
        id="button"
        compat="Las variantes viejas (`default`, `outline`, `destructive`, `success`) y los tamaños `default` y `xl` se mapean solos; `buttonVariants` los declara como alias (`@deprecated`)."
        purpose="Toda acción. Un solo `primary` por vista o por formulario."
        yes="Para hacer algo («Guardar», «Borrar proveedor»). Como link con `asChild` cuando navega."
        no="Para un filtro (`FilterChip`, `SegmentedControl`) o para un link en medio de un texto (va subrayado, sin botón)."
        usage={`<Button>Guardar</Button>
<Button variant="secondary" asChild>
  <Link href={volver}>Cancelar</Link>
</Button>
<Button size="icon" variant="ghost" aria-label="Editar"><Pencil /></Button>
<Button loading loadingText="Guardando…">Guardar</Button>`}
        a11y={[
          'Es un `<button>` nativo: Enter y Espacio. El `type` por defecto sigue siendo `submit`.',
          'Cargando: `aria-busy` y `aria-disabled`, sigue enfocable y no reacciona; el ancho no salta.',
          'Un botón de ícono sin `aria-label` avisa en la consola de desarrollo.',
          'Foco «afuera» (2 px). El link va subrayado siempre: el color solo no lo distingue (1,64:1 contra la tinta).',
        ]}
      >
        <ButtonDemo />
      </CatalogBlock>

      <CatalogBlock
        id="submit-button"
        purpose="El «Guardar» de un formulario con Server Action: `useFormStatus` pone el spinner solo."
        yes="En todo `<form action>`. Con dos botones («Guardar» y «Guardar y pagar»), cada uno con `name=&quot;intent&quot;` y su `value`."
        no="Fuera de un formulario, o en un formulario con `onSubmit` a mano (ahí, `Button loading`)."
        usage={`<form action={formAction}>
  …
  <SubmitButton variant="secondary" name="intent" value="pagar">Guardar y pagar</SubmitButton>
  <SubmitButton name="intent" value="guardar" pendingText="Guardando…">Guardar</SubmitButton>
</form>`}
        a11y={[
          'El spinner va solo en el botón que se tocó; el otro queda `aria-disabled` mientras dura el envío.',
          'Enter en un campo envía con el primer botón de envío del formulario: la acción lee `intent`.',
        ]}
      >
        <SubmitButtonDemo />
      </CatalogBlock>

      <CatalogBlock
        id="spinner"
        purpose="Un arco de 2 px que gira en 700 ms: algo está pasando."
        yes="Adentro de un botón que carga (lo pone `loading`), en «Buscando…» de un combobox o suelto en un bloque que espera."
        no="Para la carga de una página: ahí van esqueletos que copian los altos finales."
        usage={`<Spinner size={16} />                 // suelto: role="status" + «Cargando…»
<Spinner size={14} aria-hidden />     // adentro de algo que ya lo dice`}
        a11y={[
          'Suelto lleva `role="status"` y un texto oculto (`label`, «Cargando…» por defecto).',
          'Con `aria-hidden` es el `<svg>` pelado: para cuando el contenedor ya dice `aria-busy`.',
          'Con «reducir movimiento» gira más lento (1,2 s), no se frena: un spinner quieto no dice nada.',
        ]}
      >
        <SpinnerDemo />
      </CatalogBlock>

      <CatalogBlock
        id="copy-button"
        purpose="Copiar al portapapeles con confirmación visible y anunciada."
        yes="Un CUIT, un número de comprobante, un link para compartir, el código de un error."
        no="Para copiar algo largo que la persona tiene que revisar antes: mejor mostrarlo seleccionable."
        usage={`<CopyButton value={cuit} label="Copiar CUIT" />
<CopyButton value={numero} iconOnly label="Copiar el número" />`}
        a11y={[
          'Una región `aria-live` anuncia «Copiado»; a los 1,8 s vuelve a su estado.',
          'Solo ícono: el nombre va en `aria-label` y cambia a «Copiado» mientras dura.',
          'Sin permiso de portapapeles (http, WebView) avisa con un toast en vez de fallar callado.',
        ]}
      >
        <CopyButtonDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
