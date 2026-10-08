'use client'

import { Folder, Lock, Save, X } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { DEFAULT_MOCK_DATA } from '../arca-guide-model'
import { BrowserFrame } from './browser-frame'
import { LegacyPanel, LegacyRow, LegacyScreen, LegacySidebar, WelcomeBox } from './legacy-screen'
import { MisComprobantesScreen } from './mis-comprobantes-screen'
import { useMockData } from './mock-data'
import { ArcaModal, GridBackdrop } from './modal'
import { ArcaWordmark, PortalScreen, PortalSearchResult } from './portal-screen'
import {
  MockButton,
  MockDownloadIcon,
  MockFile,
  MockGear,
  MockInput,
  MockSelect,
} from './primitives'
import { ScaledMock } from './scaled-mock'
import { Spotlight, WrongMark } from './spotlight'

/**
 * Las pantallas de ARCA armadas (diseño §5.1.2), cada una con su marco, su descripción para
 * lectores y sus «Tocá acá». Los textos de botones y campos son los de `arca-pasos.md`; donde
 * la investigación dice «A CONFIRMAR», la pantalla lleva el sello «Puede verse distinto».
 * Los datos del bar salen de `MockDataProvider` (razón social, CUIT, alias, pedido).
 */

type ScreenProps = { caption?: ReactNode }

/** El globito de abajo, alineado al borde derecho del control (los botones de la derecha). */
const BUBBLE_RIGHT = { left: 'auto', right: 0, transform: 'none' } as const

/**
 * El alto de «Incorporar nueva Relación» según lo que se resalta: con el globito abajo del
 * «BUSCAR» hace falta lugar debajo de la fila, y el representante de un web service ocupa
 * tres renglones (el «CONFIRMAR» no puede quedar cortado).
 */
const NUEVA_RELACION_HEIGHT = {
  buscarServicio: 336,
  buscarRepresentante: 392,
  confirmar: 384,
} as const

// ─── Portal nuevo ────────────────────────────────────────────────────────────

/** P-02 · «Ingresar con Clave Fiscal». */
export function ScreenLogin({ caption }: ScreenProps) {
  return (
    <ScaledMock
      height={406}
      label="Pantalla de ARCA «Ingresar con Clave Fiscal»: campo CUIT/CUIL y botón Siguiente. Escribí tu CUIT personal."
      caption={caption}
    >
      <BrowserFrame url="auth.afip.gob.ar">
        <div
          className="flex h-full flex-col bg-[#131a3c]"
          style={{ fontFamily: 'Roboto, Arial, sans-serif' }}
        >
          <div className="flex h-[38px] shrink-0 items-center bg-[#262d52] px-5">
            <ArcaWordmark tone="white" />
          </div>
          <div className="flex flex-1 items-start justify-center pt-4">
            <div className="flex w-[280px] flex-col items-stretch gap-2 rounded-[6px] bg-[#f2f2f2] px-5 pb-4 pt-4 text-[#222]">
              <span className="flex items-center justify-center gap-2 text-[16px]">
                <Lock className="size-4" aria-hidden />
                Ingresar con Clave Fiscal
              </span>
              <span className="mt-1 text-[11px] font-medium">CUIT/CUIL</span>
              <Spotlight label="Tu CUIT personal" side="right" className="w-full" inset={3}>
                <MockInput placeholder="" size="lg" className="w-full border-[#5aa9e6]" />
              </Spotlight>
              <MockButton variant="portal" className="mt-1 w-full">
                Siguiente
              </MockButton>
              <span className="text-center text-[10.5px]">¿Olvidaste tu clave?</span>
              <span className="my-0.5 h-px bg-[#ddd]" />
              <MockButton variant="portalOutline" className="w-full">
                Obtené tu Clave Fiscal
              </MockButton>
              <span className="text-center text-[10.5px]">¿Qué es la Clave Fiscal?</span>
              <span className="text-center text-[10.5px]">Ayuda</span>
            </div>
          </div>
        </div>
      </BrowserFrame>
    </ScaledMock>
  )
}

/** P-03 · El portal con tus servicios y un ícono resaltado. */
export function ScreenPortalHome({
  caption,
  highlight = 'relaciones',
  highlightLabel,
}: ScreenProps & { highlight?: 'relaciones' | 'domicilio'; highlightLabel?: string }) {
  const label =
    highlight === 'relaciones'
      ? 'Portal de ARCA con tus servicios: el ícono «Administrador de relaciones» está resaltado.'
      : 'Portal de ARCA con tus servicios: el ícono «Domicilio Fiscal Electrónico» está resaltado.'
  return (
    <ScaledMock height={316} label={label} caption={caption}>
      <BrowserFrame>
        <PortalScreen
          highlight={highlight}
          highlightLabel={
            highlightLabel ?? (highlight === 'relaciones' ? 'Tocá acá' : 'Entrá y revisalo')
          }
        />
      </BrowserFrame>
    </ScaledMock>
  )
}

