// @vitest-environment node
import { ArrowDownLeft } from 'lucide-react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Amount } from '@/components/administracion/amount'
import {
  LedgerGroup,
  LedgerList,
  LedgerRail,
  LedgerRow,
} from '@/components/administracion/kit/ledger'

/**
 * El renglón con margen de cuaderno (`Ledger*`): lo usan la libreta de
 * proveedores, la plata por cobrar, los movimientos de una caja y el historial
 * de Importar. Acá se fija la ESTRUCTURA que leen el teclado y los lectores
 * (listas, títulos, links, el orden de lo que se dice), no las clases.
 */

/** El HTML con espacios comunes (la plata lleva un espacio duro después del «$»). */
function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(' ', ' ')
}

/** Lo que se lee: sin etiquetas y con los espacios colapsados. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function count(markup: string, piece: string): number {
  return markup.split(piece).length - 1
}

const LONG_NAME = 'Distribuidora Mayorista de Bebidas y Alimentos del Centro SA' // 60 caracteres

describe('LedgerRail: el margen dice desde cuándo o para cuándo', () => {
  it('rótulo + valor + unidad, en ese orden y separados', () => {
    const out = html(<LedgerRail label="vencido hace" value={12} unit="días" tone="late" />)
    expect(text(out)).toBe('vencido hace 12 días')
    expect(out).toContain('data-tone="late"')
  })

  it('una fecha: mes, día y día de la semana', () => {
    const out = html(<LedgerRail label="oct" value="10" unit="sáb" />)
    expect(text(out)).toBe('oct 10 sáb')
    // Sin tono pedido es un dato, no una alarma.
    expect(out).toContain('data-tone="muted"')
  })

  it('una palabra sin unidad', () => {
    expect(text(html(<LedgerRail label="vence" value="mañana" tone="warn" />))).toBe('vence mañana')
  })

  it('cero se escribe: no es «sin dato»', () => {
    expect(text(html(<LedgerRail label="vence en" value={0} unit="días" tone="warn" />))).toBe(
      'vence en 0 días',
    )
  })

  it('con ícono y sin valor dibuja el ícono, que no se lee', () => {
    const out = html(<LedgerRail icon={ArrowDownLeft} />)
    expect(out).toContain('<svg')
    expect(out).toContain('aria-hidden="true"')
    expect(text(out)).toBe('')
  })

  it('con valor, el ícono no se dibuja', () => {
    const out = html(<LedgerRail icon={ArrowDownLeft} label="oct" value="10" />)
    expect(out).not.toContain('<svg')
    expect(text(out)).toBe('oct 10')
  })

  it('el punto de color es un adorno: no dice nada solo', () => {
    const out = html(<LedgerRail icon={ArrowDownLeft} swatch="bg-adm-s2" />)
    expect(out).toContain('bg-adm-s2')
    expect(text(out)).toBe('')
    expect(out).not.toMatch(/<span(?![^>]*aria-hidden)[^>]*bg-adm-s2/)
  })

  it('«vencido hace … días»: los dos textos chicos van en una tinta que se lee, el número en rojo', () => {
    const out = html(<LedgerRail label="vencido hace" value={12} unit="días" tone="late" />)
    const small = [...out.matchAll(/<span class="([^"]*text-\[10px\][^"]*)">([^<]+)<\/span>/g)]
    expect(small.map((m) => m[2])).toEqual(['vencido hace', 'días'])
    for (const [, classes] of small) {
      // El rojo mezclado con la tinta del tema (la receta de `StatusPill`): 6:1 en claro y en oscuro.
      expect(classes).toContain('color-mix(in_oklch,var(--destructive)_75%,var(--foreground))')
    }
    // El número grande conserva el tono puro, que hereda del margen.
    expect(out).toMatch(/^<div data-tone="late" class="[^"]*text-destructive[^"]*"/)
    expect(out).not.toMatch(/<span class="[^"]*font-serif[^"]*color-mix/)
    // Los otros tonos no cambian.
    const ok = html(<LedgerRail label="a favor" value={3} unit="días" tone="ok" />)
    expect(ok).not.toContain('color-mix')
  })
})

describe('LedgerRow: un renglón', () => {
  it('es un ítem de lista con el margen primero y después quién, cuánto y la acción', () => {
    const out = html(
      <LedgerRow
        rail={<LedgerRail label="vencido hace" value={12} unit="días" tone="late" />}
        title="Distribuidora de Bebidas"
        meta="Bebidas sin alcohol · última compra 03/10"
        amount={<Amount cents={333_660_000} />}
        amountNote="$ 2.562.200 vencido"
        action={<button type="button">Pagar</button>}
        menu={<button type="button" aria-label="Más de Distribuidora de Bebidas" />}
      />,
    )
    expect(out.startsWith('<li')).toBe(true)
    expect(text(out)).toBe(
      'vencido hace 12 días Distribuidora de Bebidas Bebidas sin alcohol · última compra 03/10 $ 3.336.600,00 $ 2.562.200 vencido Pagar',
    )
    // La acción va antes que el menú: es la que se alcanza primero con Tab.
    expect(out.indexOf('>Pagar<')).toBeLessThan(out.indexOf('Más de Distribuidora'))
  })

  it('con `href` el título es un link (uno solo) y lleva al destino', () => {
    const out = html(
      <LedgerRow
        title="Hielo Cristal"
        href="/hub/administracion/compras/proveedores/p1"
        action={<button type="button">Pagar</button>}
      />,
    )
    expect(count(out, '<a ')).toBe(1)
    expect(out).toMatch(
      /<a [^>]*href="\/hub\/administracion\/compras\/proveedores\/p1"[^>]*>Hielo Cristal<\/a>/,
    )
    // El botón no queda adentro del link.
    expect(out).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<button/)
  })

  it('sin `href` no hay ningún link', () => {
    expect(html(<LedgerRow title="Hielo Cristal" />)).not.toContain('<a ')
  })

  it('`dense` deja el margen vacío', () => {
    const rail = <LedgerRail label="vencido hace" value={12} unit="días" tone="late" />
    const full = html(<LedgerRow rail={rail} title="Hielo Cristal" />)
    const dense = html(<LedgerRow rail={rail} title="Hielo Cristal" dense />)
    expect(text(full)).toBe('vencido hace 12 días Hielo Cristal')
    expect(text(dense)).toBe('Hielo Cristal')
    expect(dense).not.toContain('data-tone')
  })

  it('un nombre de 60 caracteres queda entero para lectores y al pasar el mouse', () => {
    expect(LONG_NAME).toHaveLength(60)
    const out = html(<LedgerRow title={LONG_NAME} href="/x" />)
    expect(out).toContain(`title="${LONG_NAME}"`)
    expect(text(out)).toBe(LONG_NAME)
  })

  it('un importe de nueve cifras se escribe entero, y cero también', () => {
    const big = html(<LedgerRow title="Banco" amount={<Amount cents={12_345_678_950} />} />)
    expect(text(big)).toBe('Banco $ 123.456.789,50')
    const zero = html(<LedgerRow title="Banco" amount={<Amount cents={0} />} />)
    expect(text(zero)).toBe('Banco $ 0,00')
  })

  it('sin importe ni acción no deja huecos que se lean', () => {
    const out = html(<LedgerRow title="Hielo Cristal" />)
    expect(text(out)).toBe('Hielo Cristal')
    expect(out).not.toContain('<button')
  })

  it('lleva su ancla', () => {
    expect(html(<LedgerRow id="mov-7" title="Hielo" />)).toMatch(/^<li id="mov-7"/)
  })

  it('con `onClick` el título es un botón estirado: el renglón se toca sin navegar', () => {
    const out = html(
      <LedgerRow
        title="Hielo Cristal"
        onClick={() => {}}
        pressed={false}
        amount={<Amount cents={1_200_000} />}
        action={<button type="button">Quitar</button>}
      />,
    )
    expect(out).not.toContain('<a ')
    const title = /<button type="button"([^>]*)>Hielo Cristal<\/button>/.exec(out)
    expect(title).not.toBeNull()
    expect(title?.[1]).toContain('aria-pressed="false"')
    // Mismo estirado y mismo foco que el link: todo el renglón es el área de toque.
    expect(title?.[1]).toContain('after:absolute')
    expect(title?.[1]).toContain('after:inset-0')
    expect(title?.[1]).toContain('focus-visible:after:ring-2')
    // Y el renglón responde al mouse igual que uno con `href`.
    const linked = html(<LedgerRow title="Hielo Cristal" href="/x" />)
    expect(/^<li class="([^"]*)"/.exec(out)?.[1]).toContain('hover:bg-cream-tint')
    expect(/^<li class="([^"]*)"/.exec(linked)?.[1]).toContain('hover:bg-cream-tint')
    expect(/^<li class="([^"]*)"/.exec(html(<LedgerRow title="Hielo" />))?.[1]).not.toContain(
      'hover:bg-cream-tint',
    )
    // La acción no queda adentro del botón del título.
    expect(out).not.toMatch(
      /<button type="button"[^>]*aria-pressed[^>]*>(?:(?!<\/button>).)*<button/,
    )
  })

  it('tildado se anuncia como tildado; sin `pressed`, es un botón común', () => {
    expect(html(<LedgerRow title="Factura 12" onClick={() => {}} pressed />)).toContain(
      'aria-pressed="true"',
    )
    expect(html(<LedgerRow title="Proveedor" onClick={() => {}} />)).not.toContain('aria-pressed')
  })

  it('con `href` gana el link: `onClick` no dibuja un botón además', () => {
    const out = html(<LedgerRow title="Hielo" href="/x" onClick={() => {}} />)
    expect(count(out, '<a ')).toBe(1)
    expect(out).not.toContain('<button')
  })

  it('un renglón que se abre en el lugar: lo dice el link y el cuerpo va debajo, tocable', () => {
    const open = html(
      <LedgerRow
        title="Hielo Cristal"
        href="/hub/administracion/importar/b1?abrir=p7"
        scroll={false}
        expanded
        amount={<Amount cents={1_200_000} />}
      >
        <button type="button">Cargar así</button>
      </LedgerRow>,
    )
    expect(open).toMatch(/<a [^>]*aria-expanded="true"[^>]*>Hielo Cristal<\/a>/)
    // El cuerpo va después del importe, por encima del link estirado y a todo el ancho.
    expect(text(open)).toBe('Hielo Cristal $ 12.000,00 Cargar así')
    expect(open).toMatch(
      /<div class="[^"]*relative[^"]*z-\[1\][^"]*basis-full[^"]*"><button type="button">Cargar así/,
    )
    expect(open).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*Cargar así/)
    const closed = html(<LedgerRow title="Hielo Cristal" href="/x" expanded={false} />)
    expect(closed).toContain('aria-expanded="false"')
    expect(html(<LedgerRow title="Hielo Cristal" href="/x" />)).not.toContain('aria-expanded')
  })

  it('se acomoda al ancho de la HOJA, no al de la ventana', () => {
    const out = html(
      <LedgerList aria-label="Últimos movimientos" bare>
        <LedgerRow
          rail={<LedgerRail icon={ArrowDownLeft} />}
          title="Hielo"
          amount={<Amount cents={1_200_000} />}
          action={<button type="button">Ver</button>}
        />
      </LedgerList>,
    )
    // La hoja es el contenedor que se mide.
    expect(out).toMatch(/^<div class="[^"]*@container\/ledger/)
    // Ningún corte por ancho de ventana: en una columna angosta de la compu va como en el celular.
    expect(out).not.toMatch(/(?<![\w-])(?:max-)?(?:sm|md|lg|xl):/)
    expect(out).toContain('@[28rem]/ledger:w-16')
    expect(out).toContain('@max-[28rem]/ledger:basis-full')
    // En una hoja muy angosta TODOS los importes bajan (ninguna lista despareja).
    expect(out).toContain('@max-[20rem]/ledger:basis-full')
  })

  it('sin botones al lado, el nombre pide menos lugar y el importe entra en la misma línea', () => {
    const plain = html(<LedgerRow title="Hielo" amount={<Amount cents={1_200_000} />} />)
    const withAction = html(
      <LedgerRow
        title="Hielo"
        amount={<Amount cents={1_200_000} />}
        action={<button type="button">Pagar</button>}
      />,
    )
    expect(plain).toContain('basis-28')
    expect(plain).not.toContain('basis-36')
    expect(withAction).toContain('basis-36')
  })
})

describe('LedgerList: la hoja', () => {
  const row = <LedgerRow title="Hielo Cristal" />

  it('es una lista con nombre', () => {
    const out = html(<LedgerList aria-label="Proveedores">{row}</LedgerList>)
    expect(out).toMatch(/<ul [^>]*aria-label="Proveedores"/)
    expect(count(out, '<li')).toBe(1)
  })

  it('`bare` no dibuja superficie: va adentro de un panel', () => {
    const own = html(<LedgerList aria-label="Proveedores">{row}</LedgerList>)
    const bare = html(
      <LedgerList aria-label="Proveedores" bare>
        {row}
      </LedgerList>,
    )
    expect(own).toContain('card-hairline')
    expect(bare).not.toContain('card-hairline')
    expect(bare).not.toContain('bg-card')
    // La lista y el margen son los mismos.
    expect(bare).toMatch(/<ul [^>]*aria-label="Proveedores"/)
    expect(text(bare)).toBe(text(own))
  })

  it('el pie va después de la lista, fuera de ella', () => {
    const out = html(
      <LedgerList aria-label="Proveedores" footer="Mostrando 12 proveedores">
        {row}
      </LedgerList>,
    )
    expect(out.indexOf('</ul>')).toBeLessThan(out.indexOf('Mostrando 12 proveedores'))
  })

  it('sin renglones no dibuja una hoja vacía', () => {
    expect(html(<LedgerList aria-label="Proveedores">{[]}</LedgerList>)).toBe('')
    expect(html(<LedgerList aria-label="Proveedores">{null}</LedgerList>)).toBe('')
  })

  it('armada solo con grupos vacíos, la hoja se esconde sola (no queda una tarjeta sin nada)', () => {
    const out = html(
      <LedgerList aria-label="No se cargan">
        <LedgerGroup title="Ya estaban cargados">{[]}</LedgerGroup>
        <LedgerGroup title="No son del bar">{[]}</LedgerGroup>
      </LedgerList>,
    )
    // Los grupos no dejan nada: la lista queda sin hijos y el envoltorio se oculta por CSS.
    expect(out).toMatch(/<ul aria-label="No se cargan"[^>]*><\/ul>/)
    expect(out).toMatch(/^<div class="[^"]*has-\[&gt;div&gt;ul:empty\]:hidden/)
    expect(text(out)).toBe('')
    // Con pie, la hoja se dibuja igual: el pie es contenido.
    const withFooter = html(
      <LedgerList aria-label="No se cargan" footer="Nada por acá">
        <LedgerGroup title="Ya estaban cargados">{[]}</LedgerGroup>
      </LedgerList>,
    )
    expect(withFooter).not.toContain(':empty')
    expect(text(withFooter)).toBe('Nada por acá')
  })
})

describe('LedgerGroup: un grupo con su título', () => {
  const group = (
    <LedgerList aria-label="Movimientos de Caja">
      <LedgerGroup
        id="dia-2026-10-10"
        title="Sábado 10/10"
        count={2}
        aside="↑ entró $ 120.000 ↓ salió $ 45.000"
        footer="Al cierre del día quedó en $ 394.757"
      >
        <LedgerRow rail={<LedgerRail icon={ArrowDownLeft} />} title="Hielo" />
        <LedgerRow rail={<LedgerRail icon={ArrowDownLeft} />} title="Verdulería" />
      </LedgerGroup>
    </LedgerList>
  )

  it('título, contador y `aside` arriba; los renglones; el pie al final', () => {
    const out = html(group)
    expect(text(out)).toBe(
      'Sábado 10/10 2 ↑ entró $ 120.000 ↓ salió $ 45.000 Hielo Verdulería Al cierre del día quedó en $ 394.757',
    )
  })

  it('el título es un encabezado y le da nombre a la lista de sus renglones', () => {
    const out = html(group)
    const heading = /<h3 id="([^"]+)"[^>]*>Sábado 10\/10<\/h3>/.exec(out)
    expect(heading).not.toBeNull()
    expect(out).toContain(`<ul aria-labelledby="${heading?.[1]}"`)
    // Una lista adentro de la otra: la hoja y el grupo.
    expect(count(out, '<ul')).toBe(2)
    expect(count(out, '<li')).toBe(3)
  })

  it('el contador va en su propia pastilla, no pegado al título', () => {
    const out = html(group)
    expect(out).toMatch(/<\/h3><span[^>]*>2<\/span>/)
  })

  it('lleva su ancla para saltar al día', () => {
    expect(html(group)).toContain('<li id="dia-2026-10-10"')
  })

  it('sin `aside`, sin contador y sin pie no deja restos', () => {
    const out = html(
      <LedgerList aria-label="Proveedores">
        <LedgerGroup title="Les debés">
          <LedgerRow title="Hielo Cristal" />
        </LedgerGroup>
      </LedgerList>,
    )
    expect(text(out)).toBe('Les debés Hielo Cristal')
  })

  it('`more` guarda el resto detrás de un plegable que anda sin JavaScript', () => {
    const out = html(
      <LedgerList aria-label="Proveedores">
        <LedgerGroup
          title="Sin deuda"
          count={3}
          more={{
            label: 'Ver los 2 que faltan',
            children: (
              <>
                <LedgerRow title="La Virginia" dense />
                <LedgerRow title="Coca Cola" dense />
              </>
            ),
          }}
        >
          <LedgerRow title="Almacén Don José" dense />
        </LedgerGroup>
      </LedgerList>,
    )
    expect(out).toMatch(/<details[^>]*><summary[^>]*>Ver los 2 que faltan/)
    // Cerrado por defecto, y los renglones guardados siguen siendo una lista.
    expect(out).not.toMatch(/<details[^>]* open/)
    const hidden = out.slice(out.indexOf('<details'), out.indexOf('</details>'))
    expect(hidden).toContain('<ul')
    expect(count(hidden, '<li')).toBe(2)
    expect(text(out)).toBe(
      'Sin deuda 3 Almacén Don José Ver los 2 que faltan La Virginia Coca Cola',
    )
  })

  it('un grupo sin renglones no se dibuja', () => {
    const out = html(
      <LedgerList aria-label="Proveedores">
        <LedgerGroup title="Tenés a favor">{[]}</LedgerGroup>
        <LedgerGroup title="Les debés">
          <LedgerRow title="Hielo Cristal" />
        </LedgerGroup>
      </LedgerList>,
    )
    expect(out).not.toContain('Tenés a favor')
    expect(text(out)).toBe('Les debés Hielo Cristal')
  })
})
