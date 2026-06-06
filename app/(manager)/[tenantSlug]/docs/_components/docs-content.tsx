'use client'

import {
  BookOpen,
  ChefHat,
  ClipboardList,
  Coins,
  HelpCircle,
  LayoutGrid,
  LifeBuoy,
  type LucideIcon,
  Mail,
  Shield,
  Smartphone,
  Stamp,
  UserPlus,
  UtensilsCrossed,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

type Section = {
  id: string
  label: string
  icon: LucideIcon
  Component: () => React.ReactNode
}

export function DocsContent({ tenantSlug, role }: { tenantSlug: string; role: string }) {
  const [active, setActive] = useState<string>('inicio')

  const sections: Section[] = [
    { id: 'inicio', label: 'Bienvenida', icon: BookOpen, Component: () => <SectionInicio /> },
    { id: 'roles', label: 'Roles y permisos', icon: Shield, Component: () => <SectionRoles /> },
    {
      id: 'mesas',
      label: 'Mesas y QRs',
      icon: LayoutGrid,
      Component: () => <SectionMesas slug={tenantSlug} />,
    },
    {
      id: 'menu',
      label: 'Menú y carta',
      icon: UtensilsCrossed,
      Component: () => <SectionMenu slug={tenantSlug} />,
    },
    {
      id: 'comensal',
      label: 'Flujo del comensal',
      icon: Smartphone,
      Component: () => <SectionComensal />,
    },
    {
      id: 'mozo',
      label: 'Panel del mozo',
      icon: ClipboardList,
      Component: () => <SectionMozo slug={tenantSlug} />,
    },
    {
      id: 'cocina',
      label: 'Panel de cocina',
      icon: ChefHat,
      Component: () => <SectionCocina slug={tenantSlug} />,
    },
    { id: 'cobro', label: 'Cobro y puntos', icon: Coins, Component: () => <SectionCobro /> },
    {
      id: 'punch',
      label: 'Punch cards',
      icon: Stamp,
      Component: () => <SectionPunch slug={tenantSlug} />,
    },
    {
      id: 'equipo',
      label: 'Gestionar equipo',
      icon: UserPlus,
      Component: () => <SectionEquipo slug={tenantSlug} />,
    },
    {
      id: 'auto-accept',
      label: 'Auto-aceptación',
      icon: Zap,
      Component: () => <SectionAutoAccept slug={tenantSlug} />,
    },
    { id: 'email', label: 'Email transaccional', icon: Mail, Component: () => <SectionEmail /> },
    { id: 'faq', label: 'Preguntas frecuentes', icon: HelpCircle, Component: () => <SectionFaq /> },
    {
      id: 'soporte',
      label: 'Soporte y límites',
      icon: LifeBuoy,
      Component: () => <SectionSoporte />,
    },
  ]

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <nav className="lg:sticky lg:top-6 lg:self-start">
        <ul className="space-y-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={() => setActive(s.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  active === s.id
                    ? 'border border-primary/20 bg-[--cream-tint] font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <s.icon className="size-3.5" />
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-4 px-2.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          Tu rol: {role}
        </p>
      </nav>

      <div className="space-y-12 lg:max-w-2xl">
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-6">
            <s.Component />
          </section>
        ))}
      </div>
    </div>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="font-serif text-2xl font-semibold tracking-tight">{children}</h2>
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 font-serif text-lg font-semibold tracking-tight">{children}</h3>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-foreground/80">{children}</p>
}
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
      <strong>Tip:</strong> {children}
    </div>
  )
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
      <strong>Nota:</strong> {children}
    </div>
  )
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">{children}</code>
}
function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{children}</ol>
}
function Bullets({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">{children}</ul>
}

// ──────────────────────────────────────────────────────────
// Secciones
// ──────────────────────────────────────────────────────────

function SectionInicio() {
  return (
    <div>
      <H2>Bienvenido a HUB</H2>
      <P>
        HUB es la plataforma operativa de tu bar. Cubre tres casos:{' '}
        <strong>recibir pedidos por QR</strong>,{' '}
        <strong>controlar la cocina y la salida de pedidos</strong>, y{' '}
        <strong>fidelizar a tus clientes con puntos y promociones</strong>. Todo en un solo sistema,
        sin que el comensal tenga que descargar app.
      </P>

      <H3>Qué necesitás para arrancar</H3>
      <Bullets>
        <li>Una computadora o tablet para el dueño (este panel).</li>
        <li>Celulares para los mozos (acceden con su email/password al mismo dominio).</li>
        <li>Una tablet en cocina (opcional, vista KDS).</li>
        <li>QRs impresos pegados en cada mesa física.</li>
      </Bullets>

      <H3>Conceptos clave</H3>
      <Bullets>
        <li>
          <strong>Mesa física</strong> (<Code>physical_table</Code>): un mueble del bar con un QR
          impreso. Vive permanentemente.
        </li>
        <li>
          <strong>Sesión</strong> (<Code>table_session</Code>): un grupo de gente sentado en la
          mesa. Se abre cuando alguien escanea el QR; se cierra cuando se cobra.
        </li>
        <li>
          <strong>Comanda</strong> (<Code>ticket</Code>): un envío a cocina. Una sesión puede tener
          varias (cada vez que el comensal o el mozo dispara "Realizar orden" se crea una nueva).
        </li>
        <li>
          <strong>Guest</strong>: cada celular que escanea el QR. Pueden estar registrados (suman
          puntos) o anónimos (igual pueden pedir).
        </li>
      </Bullets>

      <Tip>
        El concepto fundamental es que <strong>sesión y QR son cosas separadas</strong>. La mesa
        física existe siempre con su QR fijo; las sesiones nacen y mueren con cada grupo.
      </Tip>
    </div>
  )
}

function SectionRoles() {
  return (
    <div>
      <H2>Roles y permisos</H2>
      <P>HUB tiene 4 roles, cada uno con su panel y sus permisos:</P>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3">Rol</th>
              <th className="py-2 pr-3">Acceso</th>
              <th className="py-2">Pantalla principal</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="py-3 pr-3 font-medium">Owner</td>
              <td className="py-3 pr-3">Todo. Configuración, equipo, finanzas, marketing.</td>
              <td className="py-3">Resumen, todas las páginas.</td>
            </tr>
            <tr className="border-b">
              <td className="py-3 pr-3 font-medium">Mozo</td>
              <td className="py-3 pr-3">Sesiones abiertas, confirmar comandas, cobrar.</td>
              <td className="py-3">Sesiones.</td>
            </tr>
            <tr className="border-b">
              <td className="py-3 pr-3 font-medium">Cocina</td>
              <td className="py-3 pr-3">Avanzar comandas en cocina, marcar sin stock.</td>
              <td className="py-3">Cocina (KDS).</td>
            </tr>
            <tr>
              <td className="py-3 pr-3 font-medium">Cajero</td>
              <td className="py-3 pr-3">Cobrar mesas (rol legacy, casi-mozo).</td>
              <td className="py-3">Sesiones, cerrar mesa legacy.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Note>
        El sidebar lateral se filtra automáticamente: cada rol solo ve las pantallas a las que tiene
        permiso.
      </Note>
    </div>
  )
}

function SectionMesas({ slug }: { slug: string }) {
  return (
    <div>
      <H2>Mesas y QRs</H2>
      <P>
        Cada mesa física del bar tiene un QR único. El comensal lo escanea y se le abre la carta en
        su celular.
      </P>

      <H3>Crear una mesa</H3>
      <Steps>
        <li>
          Andá a{' '}
          <a href={`/${slug}/local/mesas`} className="text-primary underline">
            Local → Plano
          </a>
          .
        </li>
        <li>
          Click <strong>"Nueva mesa"</strong>.
        </li>
        <li>
          Ponele un nombre (ej: <em>Mesa 5</em>, <em>Barra 1</em>, <em>VIP</em>).
        </li>
        <li>Capacidad (opcional, solo informativo).</li>
        <li>
          Click <strong>"Crear mesa"</strong>. La mesa aparece con su <Code>qr_token</Code> de 16
          caracteres.
        </li>
      </Steps>

      <H3>Imprimir el QR</H3>
      <Steps>
        <li>En la lista de mesas, click el ícono de impresora 🖨 sobre la mesa.</li>
        <li>Se abre una nueva pestaña con el QR + nombre de la mesa, listo para imprimir en A6.</li>
        <li>El navegador dispara el diálogo de impresión automáticamente.</li>
        <li>Pegá el QR sobre la mesa física en un lugar visible.</li>
      </Steps>

      <H3>Regenerar el QR</H3>
      <P>
        Si filtraste el QR (alguien le sacó foto y lo está usando desde fuera del bar), podés
        rotarlo: en la lista, click el ícono ↻.{' '}
        <strong>El QR viejo deja de funcionar al instante.</strong> Reimprimí el nuevo y reemplazá
        el sticker físico.
      </P>

      <Note>
        El qr_token también <strong>rota automáticamente cada vez que cobrás una mesa</strong>. Eso
        evita que el comensal vuelva a pedir desde su casa con el QR viejo.
      </Note>

      <H3>Eliminar una mesa</H3>
      <P>
        Si la mesa tiene sesiones históricas, no la podés borrar (la base de datos protege los
        datos). En su lugar, editala y marcala como <strong>inactiva</strong>: deja de aparecer para
        los comensales pero el historial queda.
      </P>
    </div>
  )
}

function SectionMenu({ slug }: { slug: string }) {
  return (
    <div>
      <H2>Menú y carta</H2>
      <P>
        Tu carta se organiza en categorías (Cervezas, Tragos, Picadas, Postres) con ítems adentro.
        Eso es lo que ve el comensal cuando escanea el QR.
      </P>

      <H3>Cargar el menú</H3>
      <Steps>
        <li>
          Andá a{' '}
          <a href={`/${slug}/menu`} className="text-primary underline">
            Menú
          </a>
          .
        </li>
        <li>Creá categorías primero (ej: "Tragos clásicos").</li>
        <li>
          Adentro de cada categoría, agregá ítems con: nombre, descripción, precio, imagen opcional.
        </li>
        <li>Marcá ítems como inactivos cuando se acaben (no se borran, vuelven con un toggle).</li>
      </Steps>

      <H3>Tags de carta</H3>
      <P>
        En{' '}
        <a href={`/${slug}/configuracion/tags`} className="text-primary underline">
          Configuración → Tags de carta
        </a>{' '}
        creás etiquetas (#cafe, #vegano, #sin-tacc) y las asignás a ítems del menú. Los tags se usan
        en las <strong>punch cards</strong> para definir qué cuenta como un "stamp".
      </P>

      <Tip>
        Si vendés muchos cafés (capuchino, cortado, americano), un tag <Code>#cafe</Code> asignado a
        todos te permite hacer una punch card "5 cafés = 1 gratis" sin importar cuál eligió el
        cliente.
      </Tip>
    </div>
  )
}

function SectionComensal() {
  return (
    <div>
      <H2>Flujo del comensal</H2>
      <P>El comensal nunca instala una app. Usa solo el navegador de su celular.</P>

      <H3>Paso a paso</H3>
      <Steps>
        <li>Llega al bar. Se sienta. Escanea el QR de su mesa con la cámara.</li>
        <li>
          Se abre la carta en su navegador. Si es el primero en escanear esa noche, el sistema abre
          una sesión nueva. Si ya había una abierta (otra persona ya escaneó), se suma como guest a
          la misma sesión.
        </li>
        <li>
          Banner arriba: <em>"Sumá puntos en cada pedido →"</em>. Si toca, completa teléfono +
          nombre + cumpleaños. Es <strong>opcional</strong>: puede pedir igual sin registrarse.
        </li>
        <li>
          Navega categorías, toca un ítem → sheet con qty + notas opcionales (sin cebolla, bien
          frío) → <strong>Agregar al carrito</strong>.
        </li>
        <li>
          Cuando termina de armar, toca el botón sticky abajo "Carrito (N) $XX" → revisa →{' '}
          <strong>Realizar orden</strong>.
        </li>
        <li>
          La comanda entra como <Code>pending</Code>. Pestaña <em>Mis órdenes</em> muestra el estado
          en vivo: pending → accepted → preparing → ready → served.
        </li>
        <li>
          Puede armar más rondas mientras la sesión esté abierta. También puede tocar{' '}
          <strong>Pedir la cuenta</strong> para alertar al mozo.
        </li>
        <li>
          Cuando el mozo cobra desde su panel, el comensal ve la <em>pantalla de cierre</em>: con su
          consumo, balance de puntos actualizado y progreso de punch cards (si está registrado).
        </li>
      </Steps>

      <H3>Casos especiales</H3>
      <Bullets>
        <li>
          <strong>Comensal anónimo</strong>: no se registra. Puede pedir igual. Sus consumos no
          generan puntos.
        </li>
        <li>
          <strong>Cancelar antes de aceptación</strong>: dentro de los 60 segundos de "Realizar
          orden" y si la comanda sigue <Code>pending</Code>, puede cancelarla con un click.
        </li>
        <li>
          <strong>Ítems compartidos</strong>: el ítem va al pool de la mesa. Los puntos se atribuyen
          al guest que lo pidió (no se reparten).
        </li>
        <li>
          <strong>Cierre sin cobrar (cron)</strong>: si la sesión queda abierta &gt;8h sin
          actividad, un cron diario la marca como <Code>abandoned</Code>. No genera puntos.
        </li>
      </Bullets>
    </div>
  )
}

function SectionMozo({ slug }: { slug: string }) {
  return (
    <div>
      <H2>Panel del mozo</H2>
      <P>
        El mozo entra desde su celular a{' '}
        <a href={`/${slug}/sesiones`} className="text-primary underline">
          Sesiones
        </a>
        . Es su pantalla principal toda la noche.
      </P>

      <H3>Vista de sesiones</H3>
      <P>
        Una grilla con cada mesa abierta. Cada card muestra: nombre de la mesa, hora de apertura,
        total acumulado, cantidad de comensales conectados, y badges de alertas:
      </P>
      <Bullets>
        <li>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-warning">
            N pending
          </span>{' '}
          → hay comandas esperando confirmación del mozo.
        </li>
        <li>
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-900">
            Pidieron cuenta
          </span>{' '}
          → el comensal tocó el botón "Pedir la cuenta".
        </li>
      </Bullets>

      <H3>Vista detalle de una mesa</H3>
      <P>Click en una mesa → vista detalle con:</P>
      <Bullets>
        <li>
          Header con total + botón <strong>Cobrar mesa</strong>.
        </li>
        <li>Lista de comensales (registrados con check ✓, anónimos como Guest #).</li>
        <li>Lista cronológica de comandas con sus ítems y estado.</li>
        <li>
          Botones contextuales por estado: Confirmar/Rechazar (pending), Empezar (accepted), Marcar
          entregado (ready).
        </li>
        <li>
          Menú de 3 puntos arriba con <strong>Marcar abandoned</strong> (mesa que se fue sin pagar).
        </li>
      </Bullets>

      <H3>Tu loop habitual</H3>
      <Steps>
        <li>
          Llega un ticket pending → revisás visualmente la mesa → <strong>Confirmar</strong>.
        </li>
        <li>
          Cocina lo prepara. Cuando lo marcan <Code>ready</Code>, lo retirás.
        </li>
        <li>
          Lo llevás a la mesa, click <strong>Marcar entregado</strong>. (Si te olvidás, no es drama,
          los puntos se calculan igual.)
        </li>
        <li>
          Cuando piden la cuenta, click <strong>Cobrar mesa</strong> → desglose por comensal con sus
          puntos → <strong>Confirmar cobro</strong>.
        </li>
      </Steps>

      <Tip>
        Tu pantalla se actualiza en <strong>tiempo real</strong> (Supabase Realtime). No necesitás
        recargar manualmente.
      </Tip>
    </div>
  )
}

function SectionCocina({ slug }: { slug: string }) {
  return (
    <div>
      <H2>Panel de cocina (KDS)</H2>
      <P>
        Pensado para tener una tablet en cocina abierta toda la noche. URL:{' '}
        <a href={`/${slug}/cocina`} className="text-primary underline">
          /{slug}/cocina
        </a>
        .
      </P>

      <H3>Cómo funciona</H3>
      <P>
        Cada comanda confirmada por el mozo aparece como una card. Cards ordenadas por antigüedad
        (la más vieja arriba). Cada card muestra:
      </P>
      <Bullets>
        <li>
          Número de comanda + tiempo transcurrido (<em>"hace 3 min"</em>).
        </li>
        <li>
          Estado: <Code>accepted</Code> (no empezada) o <Code>preparing</Code>.
        </li>
        <li>Lista de ítems con cantidades y notas del comensal (sin cebolla, bien frío).</li>
        <li>Botón "Sin stock" sobre cada ítem para cancelar uno solo si te quedaste sin él.</li>
      </Bullets>

      <H3>Tu loop</H3>
      <Steps>
        <li>
          Aparece comanda nueva (accepted) → click <strong>Empezar</strong> → pasa a preparing.
        </li>
        <li>Preparás los ítems.</li>
        <li>
          Cuando termina, click <strong>Listo</strong>. El mozo recibe la notificación y va a
          buscarlo.
        </li>
      </Steps>

      <H3>Sin stock</H3>
      <P>
        Si un ítem específico no se puede preparar (se acabó la mercadería), click "Sin stock" en
        ese ítem, agregás motivo, y se cancela <strong>solo ese ítem</strong>. El comensal recibe la
        notificación y el mozo también. El total de la comanda se ajusta automáticamente.
      </P>

      <Note>
        El KDS hoy es <strong>una sola vista global</strong>. Si querés separación por estación
        (cocina caliente vs barra vs postres), avisanos — está planeado pero fuera del MVP actual.
      </Note>
    </div>
  )
}

function SectionCobro() {
  return (
    <div>
      <H2>Cobro y puntos</H2>
      <P>
        Cuando el mozo marca la mesa como cobrada, el sistema dispara un cálculo atómico que cierra
        la sesión y procesa puntos para todos los registrados.
      </P>

      <H3>Qué pasa al cobrar</H3>
      <Steps>
        <li>El mozo confirma el cobro desde el dialog "Cobrar mesa".</li>
        <li>
          El sistema lockea la sesión y crea una <Code>visit</Code> por cada comensal registrado.
        </li>
        <li>
          Calcula puntos basándose en las reglas activas del bar y los ítems que cada uno consumió.
        </li>
        <li>Inserta los puntos en el ledger inmutable (auditable).</li>
        <li>Avanza punch cards si corresponde (ver sección punch cards).</li>
        <li>
          Marca la sesión como <Code>paid</Code>.
        </li>
        <li>Rota el qr_token de la mesa física (escaneos viejos quedan invalidados).</li>
      </Steps>

      <H3>Reglas de puntos</H3>
      <P>Los puntos se calculan con reglas configurables. Hay dos tipos:</P>
      <Bullets>
        <li>
          <strong>Por monto</strong> (<Code>per_amount</Code>): cada $X gastados → Y puntos. Ej:
          cada $1.000 → 10 puntos.
        </li>
        <li>
          <strong>Por ítem</strong> (<Code>per_item</Code>): consumir cierto ítem o categoría suma N
          puntos extra.
        </li>
      </Bullets>

      <H3>Items compartidos</H3>
      <P>
        Si un ítem se marca como <strong>shared</strong> (cocina mesa, sin atribución), no genera
        puntos para nadie. La regla evita peleas: los puntos se asignan al guest que originó el
        pedido.
      </P>
    </div>
  )
}

function SectionPunch({ slug }: { slug: string }) {
  return (
    <div>
      <H2>Punch cards</H2>
      <P>
        Las punch cards son tarjetas perforadas digitales: <em>"5 cafés y el sexto gratis"</em>.
        Existen en paralelo al sistema de puntos.
      </P>

      <H3>Cómo crear una</H3>
      <Steps>
        <li>
          Primero necesitás un <strong>reward</strong> (premio canjeable). Andá a{' '}
          <a href={`/${slug}/configuracion/puntos`} className="text-primary underline">
            Configuración → Puntos
          </a>{' '}
          y creá uno (ej: "Café gratis", costo 0 puntos).
        </li>
        <li>
          Andá a{' '}
          <a href={`/${slug}/configuracion/punch-cards`} className="text-primary underline">
            Configuración → Punch cards
          </a>{' '}
          → "Nueva punch card".
        </li>
        <li>
          Configurá: nombre ("5 cafés = 1 gratis"), descripción opcional, threshold (5), trigger
          (qué cuenta como un stamp), reward (qué se gana al completar).
        </li>
        <li>
          El trigger puede ser por <strong>ítem específico</strong> (solo capuchino), por{' '}
          <strong>categoría</strong> (cualquier ítem de "Café") o por <strong>tag</strong>{' '}
          (cualquier ítem con #cafe).
        </li>
      </Steps>

      <H3>Cómo se ve para el cliente</H3>
      <P>
        Cuando un comensal registrado completa una sesión, su tarjeta avanza automáticamente según
        los ítems que consumió. En la pantalla de cierre ve una barra de progreso (
        <em>"3 de 5 stamps"</em>). Cuando llega a 5, la card se marca completada y se genera un
        reward canjeable pendiente.
      </P>

      <Tip>
        Las punch cards <strong>no son mutuamente excluyentes</strong> con los puntos genéricos. Un
        mismo café puede sumar 1 stamp en la card y a la vez 10 puntos al wallet.
      </Tip>
    </div>
  )
}

function SectionEquipo({ slug }: { slug: string }) {
  return (
    <div>
      <H2>Gestionar equipo</H2>
      <P>
        Como owner, vos creás las cuentas para tus mozos, cocineros y cajeros desde{' '}
        <a href={`/${slug}/configuracion/equipo`} className="text-primary underline">
          Configuración → Equipo
        </a>
        .
      </P>

      <H3>Crear un miembro</H3>
      <Steps>
        <li>
          Llenás el form: email + password (auto-generada con un click) + rol + nombre opcional.
        </li>
        <li>
          Click <strong>Crear miembro</strong>. El sistema:
        </li>
        <li>
          Si el email <strong>no existe</strong>: crea cuenta con email_confirm: true (sin
          confirmación necesaria) + asigna la membership.
        </li>
        <li>
          Si el email <strong>ya tiene cuenta</strong>: solo crea la membership, respeta su
          contraseña actual.
        </li>
        <li>
          Si Resend está configurado, le llega un email automático con sus credenciales y un link a
          /login.
        </li>
        <li>
          Si Resend NO está configurado, el toast te muestra las credenciales para que las copies y
          se las pases por WhatsApp.
        </li>
      </Steps>

      <H3>Cambiar rol o resetear contraseña</H3>
      <P>En la lista de miembros podés:</P>
      <Bullets>
        <li>Cambiar el rol con el dropdown al lado del nombre.</li>
        <li>
          Click el ⋯ → <strong>Resetear contraseña</strong> para asignar una nueva.
        </li>
        <li>
          Click el ⋯ → <strong>Remover del bar</strong> (no borra la cuenta auth, solo la
          membership).
        </li>
      </Bullets>

      <Note>
        El sistema te <strong>impide quedarte sin owners</strong>. Si solo hay un owner, no podés
        degradarlo ni removerlo.
      </Note>
    </div>
  )
}

function SectionAutoAccept({ slug }: { slug: string }) {
  return (
    <div>
      <H2>Auto-aceptación de comandas</H2>
      <P>
        Por default, cada comanda del comensal va a estado <Code>pending</Code> y el mozo tiene que
        confirmarla manualmente. Eso evita pedidos fantasma de bromistas. Pero si tu mozo está
        saturado, podés activar la <strong>auto-aceptación</strong>.
      </P>

      <H3>Configurar</H3>
      <P>
        Andá a{' '}
        <a href={`/${slug}/local/auto-aceptacion`} className="text-primary underline">
          Local → Auto-aceptación
        </a>
        .
      </P>
      <Bullets>
        <li>
          <strong>Toggle "Habilitar auto-aceptación"</strong>: activa el comportamiento.
        </li>
        <li>
          <strong>Cap de monto</strong> (opcional): comandas más caras que ese monto igual requieren
          confirmación. Útil para ediciones grandes.
        </li>
        <li>
          <strong>Cap de cantidad de ítems</strong>: idem pero por cantidad.
        </li>
      </Bullets>

      <H3>Timeouts de sesión</H3>
      <Bullets>
        <li>
          <strong>Horas para re-scan del comensal</strong>: si un guest está inactivo más de N
          horas, el sistema le pide re-escanear el QR para mandar nuevas comandas. Default: 2h.
        </li>
        <li>
          <strong>Horas para abandono automático</strong>: el cron diario marca como abandoned
          sesiones sin actividad &gt; N horas. Default: 8h.
        </li>
      </Bullets>
    </div>
  )
}

function SectionEmail() {
  return (
    <div>
      <H2>Email transaccional</H2>
      <P>
        HUB usa <strong>Resend</strong> para mandar emails (credenciales del staff, futuras
        notificaciones). Es opcional: el sistema funciona sin email, mostrando las credenciales en
        pantalla para copiar manualmente.
      </P>

      <H3>Setup</H3>
      <Steps>
        <li>
          Crear cuenta gratis en{' '}
          <a
            href="https://resend.com"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            resend.com
          </a>{' '}
          (3000 emails/mes free).
        </li>
        <li>Verificar tu dominio en Resend (4 records DNS — instrucciones en su UI).</li>
        <li>
          Setear las env vars en Vercel: <Code>RESEND_API_KEY=re_xxx</Code>,{' '}
          <Code>EMAIL_FROM=&quot;Hub &lt;invitaciones@tudominio.com&gt;&quot;</Code>.
        </li>
        <li>Redeploy del proyecto.</li>
      </Steps>

      <Note>
        Mientras Resend no está configurado, las acciones siguen funcionando — solo que las
        credenciales del staff te las copia al portapapeles para que se las pases por WhatsApp.
      </Note>

      <H3>Templates disponibles hoy</H3>
      <Bullets>
        <li>
          <strong>Credenciales del equipo</strong>: cuando creás un miembro nuevo, le llega un email
          con su email + password + rol + link a /login.
        </li>
      </Bullets>
    </div>
  )
}

function SectionFaq() {
  return (
    <div>
      <H2>Preguntas frecuentes</H2>

      <H3>El comensal no ve la carta cuando escanea</H3>
      <P>
        Verificá que la mesa esté <strong>activa</strong> (en Configuración → Mesas, sin el badge
        gris "Inactiva"). Verificá también que tu menú tenga al menos una categoría con ítems
        activos. Si todo está OK y aún así no carga, pedí al comensal que pruebe en modo incógnito
        por si hay caché.
      </P>

      <H3>El mozo no ve "Sesiones" en su sidebar</H3>
      <P>
        El sidebar se filtra por rol. Si el mozo no ve Sesiones, probablemente quedó como{' '}
        <Code>cashier</Code> o <Code>kitchen</Code>. Andá a Equipo, edita su fila y cambia el rol a{' '}
        <Code>waiter</Code>.
      </P>

      <H3>Cobré una mesa pero el cliente no ve los puntos</H3>
      <P>
        Solo se asignan puntos si: el comensal estaba <strong>registrado</strong> en la sesión Y
        consumió <strong>al menos un ítem asignado a sí mismo</strong> (no compartido). Verificá en
        la pestaña "Mis órdenes" del comensal. Si todo eso se cumple, el balance se actualiza en su
        pantalla de cierre.
      </P>

      <H3>El qr_token cambió después de cobrar — ¿es normal?</H3>
      <P>
        Sí, es feature. Después de cobrar, el sistema rota el QR para invalidar URLs viejas. Como el
        QR físico impreso codifica el token, <strong>no necesitás reimprimir</strong> — solo afecta
        a comensales que ya tenían la URL abierta en su celular. La próxima persona que escane el
        sticker físico funciona normal.
      </P>

      <H3>El cocinero marcó "Sin stock" un ítem por error, ¿lo puedo revertir?</H3>
      <P>
        Hoy no se puede deshacer desde la UI. La fila queda como <Code>cancelled_at</Code> en la DB.
        Si necesitás, eliminá la cancelación manualmente desde Supabase Studio (no recomendado en
        producción) o el cocinero crea otro ítem manual desde el panel del mozo (Agregar comanda).
      </P>
    </div>
  )
}

function SectionSoporte() {
  return (
    <div>
      <H2>Soporte y límites del autoservicio</H2>
      <P>
        Algunas cosas las podés resolver vos solo desde la app, otras requieren que toques tu
        proveedor (Vercel, Supabase, Meta) o ayuda técnica. Acá está el mapa:
      </P>

      <H3>Lo que podés hacer solo</H3>
      <Bullets>
        <li>Crear, editar, eliminar mesas e imprimir QRs.</li>
        <li>Cargar y modificar tu menú.</li>
        <li>Configurar reglas de puntos y punch cards.</li>
        <li>Invitar / dar de baja miembros del equipo.</li>
        <li>Resetear contraseñas de tu staff.</li>
        <li>Activar y configurar la auto-aceptación.</li>
        <li>Ver estadísticas, audiencias, segmentar clientes.</li>
        <li>Gestionar bandeja de WhatsApp/Instagram (si tu canal está conectado).</li>
      </Bullets>

      <H3>Lo que requiere ayuda externa</H3>
      <Bullets>
        <li>
          <strong>Configurar el dominio para emails</strong> (Resend): pegar 4 records DNS en
          Vercel/Cloudflare. Se hace una sola vez. Si no sabés cómo, te ayudamos.
        </li>
        <li>
          <strong>Conectar WhatsApp Business / Instagram</strong>: requiere Meta Business Manager y
          tokens. Lo hacemos juntos en una llamada.
        </li>
        <li>
          <strong>Configurar pasarela de pago</strong> (Mercado Pago, Stripe, etc.): no incluido en
          el MVP. El cobro hoy lo registra el mozo manualmente en el panel.
        </li>
        <li>
          <strong>Backups de la base de datos</strong>: Supabase tiene backups automáticos diarios
          en plan Pro. Si estás en Free, agendamos un export semanal.
        </li>
        <li>
          <strong>Hosting / SSL del dominio</strong>: lo manejamos en Vercel. Si tu dominio cambia o
          el SSL falla, contactanos.
        </li>
      </Bullets>

      <Note>
        Para cualquier consulta técnica, contactanos por el canal que coordinamos. Tenemos logs
        completos en Supabase y Vercel para debuggear cualquier problema reportado.
      </Note>
    </div>
  )
}