/** P-03 / PV-01 / C-01 / M-01 · Buscar un servicio en «¿Qué necesitás?». */
export function ScreenPortalSearch({
  caption,
  query,
  title,
  description,
}: ScreenProps & { query: string; title: string; description: string }) {
  return (
    <ScaledMock
      height={362}
      label={`Portal de ARCA: en el buscador está escrito «${query}» y aparece la tarjeta «${title}», resaltada.`}
      caption={caption}
    >
      <BrowserFrame>
        <PortalScreen query={query}>
          <PortalSearchResult title={title} description={description} />
        </PortalScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

// ─── Administrador de Relaciones ─────────────────────────────────────────────

/** P-04 (y C-02) · «Autoridad de Aplicación»: elegir a quién representás. */
export function ScreenAutoridad({
  caption,
  title = 'Administrador de Relaciones',
  approximate = false,
}: ScreenProps & { title?: string; approximate?: boolean }) {
  const data = useMockData()
  const sasOption = `${data.sasName} [${data.sasCuit}]`
  return (
    <ScaledMock
      height={300}
      label={`Pantalla «${title}» de ARCA: el desplegable «Seleccione» abierto, con la SAS resaltada.`}
      caption={caption}
      approximate={approximate}
    >
      <BrowserFrame>
        <LegacyScreen title={title} acting="none">
          <div className="flex flex-col items-center gap-2 bg-[#dcf0fb] px-3 pb-24 pt-2.5 text-[10.5px] text-black">
            <b>Autoridad de Aplicación</b>
            <span>Por favor seleccione el contribuyente para el que va a operar este servicio</span>
            <Spotlight label="Elegí la SAS" side="left" inset={3}>
              <MockSelect
                value="-- Seleccione --"
                open
                options={['-- Seleccione --', `${data.personName} [${data.personCuit}]`, sasOption]}
                selected={sasOption}
                className="w-[320px]"
              />
            </Spotlight>
          </div>
        </LegacyScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

/** P-05 · El menú del Administrador de Relaciones. */
export function ScreenMenuRelaciones({
  caption,
  highlight = 'nueva',
}: ScreenProps & { highlight?: 'nueva' | 'acting' }) {
  const rows: ReadonlyArray<{ text: ReactNode; button: string }> = [
    {
      text: (
        <>
          Utilizando el botón <b>"Adherir Servicio"</b> podrá asociar un servicio a su Clave Fiscal.
          Tenga en cuenta que el mismo no es válido para habilitar un servicio en representación de
          otra persona.
        </>
      ),
      button: 'ADHERIR SERVICIO',
    },
    {
      text: (
        <>
          Utilizando el botón <b>"Nueva Relación"</b> podrá generar nuevas autorizaciones para
          utilizar servicios.
        </>
      ),
      button: 'Nueva Relación',
    },
    {
      text: (
        <>
          Utilizando el botón <b>"Consultar"</b> podrá buscar las distintas relaciones existentes
          para su persona.
        </>
      ),
      button: 'CONSULTAR',
    },
  ]
  return (
    <ScaledMock
      height={318}
      label={
        highlight === 'nueva'
          ? 'Menú del Administrador de Relaciones de ARCA: el botón «Nueva Relación» está resaltado.'
          : 'Menú del Administrador de Relaciones de ARCA: arriba, la línea «Actuando en representación de» con la SAS, resaltada.'
      }
      caption={caption}
    >
      <BrowserFrame>
        <LegacyScreen
          title="Administrador de Relaciones"
          highlightActing={
            // A la izquierda, sobre la barra negra: abajo tapaba el título de la tabla y el
            // primer botón.
            highlight === 'acting' ? { label: 'Tiene que decir la SAS', side: 'left' } : undefined
          }
        >
          <LegacyPanel title="Servicio Administrador de Relaciones" className="text-[9.5px]">
            {rows.map((row) => (
              <div key={row.button} className="flex gap-[2px]">
                <div className="flex-1 bg-[#f1f9fe] px-2 py-[5px] leading-snug">{row.text}</div>
                <div className="flex w-[104px] shrink-0 items-center justify-center bg-[#f1f9fe]">
                  {highlight === 'nueva' && row.button === 'Nueva Relación' ? (
                    // A la izquierda, sobre el texto de su renglón: abajo la flecha tapaba
                    // «CONSULTAR», que es el botón equivocado.
                    <Spotlight label="Tocá «Nueva Relación»" side="left" inset={3}>
                      <MockButton>{row.button}</MockButton>
                    </Spotlight>
                  ) : (
                    <MockButton>{row.button}</MockButton>
                  )}
                </div>
              </div>
            ))}
          </LegacyPanel>
        </LegacyScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

/** P-06 / P-09 · «Incorporar nueva Relación». */
export function ScreenNuevaRelacion({
  caption,
  service,
  representative,
  highlight,
}: ScreenProps & {
  /** El servicio elegido (sin esto, «Presione Buscar…»). */
  service?: string
  /** El representante elegido; `undefined` = todavía no aparece la fila. */
  representative?: ReactNode | null
  highlight: 'buscarServicio' | 'buscarRepresentante' | 'confirmar'
}) {
  const data = useMockData()
  // El globito va abajo, alineado al botón: a la izquierda tapaba «Presione Buscar…».
  const buscar = (target: 'buscarServicio' | 'buscarRepresentante') =>
    highlight === target ? (
      <Spotlight label="Tocá «BUSCAR»" side="bottom" inset={3} bubbleStyle={BUBBLE_RIGHT}>
        <MockButton>BUSCAR</MockButton>
      </Spotlight>
    ) : (
      <MockButton>BUSCAR</MockButton>
    )
  const label =
    highlight === 'buscarServicio'
      ? 'Pantalla «Incorporar nueva Relación»: el botón BUSCAR de la fila Servicio está resaltado.'
      : highlight === 'buscarRepresentante'
        ? `Pantalla «Incorporar nueva Relación» con el servicio ${service ?? ''} elegido: el botón BUSCAR de la fila Representante está resaltado.`
        : 'Pantalla «Incorporar nueva Relación» completa: el botón CONFIRMAR está resaltado.'
  return (
    <ScaledMock height={NUEVA_RELACION_HEIGHT[highlight]} label={label} caption={caption}>
      <BrowserFrame>
        <LegacyScreen title="Administrador de Relaciones">
          <LegacyPanel title="Incorporar nueva Relación">
            <LegacyRow
              label="Autorizante (Dador)"
              value={
                <b className="truncate">
                  {data.sasName} [{data.sasCuit}]
                </b>
              }
            />
            <LegacyRow
              label="Representado"
              value={
                <MockSelect
                  value={`${data.sasName} [${data.sasCuit}]`}
                  muted
                  size="sm"
                  className="w-[230px]"
                />
              }
            />
            <LegacyRow
              label="Servicio"
              value={
                service ? (
                  <span className="leading-snug">
                    {service} (Nivel de seguridad mínimo requerido 3)
                  </span>
                ) : (
                  'Presione Buscar para seleccionar el servicio'
                )
              }
              action={buscar('buscarServicio')}
            />
            {representative !== undefined ? (
              <LegacyRow
                label="Representante"
                value={representative ?? 'Presione Buscar para seleccionar el Representante'}
                action={buscar('buscarRepresentante')}
              />
            ) : null}
            {representative ? (
              <div className="flex justify-center bg-[#f1f9fe] py-2">
                {highlight === 'confirmar' ? (
                  <Spotlight label="Tocá «CONFIRMAR»" side="right" inset={3}>
                    <MockButton>CONFIRMAR</MockButton>
                  </Spotlight>
                ) : (
                  <MockButton>CONFIRMAR</MockButton>
                )}
              </div>
            ) : null}
          </LegacyPanel>
        </LegacyScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

type TreeService = { readonly name: string; readonly description: string }

/** P-07 · «Selección de Servicio a Habilitar»: el árbol de ARCA con el servicio resaltado. */
export function ScreenArbolServicios({
  caption,
  folder,
  service,
  before = [],
  after = [],
  wrong,
  approximate = false,
}: ScreenProps & {
  folder: 'Servicios Interactivos' | 'WebServices'
  service: TreeService
  before?: readonly TreeService[]
  after?: readonly TreeService[]
  /** El que está al lado y NO hay que elegir. */
  wrong?: TreeService
  approximate?: boolean
}) {
  const item = (s: TreeService, mark?: 'target' | 'wrong') => {
    const body = (
      <span className="flex items-start gap-2">
        <MockGear className="mt-[2px]" />
        <span className="flex flex-col leading-tight">
          <span className="text-[12px] font-bold text-[#6b6b6b]">{s.name}</span>
          <span className="text-[11px] text-black">{s.description}</span>
        </span>
      </span>
    )
    // `self-start`: el anillo abraza el servicio (no todo el ancho del árbol) y el «✕ Este no»
    // entra en el dibujo.
    if (mark === 'target') {
      return (
        <Spotlight key={s.name} label="Elegí este" side="left" inset={4} className="self-start">
          {body}
        </Spotlight>
      )
    }
    if (mark === 'wrong') {
      return (
        <WrongMark key={s.name} label="Este no" className="self-start">
          {body}
        </WrongMark>
      )
    }
    return <span key={s.name}>{body}</span>
  }
  return (
    <ScaledMock
      height={352}
      label={`Árbol de servicios de ARCA: ARCA › ${folder} › «${service.name}», resaltado.${wrong ? ` Justo arriba está «${wrong.name}», que no es el correcto.` : ''}`}
      caption={caption}
      approximate={approximate}
    >
      <BrowserFrame>
        <div className="flex h-full bg-white">
          <LegacySidebar />
          <div className="min-w-0 flex-1 px-4 pt-3">
            <div className="flex flex-col gap-2 border border-[#d4d4d4] px-3 py-3">
              <span className="flex h-[30px] w-[190px] items-center rounded-[3px] bg-gradient-to-b from-[#f4f4f4] to-[#c9c9c9] px-3 text-[9px] font-bold uppercase leading-tight text-[#3a4a6b] shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                Agencia provincial de recaudación
              </span>
              <span
                className="flex h-[38px] w-[190px] items-center rounded-[3px] bg-gradient-to-b from-[#f4f4f4] to-[#c4c4c4] px-3 text-[24px] font-black leading-none text-[#2b3a5e] shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                style={{ fontFamily: '"Arial Black", Arial, sans-serif' }}
              >
                ARCA
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-black">
                <Folder className="size-3.5 text-[#8a8a8a]" aria-hidden />
                Servicios Interactivos
              </span>
              {folder === 'WebServices' ? (
                <span className="flex items-center gap-1.5 text-[12px] text-black">
                  <Folder className="size-3.5 text-[#8a8a8a]" aria-hidden />
                  WebServices
                </span>
              ) : null}
              <span className="flex flex-col gap-2.5 pl-6">
                {before.map((s) => item(s))}
                {wrong ? item(wrong, 'wrong') : null}
                {item(service, 'target')}
                {after.map((s) => item(s))}
                <span className="pl-6 text-[12px] text-[#999]">…</span>
              </span>
            </div>
          </div>
        </div>
      </BrowserFrame>
    </ScaledMock>
  )
}

/** P-08a · «Selección del Representante a autorizar» de un servicio interactivo (una persona). */
export function ScreenRepresentantePersona({
  caption,
  service,
}: ScreenProps & { service: string }) {
  return (
    <ScaledMock
      height={318}
      label={`Pantalla «Selección del Representante a autorizar» para ${service}: el campo CUIT/CUIL/CDI Usuario, BUSCAR y CONFIRMAR resaltados en orden.`}
      caption={caption}
    >
      <BrowserFrame>
        <LegacyScreen title="Administrador de Relaciones">
          <LegacyPanel title="Selección del Representante a autorizar" className="text-[9.5px]">
            <div className="bg-[#f1f9fe] px-2 py-[6px] leading-snug">
              Esta generando una nueva autorizacion para el servicio{' '}
              <b>{service} (Nivel de seguridad mínimo requerido 3)</b>. El servicio que seleccionó
              es un servicio interactivo. Para hacer efectiva la autorización deberá designar a una
              persona Física con Clave Fiscal habilitada.
            </div>
            <div className="flex gap-[2px]">
              <div className="flex w-[118px] shrink-0 items-center bg-[#e6f4fc] px-2 py-[7px]">
                CUIT/CUIL/CDI Usuario
              </div>
              <div className="flex flex-1 flex-col gap-1.5 bg-[#f1f9fe] px-2 py-[7px]">
                {/* Arriba, sobre el texto largo de ARCA: a la derecha chocaba con «BUSCAR». */}
                <Spotlight n={1} label="Tu CUIT" side="top" inset={3} className="self-start">
                  <MockInput placeholder="" size="sm" className="w-[120px]" />
                </Spotlight>
                <span className="flex items-center gap-1">
                  <span className="size-[10px] border border-[#777] bg-white" />
                  El usuario es Externo (Podrá delegar este servicio)
                </span>
              </div>
              <div className="flex w-[86px] shrink-0 items-center justify-center bg-[#f1f9fe]">
                <Spotlight n={2} inset={3}>
                  <MockButton>BUSCAR</MockButton>
                </Spotlight>
              </div>
            </div>
            <div className="flex justify-center bg-[#f1f9fe] py-2">
              <Spotlight n={3} inset={3}>
                <MockButton>CONFIRMAR</MockButton>
              </Spotlight>
            </div>
          </LegacyPanel>
        </LegacyScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

/** P-08b · «Selección del Representante a autorizar» de un web service (el Computador Fiscal). */
export function ScreenComputadorFiscal({ caption, service }: ScreenProps & { service: string }) {
  const data = useMockData()
  return (
    <ScaledMock
      height={436}
      label={`Pantalla «Selección del Representante a autorizar» para ${service}: el desplegable «Computador Fiscal» con el alias ${data.alias} elegido y el botón CONFIRMAR resaltados.`}
      caption={caption}
    >
      <BrowserFrame>
        <LegacyScreen title="Administrador de Relaciones">
          <LegacyPanel title="Selección del Representante a autorizar" className="text-[9.5px]">
            <div className="bg-[#f1f9fe] px-2 py-[6px] leading-snug">
              Esta generando una nueva autorizacion para el servicio{' '}
              <b>{service} (Nivel de seguridad mínimo requerido 3)</b>. El servicio que seleccionó
              es un WebService. Para hacer efectiva la autorización deberá determinar un Computador
              Fiscal habilitado y asociado a la persona que esta Ud. representando, o bien designar
              a otra persona que si tenga un Computador Fiscal.
            </div>
            <div className="bg-[#f1f9fe] px-2 py-[5px]">
              La persona {data.sasName} [{data.sasCuit}] lo ha autorizado para delegar este servicio
              en su nombre.
            </div>
            <div className="flex gap-[2px]">
              <div className="flex w-[118px] shrink-0 items-center bg-[#e6f4fc] px-2 py-[7px]">
                Computador Fiscal
              </div>
              <div className="flex flex-1 items-center justify-center bg-[#f1f9fe] px-2 py-[7px]">
                {/* Abajo, sobre el texto de delegar a un tercero (que no se usa): a la izquierda
                    tapaba «Computador Fiscal» y a la derecha se salía del dibujo. */}
                <Spotlight
                  n={1}
                  label="Elegí tu alias"
                  side="bottom"
                  inset={3}
                  bubbleStyle={{ transform: 'translateX(-60%)' }}
                >
                  <MockSelect value={data.alias} size="sm" className="w-[200px]" />
                </Spotlight>
              </div>
            </div>
            <div className="flex gap-[2px]">
              <div className="flex w-[118px] shrink-0 items-center bg-[#e6f4fc] px-2 py-[7px]">
                CUIT/CUIL/CDI Usuario
              </div>
              <div className="flex flex-1 flex-col gap-1 bg-[#f1f9fe] px-2 py-[6px]">
                <MockInput placeholder="" size="sm" className="w-[110px] opacity-60" />
                <span className="leading-snug">
                  Puede delegar el WebService a un tercero que lo ejecute en su nombre. El tercero
                  debera tener un Computador Fiscal habilitado.
                </span>
              </div>
              <div className="flex w-[86px] shrink-0 items-center justify-center bg-[#f1f9fe]">
                <MockButton>BUSCAR</MockButton>
              </div>
            </div>
            <div className="flex justify-center bg-[#f1f9fe] py-2">
              {/* A la izquierda: a la derecha el globito se salía del dibujo. */}
              <Spotlight n={2} label="Después, «CONFIRMAR»" side="left" inset={3}>
                <MockButton>CONFIRMAR</MockButton>
              </Spotlight>
            </div>
          </LegacyPanel>
        </LegacyScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

// ─── Puntos de venta ─────────────────────────────────────────────────────────

/** PV-02 y PV-03 · Elegir la SAS y entrar a «A/B/M de Puntos de Venta» (sin captura: aproximada). */
export function ScreenPvMenu({ caption }: ScreenProps) {
  const data = useMockData()
  return (
    <ScaledMock
      height={260}
      approximate
      label={`Administración de Puntos de Venta y Domicilios de ARCA: arriba, la SAS ${data.sasName} elegida; abajo, la opción «A/B/M de Puntos de Venta» resaltada.`}
      caption={caption}
    >
      <BrowserFrame>
        <GridBackdrop>
          <div className="px-6 pt-4">
            <div className="rounded-[3px] bg-[#6f97bf] px-3 py-1.5 text-[13px] text-white">
              Administración de Puntos de Venta y Domicilios
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-[3px] bg-white px-3 py-2 text-[12px] text-black shadow-[0_1px_2px_rgba(0,0,0,0.15)]">
              <span className="text-[#555]">Contribuyente:</span>
              {/* Los márgenes dejan el número del anillo fuera del texto y de «Contribuyente:». */}
              <Spotlight n={1} label="La SAS" side="right" inset={3} className="ml-2">
                <b className="pl-2.5">
                  {data.sasName} [{data.sasCuit}]
                </b>
              </Spotlight>
            </div>
            <div className="mt-3 flex flex-col gap-1.5 rounded-[3px] bg-white px-3 py-2.5 text-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.15)]">
              <Spotlight n={2} label="Tocá esta opción" side="right" inset={3} className="w-fit">
                <span className="font-bold text-[#1d3a5f] underline">A/B/M de Puntos de Venta</span>
              </Spotlight>
              <span className="text-[#1d3a5f] underline">Consultas</span>
            </div>
          </div>
        </GridBackdrop>
      </BrowserFrame>
    </ScaledMock>
  )
}

/** Los puntos de venta de ejemplo del listado (los que ya usa otro sistema). */
const PV_ROWS = [
  { n: '1', name: 'LOCAL', system: 'Controlador Fiscal' },
  { n: '2', name: 'LOCAL', system: 'Comprobantes en línea' },
] as const

function PvListado({ dim = false }: { dim?: boolean }) {
  const table = (
    <div className="grid w-full grid-cols-[70px_150px_minmax(0,1fr)] gap-px bg-[#b8b8b8] text-[11px]">
      {['Número', 'Nombre Fantasía', 'Sistema'].map((h) => (
        <span key={h} className="bg-[#cfcfcf] px-2 py-1 font-bold text-black">
          {h}
        </span>
      ))}
      {PV_ROWS.map((row) => (
        <Fragment key={row.n}>
          <span className="bg-[#e8f0f6] px-2 py-1 text-right">{row.n}</span>
          <span className="bg-[#e8f0f6] px-2 py-1">{row.name}</span>
          <span className="bg-[#e8f0f6] px-2 py-1">{row.system}</span>
        </Fragment>
      ))}
    </div>
  )
  return (
    <div className={cn('px-6 pt-4', dim && 'opacity-60')}>
      <div className="rounded-[3px] bg-[#6f97bf] px-3 py-1.5 text-[13px] text-white">
        Listado de Puntos de Venta / Emisión
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {['Filtro..', 'Orden..'].map((b) => (
          <MockButton key={b} variant="modal" className="text-[11px]">
            {b}
          </MockButton>
        ))}
        {dim ? (
          <MockButton variant="modal" className="text-[11px]">
            Agregar
          </MockButton>
        ) : (
          <Spotlight n={2} label="Después, «Agregar»" side="right" inset={3}>
            <MockButton variant="modal" className="text-[11px]">
              Agregar
            </MockButton>
          </Spotlight>
        )}
      </div>
      <div className="mt-2.5 rounded-[2px] bg-white/70 px-2 py-1 text-[11px] text-black">
        Página: 1 de 1
      </div>
      <div className="mt-2">
        {dim ? (
          table
        ) : (
          // El anillo abraza toda la lista y el globito va abajo: sobre el «1» de la primera
          // fila, el número del anillo y la flecha tapaban justo lo que hay que anotar.
          <Spotlight n={1} label="Anotá los que ya hay" side="bottom" inset={3} className="w-full">
            {table}
          </Spotlight>
        )}
      </div>
    </div>
  )
}

/** PV-04 · «Listado de Puntos de Venta / Emisión». */
export function ScreenPvListado({ caption }: ScreenProps) {
  return (
    <ScaledMock
      height={320}
      approximate
      label="Listado de Puntos de Venta de ARCA: los números que ya existen y el botón «Agregar», resaltados."
      caption={caption}
    >
      <BrowserFrame>
        <GridBackdrop>
          <PvListado />
        </GridBackdrop>
      </BrowserFrame>
    </ScaledMock>
  )
}

/**
 * PV-05 · «Alta de Punto de Venta / Emisión» con «RECE para aplicativo y web services». La
 * captura es de feb-2025: desde la RG 5824 (01/07/2026) el alta puede pedir también la
 * actividad (A CONFIRMAR en `arca-pasos.md`), por eso lleva el sello.
 */
export function ScreenPvAlta({ caption }: ScreenProps) {
  const data = useMockData()
  const field = (label: string, control: ReactNode) => (
    <div className="flex items-center gap-3">
      <span className="w-[140px] shrink-0 text-right text-[13px] font-bold text-[#222]">
        {label}
      </span>
      {control}
    </div>
  )
  return (
    <ScaledMock
      height={412}
      approximate
      label="Ventana «Alta de Punto de Venta / Emisión» de ARCA: el campo Sistema con «RECE para aplicativo y web services» resaltado, y Nuevo domicilio con el local."
      caption={caption}
    >
      <BrowserFrame>
        <GridBackdrop>
          <PvListado dim />
          <div className="absolute inset-0 bg-black/15" />
          <div className="absolute left-[56px] top-[22px] w-[600px]">
            <ArcaModal
              title="Alta de Punto de Venta / Emisión"
              footer={
                <>
                  <MockButton variant="modal">
                    <Save className="size-3.5 text-[#d11]" aria-hidden />
                    Aceptar
                  </MockButton>
                  <MockButton variant="modal">
                    <X className="size-3.5 text-[#d11]" strokeWidth={3} aria-hidden />
                    Cancelar
                  </MockButton>
                </>
              }
            >
              <div className="border border-[#d4d4d4] bg-[#f7f7f7] px-2 py-1.5 text-[11px] uppercase leading-snug text-black">
                <span className="text-[#e01b1b]">Atencion:</span> En caso que no se visualice el
                domicilio debera concurrir a la dependencia a regularizar la situacion.
              </div>
              <div className="mt-3 flex flex-col gap-2.5 border border-[#d4d4d4] px-3 py-3">
                {field(
                  'Número:',
                  <MockInput value={data.pointOfSale || '4'} className="w-[90px]" />,
                )}
                {field('Nombre Fantasía:', <MockInput value="Plataforma" className="w-[300px]" />)}
                {field('Dominio Asociado:', <MockInput className="w-[170px]" />)}
                {field(
                  'Sistema:',
                  <Spotlight n={1} label="Elegí este" side="right" inset={3}>
                    <MockSelect value="RECE para aplicativo y web services" className="w-[270px]" />
                  </Spotlight>,
                )}
                {field(
                  'Nuevo domicilio:',
                  <Spotlight n={2} label="El local" side="right" inset={3}>
                    <MockSelect value="-- Seleccionar --" className="w-[270px]" />
                  </Spotlight>,
                )}
              </div>
            </ArcaModal>
          </div>
        </GridBackdrop>
      </BrowserFrame>
    </ScaledMock>
  )
}

/** Paso 3 · «Regímenes de Facturación y Registración» (sin captura vigente: aproximada). */
export function ScreenFacturaA({ caption }: ScreenProps) {
  return (
    <ScaledMock
      height={262}
      approximate
      label="Servicio «Regímenes de Facturación y Registración» de ARCA: la opción «Habilitación de Comprobantes» resaltada."
      caption={caption}
    >
      <BrowserFrame>
        <LegacyScreen title="Regímenes de Facturación y Registración (REAR/RECE/RFI)">
          <LegacyPanel title="Seleccione una opción">
            <div className="flex flex-col gap-2 bg-[#f1f9fe] px-3 py-3 text-[11px]">
              <Spotlight label="Tocá acá" side="right" inset={3} className="w-fit">
                <span className="font-bold text-[#0e5a8a] underline">
                  Habilitación de Comprobantes
                </span>
              </Spotlight>
              <span className="text-[#0e5a8a] underline">Solvencia como Componente de Empresa</span>
              <span className="text-[#0e5a8a] underline">Consultas</span>
            </div>
          </LegacyPanel>
        </LegacyScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

// ─── Certificados digitales ──────────────────────────────────────────────────

/** C-03 / C-05 · La lista «Certificados» (vacía la primera vez, o con tu alias). */
export function ScreenCertLista({
  caption,
  withAlias = false,
}: ScreenProps & { withAlias?: boolean }) {
  const data = useMockData()
  return (
    <ScaledMock
      height={286}
      label={
        withAlias
          ? `Lista «Certificados» de ARCA con el alias ${data.alias}: el link «Ver» está resaltado.`
          : 'Lista «Certificados» de ARCA, vacía: el botón «Agregar alias» está resaltado.'
      }
      caption={caption}
    >
      <BrowserFrame>
        <LegacyScreen title="Administración de Certificados Digitales">
          <div className="mx-auto flex w-[230px] flex-col items-center gap-1 text-[11px] text-black">
            <span className="w-full bg-[#dcf0fb] py-2 text-center font-bold">Certificados</span>
            <span className="grid w-full grid-cols-2 text-center font-bold">
              <span className="bg-[#dcf0fb] py-[3px]">Alias</span>
              <span className="bg-[#dcf0fb] py-[3px]">Ver Detalle</span>
            </span>
            {withAlias ? (
              <span className="grid w-full grid-cols-2 text-center">
                <span className="py-[3px]">{data.alias}</span>
                <span className="py-[3px]">
                  <Spotlight label="Tocá «Ver»" side="right" inset={2}>
                    <span className="font-bold text-[#777]">Ver</span>
                  </Spotlight>
                </span>
              </span>
            ) : (
              <span className="h-[18px]" />
            )}
            <span className="mt-1.5 flex gap-1.5">
              {withAlias ? (
                <MockButton>Agregar alias</MockButton>
              ) : (
                <Spotlight label="Tocá «Agregar alias»" side="left" inset={3}>
                  <MockButton>Agregar alias</MockButton>
                </Spotlight>
              )}
              <MockButton>VOLVER</MockButton>
            </span>
          </div>
        </LegacyScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

/** C-04 · «Usted está solicitando un certificado…»: CUIT de la SAS, alias y el .csr. */
export function ScreenCertAgregar({ caption }: ScreenProps) {
  const data = useMockData()
  return (
    <ScaledMock
      height={370}
      label={`Pantalla de ARCA para pedir un certificado: la CUIT de la SAS (${data.sasCuit}), el alias ${data.alias}, el archivo ${data.csrFileName} y el botón «Agregar alias», resaltados en orden.`}
      caption={caption}
    >
      <BrowserFrame>
        <LegacyScreen
          title="Administración de Certificados Digitales"
          contentClassName="ml-0 w-[372px]"
        >
          <div className="flex flex-col gap-[3px] text-[11px] text-black">
            <span className="bg-[#dcf0fb] py-2 text-center font-bold">
              Usted está solicitando un certificado con las siguientes características
            </span>
            <span className="flex items-center gap-2">
              <span className="w-[46px] bg-[#dcf0fb] py-1.5 text-center font-bold">CUIT</span>
              <Spotlight n={1} label="La de la SAS" side="right" inset={2}>
                <b className="pl-2.5 pr-1">{data.sasCuit}</b>
              </Spotlight>
            </span>
            <span className="flex items-center gap-2">
              <span className="w-[46px] bg-[#dcf0fb] py-1.5 text-center font-bold">Alias</span>
              <Spotlight n={2} label="El alias" side="right" inset={2}>
                <MockInput value={data.alias} size="sm" className="w-[190px]" />
              </Spotlight>
            </span>
            <span className="mt-2 text-center text-[10.5px]">
              Para obtener un nuevo certificado, debe subir un CSR (Certificate Signing Request) en
              formato PKCS#10.
            </span>
            <span className="mt-1 flex justify-center">
              <Spotlight n={3} label="El .csr" side="right" inset={2}>
                <MockFile fileName={data.csrFileName} />
              </Spotlight>
            </span>
            <span className="mt-2.5 flex justify-center gap-1.5">
              <Spotlight n={4} inset={3}>
                <MockButton>Agregar alias</MockButton>
              </Spotlight>
              <MockButton>VOLVER</MockButton>
            </span>
          </div>
        </LegacyScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

/** C-06 · El detalle del alias: DN, estado VALIDO y el ícono de «Descargar». */
export function ScreenCertDetalle({
  caption,
  highlight = 'descargar',
  approximate = false,
}: ScreenProps & { highlight?: 'descargar' | 'agregarCertificado'; approximate?: boolean }) {
  const data = useMockData()
  // Sin la CUIT cargada, «SERIALNUMBER=CUIT CUIT DE LA SAS» parecía un error de tipeo.
  const dnCuit =
    data.sasCuitDigits === DEFAULT_MOCK_DATA.sasCuitDigits ? 'DE LA SAS' : data.sasCuitDigits
  return (
    <ScaledMock
      height={300}
      approximate={approximate}
      label={
        highlight === 'descargar'
          ? `Detalle del certificado ${data.alias} en ARCA: el DN con la CUIT de la SAS, estado VALIDO y el ícono «Descargar» resaltado.`
          : `Detalle del certificado ${data.alias} en ARCA: el botón «Agregar certificado» resaltado.`
      }
      caption={caption}
    >
      <BrowserFrame>
        <LegacyScreen title="Administración de Certificados Digitales">
          <div className="flex flex-col items-center gap-3 text-[11px] text-black">
            <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-[2px] self-start pl-6">
              <span className="bg-[#dcf0fb] px-1.5 font-bold">CUIT</span>
              <span>{data.sasCuitDigits}</span>
              <span className="bg-[#dcf0fb] px-1.5 font-bold">Alias</span>
              <span>{data.alias}</span>
              <span className="bg-[#dcf0fb] px-1.5 font-bold">DN</span>
              <span className="truncate">
                SERIALNUMBER=CUIT {dnCuit}, CN={data.alias}
              </span>
            </span>
            <span className="grid grid-cols-[auto_auto_auto_auto_auto] gap-x-[3px] gap-y-[2px] text-[10.5px]">
              {['Nro Serie', 'Fecha Emision', 'Fecha Vencimiento', 'Estado', 'Descargar'].map(
                (h) => (
                  <span key={h} className="bg-[#dcf0fb] px-1.5 py-[2px] text-center font-bold">
                    {h}
                  </span>
                ),
              )}
              <span className="px-1 font-mono text-[10px]">5a1f…c9e2</span>
              <span className="px-1 text-[#555]">(hoy)</span>
              <span className="px-1 text-[#555]">(en 2 años)</span>
              <span className="px-1">VALIDO</span>
              <span className="flex justify-center">
                {highlight === 'descargar' ? (
                  <Spotlight
                    label="Bajá el certificado"
                    side="bottom"
                    inset={3}
                    bubbleStyle={BUBBLE_RIGHT}
                  >
                    <MockDownloadIcon />
                  </Spotlight>
                ) : (
                  <MockDownloadIcon />
                )}
              </span>
            </span>
            <span className="mt-1 flex gap-1.5">
              {highlight === 'agregarCertificado' ? (
                <Spotlight label="Para renovar" side="left" inset={3}>
                  <MockButton>Agregar certificado</MockButton>
                </Spotlight>
              ) : (
                <MockButton>Agregar certificado</MockButton>
              )}
              <MockButton>VOLVER</MockButton>
            </span>
          </div>
        </LegacyScreen>
      </BrowserFrame>
    </ScaledMock>
  )
}

// ─── Mis Comprobantes ────────────────────────────────────────────────────────

const MIS_COMPROBANTES_LABELS = {
  inicio:
    'Portada de «Mis Comprobantes» de ARCA: el aviso de que muestra hasta el día de ayer y las tarjetas Emitidos y Recibidos, con Recibidos resaltada.',
  consulta:
    'Consulta de «Comprobantes Recibidos»: el selector de fechas abierto con «Mes Pasado» resaltado, después «Aplicar» y el botón BUSCAR.',
  resultados:
    'Resultados de «Comprobantes Recibidos»: la botonera Excel, PDF y CSV, con CSV resaltado, y la tabla de comprobantes.',
} as const

/** M-03 a M-05 · Mis Comprobantes (portada, consulta y resultados). */
export function ScreenMisComprobantes({
  caption,
  step,
  approximate,
}: ScreenProps & { step: 'inicio' | 'consulta' | 'resultados'; approximate?: boolean }) {
  return (
    <ScaledMock
      height={step === 'inicio' ? 392 : step === 'consulta' ? 436 : 352}
      label={MIS_COMPROBANTES_LABELS[step]}
      caption={caption}
      approximate={approximate ?? step !== 'inicio'}
    >
      <BrowserFrame>
        <MisComprobantesScreen step={step} />
      </BrowserFrame>
    </ScaledMock>
  )
}

// ─── Homologación (solo para quien programa) ─────────────────────────────────

/** H-03 · WSASS «Crear DN y certificado». */
export function ScreenWsass({ caption }: ScreenProps) {
  const data = useMockData()
  return (
    <ScaledMock
      height={330}
      frameLabel="Así se ve WSASS (pruebas)"
      label="WSASS, el autoservicio de certificados de prueba de ARCA: el formulario «Crear DN y certificado» con el alias, tu CUIT y el pedido pegado."
      caption={caption}
    >
      <BrowserFrame url="wsass-homo.afip.gob.ar">
        <div className="flex h-full flex-col bg-white text-black">
          <div className="flex h-[54px] shrink-0 items-center justify-between bg-gradient-to-r from-[#1c6fa8] via-[#1a3550] to-black px-4 text-white">
            <span className="text-[13px] font-bold leading-tight">
              WSASS Autoservicio de Acceso a WebServices
              <br />
              (TESTING/HOMOLOGACIÓN)
            </span>
            <span className="flex flex-col items-end gap-1 text-[8.5px]">
              <span className="rounded-[2px] bg-[#777] px-2 py-[2px]">Cerrar Sesión</span>
              <span className="rounded-[2px] bg-white px-2 py-[2px] font-bold text-[#335]">
                USUARIO: {data.personCuit}
              </span>
            </span>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="w-[150px] shrink-0 px-3 pt-3 text-[10px] font-bold leading-[1.5] text-[#222]">
              <span className="block">▾ Autogestion de servicios</span>
              {[
                'Introducción',
                'Servicios',
                'Certificados',
                'Nuevo Certificado',
                'Crear autorización a servicio',
                'Eliminar autorización a servicio',
                'Autorizaciones',
                'Agregar certificado a alias',
              ].map((m) => (
                <span key={m} className="block pl-3">
                  ▸ {m}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1 pr-4 pt-3">
              <p className="text-[18px] font-bold text-[#333]">Crear DN y certificado</p>
              <p className="mt-1 border-b border-[#999] pb-1 text-[10px]">
                Formulario para crear un DN y el certificado inicialmente asociado al mismo.
              </p>
              <div className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-px bg-[#ddd] text-[9.5px]">
                <span className="bg-[#ececec] px-1.5 py-1">1. Nombre simbólico del DN</span>
                <span className="bg-white px-1.5 py-1">
                  <MockInput value={data.alias} size="sm" className="w-[200px]" />
                </span>
                <span className="bg-[#ececec] px-1.5 py-1">2. CUIT del contribuyente</span>
                <span className="bg-white px-1.5 py-1">{data.personCuit}</span>
                <span className="bg-[#ececec] px-1.5 py-1">
                  3. Solicitud de certificado en formato PKCS#10
                </span>
                <span className="bg-white px-1.5 py-1 font-mono text-[8.5px] leading-tight text-[#333]">
                  -----BEGIN CERTIFICATE REQUEST-----
                  <br />
                  MIICnDCCAYQCAQAwVzELMAkGA1UEBhMCQVIx…
                  <br />
                  -----END CERTIFICATE REQUEST-----
                </span>
              </div>
              <span className="mt-2 inline-flex">
                <Spotlight label="Crear" side="right" inset={2}>
                  <MockButton variant="file" className="px-6 py-1 text-[10px]">
                    Crear DN y obtener certificado
                  </MockButton>
                </Spotlight>
              </span>
            </div>
          </div>
        </div>
      </BrowserFrame>
    </ScaledMock>
  )
}

// ─── Mini maquetas de «Las 3 reglas de oro» ──────────────────────────────────

// Las dos mini maquetas son angostas (380 px) y llevan el globito abajo: así entran casi en
// tamaño real en la columna de la compu y se leen también en el celular.

/** Regla 1: arriba tiene que decir «Actuando en representación de» la SAS. */
export function MiniActing() {
  return (
    <ScaledMock
      width={380}
      height={150}
      label="Cabecera de ARCA: «Actuando en representación de» y el nombre de la SAS, resaltado."
    >
      <div
        className="h-full bg-white px-4 pt-4"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        <WelcomeBox acting="sas" highlight={{ label: 'La SAS', side: 'bottom' }} />
      </div>
    </ScaledMock>
  )
}

/** Regla 2: el sistema del punto de venta es «RECE para aplicativo y web services». */
export function MiniSistema() {
  return (
    <ScaledMock
      width={380}
      height={124}
      label="Campo Sistema del alta de punto de venta: «RECE para aplicativo y web services», resaltado."
    >
      <div
        className="flex h-full items-start gap-3 bg-[#f4f4f4] px-4 pt-5"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        <span className="flex h-[24px] items-center text-[13px] font-bold text-[#222]">
          Sistema:
        </span>
        <Spotlight label="Este" side="bottom" inset={3}>
          <MockSelect value="RECE para aplicativo y web services" className="w-[270px]" />
        </Spotlight>
      </div>
    </ScaledMock>
  )
}
