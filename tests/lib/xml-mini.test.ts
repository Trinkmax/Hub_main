import { describe, expect, it } from 'vitest'
import {
  attr,
  child,
  childrenNamed,
  decodeEntities,
  escapeXml,
  findAll,
  findFirst,
  MAX_DEPTH,
  nodeAt,
  parseXml,
  textAt,
  textOf,
  type XmlNode,
  XmlParseError,
} from '@/lib/xml/mini'

// ─── Respuestas de ARCA (arca-tecnico.md; CUIT y tokens de prueba) ───────────

/** El ticket de acceso del manual del WSAA (cap. 6.2), con el destino anonimizado. */
const TA = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<loginTicketResponse version="1.0">
    <header>
        <source>CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239</source>
        <destination>SERIALNUMBER=CUIT 20123456786, CN=hubplataforma</destination>
        <uniqueId>3866895167</uniqueId>
        <generationTime>2019-09-26T13:56:14.467-03:00</generationTime>
        <expirationTime>2019-09-27T01:56:14.467-03:00</expirationTime>
    </header>
    <credentials>
        <token>PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pgo8c3NvIHZlcnNpb249IjIuMCI+</token>
        <sign>Urp5dbarIb8m5y+Wq0VpX3l2Yg==</sign>
    </credentials>
</loginTicketResponse>
`

/** Axis 1.4 escapa `<`, `>` y `&` del `xsd:string`; las comillas quedan. */
const axisEscape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const wsaaOk = (loginCmsReturn: string) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Body>
    <loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">
      <loginCmsReturn>${loginCmsReturn}</loginCmsReturn>
    </loginCmsResponse>
  </soapenv:Body>
</soapenv:Envelope>`

/** Fault real de homologación (CMS autofirmado), con el código y el texto a elección. */
const wsaaFault = (code: string, message: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><soapenv:Fault>
  <faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:${code}</faultcode>
  <faultstring>${message}</faultstring>
  <detail><ns2:exceptionName xmlns:ns2="http://xml.apache.org/axis/">gov.afip.desein.dvadac.sua.view.wsaa.LoginFault</ns2:exceptionName>
  <ns3:hostname xmlns:ns3="http://xml.apache.org/axis/">wsaaext1.homo.afip.gov.ar</ns3:hostname></detail>
</soapenv:Fault></soapenv:Body></soapenv:Envelope>`

/** FEDummy real de producción (07/10/2026), con el salto de línea entre Header y Body. */
const FE_DUMMY = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Header><FEHeaderInfo xmlns="http://ar.gov.afip.dif.FEV1/"><ambiente>Produccion - sr5</ambiente><fecha>2026-10-07T23:54:40.7402751-03:00</fecha><id>7.0.0.60</id></FEHeaderInfo></soap:Header>
<soap:Body><FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse></soap:Body></soap:Envelope>`

/** El mismo FEDummy pedido por SOAP 1.2. */
const FE_DUMMY_12 = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse></soap:Body></soap:Envelope>`

/** Sobre ASMX de WSFEv1 (SOAP 1.1) con su `FEHeaderInfo`. */
const asmx = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Header><FEHeaderInfo xmlns="http://ar.gov.afip.dif.FEV1/"><ambiente>HomologacionExterno - srt</ambiente><fecha>2026-10-08T12:34:56.1234567-03:00</fecha><id>7.0.0.60</id></FEHeaderInfo></soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`

/** Respuesta real con un token inválido: HTTP 200 y el error adentro. */
const ULTIMO_ERR_600 = asmx(
  '<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult><PtoVta>0</PtoVta><CbteTipo>0</CbteTipo><CbteNro>0</CbteNro><Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No valido token.</Msg></Err></Errors></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>',
)

/** FECAESolicitar aprobado con observaciones (forma del manual v4.7, §4.5). */
const CAE_A = asmx(
  '<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult><FeCabResp><Cuit>30712345678</Cuit><PtoVta>3</PtoVta><CbteTipo>6</CbteTipo><FchProceso>20261008123456</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp><FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>101</CbteDesde><CbteHasta>101</CbteHasta><CbteFch>20261008</CbteFch><Resultado>A</Resultado><Observaciones><Obs><Code>10245</Code><Msg>El campo Condicion Frente al IVA del receptor resultara obligatorio conforme lo reglamentado por la Resolucion General N° 5616.</Msg></Obs><Obs><Code>10217</Code><Msg>Observación de prueba con &lt;marcas&gt; &amp; comillas "dobles"</Msg></Obs></Observaciones><CAE>76412345678901</CAE><CAEFchVto>20261018</CAEFchVto></FECAEDetResponse></FeDetResp><Events><Evt><Code>33</Code><Msg>Evento informativo</Msg></Evt></Events></FECAESolicitarResult></FECAESolicitarResponse>',
)

/** FECAESolicitar rechazado: `<CAE />` vacío (como lo escribe ASMX) y dos errores. */
const CAE_R = asmx(
  '<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult><FeCabResp><Cuit>30712345678</Cuit><PtoVta>3</PtoVta><CbteTipo>6</CbteTipo><FchProceso>20261008123501</FchProceso><CantReg>1</CantReg><Resultado>R</Resultado><Reproceso>N</Reproceso></FeCabResp><FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>105</CbteDesde><CbteHasta>105</CbteHasta><CbteFch>20261008</CbteFch><Resultado>R</Resultado><Observaciones><Obs><Code>10016</Code><Msg>El numero o fecha del comprobante no se corresponde con el proximo a autorizar.</Msg></Obs></Observaciones><CAE /><CAEFchVto /></FECAEDetResponse></FeDetResp><Errors><Err><Code>10016</Code><Msg>Primer error</Msg></Err><Err><Code>10048</Code><Msg>Segundo error</Msg></Err></Errors></FECAESolicitarResult></FECAESolicitarResponse>',
)

/** getPersona_v2 de un responsable inscripto (forma del manual v4.1, datos inventados). */
const PADRON_RI = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/"><personaReturn><datosGenerales><domicilioFiscal><codPostal>5000</codPostal><descripcionProvincia>CORDOBA</descripcionProvincia><direccion>AV. SIEMPRE VIVA 742</direccion><idProvincia>3</idProvincia><localidad>C&#xD3;RDOBA</localidad><tipoDomicilio>FISCAL</tipoDomicilio></domicilioFiscal><estadoClave>ACTIVO</estadoClave><idPersona>30712345678</idPersona><razonSocial>HERMANOS GARCÍA &amp; CÍA. S.R.L.</razonSocial><tipoClave>CUIT</tipoClave><tipoPersona>JURIDICA</tipoPersona></datosGenerales><datosRegimenGeneral><impuesto><descripcionImpuesto>GANANCIAS SOCIEDADES</descripcionImpuesto><estadoImpuesto>AC</estadoImpuesto><idImpuesto>10</idImpuesto><periodo>201801</periodo></impuesto><impuesto><descripcionImpuesto>IVA</descripcionImpuesto><estadoImpuesto>AC</estadoImpuesto><idImpuesto>30</idImpuesto><periodo>201801</periodo></impuesto></datosRegimenGeneral><metadata><fechaHora>2026-10-08T10:15:30.123-03:00</fechaHora><servidor>setiwsh2</servidor></metadata></personaReturn></ns2:getPersona_v2Response></soap:Body></soap:Envelope>`

/** Monotributista con `errorConstancia` (los problemas de la persona vienen adentro). */
const PADRON_MONO_CON_ERRORES = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/"><personaReturn><datosMonotributo><categoriaMonotributo><descripcionCategoria>B LOCACIONES DE SERVICIO</descripcionCategoria><idCategoria>26</idCategoria><idImpuesto>20</idImpuesto><periodo>202401</periodo></categoriaMonotributo><impuesto><descripcionImpuesto>MONOTRIBUTO</descripcionImpuesto><estadoImpuesto>AC</estadoImpuesto><idImpuesto>20</idImpuesto><periodo>202401</periodo></impuesto></datosMonotributo><errorConstancia><apellido>PRUEBA</apellido><error>La CUIT consultada no tiene domicilio fiscal electrónico</error><error>Faltan datos en el padrón</error><idPersona>20111111112</idPersona><nombre>PERSONA</nombre></errorConstancia></personaReturn></ns2:getPersona_v2Response></soap:Body></soap:Envelope>`

/** Fault real del padrón con un token inválido (HTTP 500). */
const PADRON_FAULT = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>Token malformado</faultstring></soap:Fault></soap:Body></soap:Envelope>`

// ─── Partes de un XLSX (como las escribe Excel) ──────────────────────────────

const SHARED_STRINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="12" uniqueCount="9"><si><t>Mis Comprobantes Recibidos - CUIT 30712345678</t></si><si><t>Fecha</t></si><si><t>Tipo</t></si><si><t>Denominación Emisor</t></si><si><t>1 - Factura A</t></si><si><r><rPr><b/><sz val="11"/><color theme="1"/><rFont val="Calibri"/><family val="2"/><scheme val="minor"/></rPr><t xml:space="preserve">PROVEEDOR </t></r><r><rPr><sz val="11"/><color theme="1"/><rFont val="Calibri"/><family val="2"/><scheme val="minor"/></rPr><t>UNO &amp; CÍA SA</t></r></si><si><t xml:space="preserve">  con espacios  </t></si><si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh><phoneticPr fontId="1"/></si><si><t>Línea 1&#10;Línea 2</t></si></sst>`

const SHEET = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac xr xr2 xr3" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:xr3="http://schemas.microsoft.com/office/spreadsheetml/2016/revision3" xr:uid="{00000000-0001-0000-0000-000000000000}"><dimension ref="A1:F4"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/><cols><col min="1" max="1" width="12.7109375" customWidth="1"/></cols><sheetData><row r="1" spans="1:6" x14ac:dyDescent="0.25"><c r="A1" t="s"><v>0</v></c></row><row r="2" spans="1:6" x14ac:dyDescent="0.25"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="inlineStr"><is><t>Punto de Venta</t></is></c><c r="D2" t="s"><v>3</v></c><c r="E2" t="inlineStr"><is><t>Imp. Total</t></is></c><c r="F2" t="inlineStr"><is><t>Pagado</t></is></c></row><row r="3" spans="1:6" x14ac:dyDescent="0.25"><c r="A3" s="1"><v>46022</v></c><c r="B3" t="s"><v>4</v></c><c r="C3"><v>3</v></c><c r="D3" t="s"><v>5</v></c><c r="E3" s="2"><v>33500.5</v></c><c r="F3" t="b"><v>1</v></c></row><row r="4" spans="1:6" x14ac:dyDescent="0.25"><c r="A4" t="inlineStr"><is><t>02/12/2025</t></is></c><c r="B4" t="str"><f>CONCATENATE("3 - ","Nota de Crédito A")</f><v>3 - Nota de Crédito A</v></c><c r="C4" s="3"/><c r="D4" t="s"><v>6</v></c><c r="E4"><v>-1.5E-2</v></c><c r="F4" t="e"><v>#N/A</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:F1"/></mergeCells><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`

/** Lo que escribe el Open XML SDK de .NET: todo con prefijo `x:`. */
const SHEET_SDK = `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>1</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>Punto de Venta</x:t></x:is></x:c></x:row><x:row r="2"><x:c r="A2" s="1"><x:v>46022</x:v></x:c><x:c r="B2"><x:v>3</x:v></x:c></x:row></x:sheetData></x:worksheet>`

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr defaultThemeVersion="164011"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/><sheet name="Hoja2" sheetId="2" state="hidden" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Hoja1!$A$2:$AD$4</definedName></definedNames></workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`

/** Lo que va a hacer el lector de XLSX: el texto de un `<si>` o un `<is>`, sin la fonética. */
function richText(n: XmlNode | null): string {
  const plain = childrenNamed(n, 't').map(textOf).join('')
  const runs = childrenNamed(n, 'r')
    .map((r) => textAt(r, 't') ?? '')
    .join('')
  return plain + runs
}

/** Valores crudos por referencia de celda (las vacías no aparecen). */
function readCells(sheet: XmlNode, shared: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of childrenNamed(child(sheet, 'sheetData'), 'row')) {
    for (const c of childrenNamed(row, 'c')) {
      const ref = attr(c, 'r') ?? '?'
      const type = attr(c, 't')
      const v = textAt(c, 'v')
      if (type === 'inlineStr') out[ref] = richText(child(c, 'is'))
      else if (type === 's') out[ref] = shared[Number(v)] ?? '¿?'
      else if (v !== null) out[ref] = v
    }
  }
  return out
}

function errorOf(xml: string): XmlParseError {
  try {
    parseXml(xml)
  } catch (e) {
    if (e instanceof XmlParseError) return e
    throw e
  }
  throw new Error('parseXml no tiró')
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parseXml: lo básico', () => {
  it('elementos, atributos, autocierre y el orden de los hijos', () => {
    const root = parseXml('<raiz id="1"><a x="uno">texto</a><b/><a x="dos"></a></raiz>')
    expect(root.name).toBe('raiz')
    expect(attr(root, 'id')).toBe('1')
    expect(root.children.map((c) => c.name)).toEqual(['a', 'b', 'a'])
    expect(child(root, 'a')?.text).toBe('texto')
    expect(child(root, 'b')).toEqual({ name: 'b', qname: 'b', attrs: {}, children: [], text: '' })
  })

  it('los repetidos quedan todos y siempre como array, aunque haya uno solo', () => {
    const root = parseXml('<r><Err>1</Err><Obs>x</Obs><Err>2</Err></r>')
    expect(childrenNamed(root, 'Err').map(textOf)).toEqual(['1', '2'])
    expect(childrenNamed(root, 'Obs').map(textOf)).toEqual(['x'])
    expect(childrenNamed(root, 'Evt')).toEqual([])
  })

  it('saltea BOM, declaración, comentarios e instrucciones de procesamiento', () => {
    const xml = `﻿<?xml version='1.0' encoding="ISO-8859-1"?>
<!-- antes de la raíz -->
<a><!-- adentro <b> --><?algo con > adentro?>uno<!---->dos</a>
<!-- después -->
`
    const a = parseXml(xml)
    expect(a.children).toEqual([])
    expect(a.text).toBe('unodos')
    expect(parseXml('\n  <?xml version="1.0"?><a/>').name).toBe('a')
  })

  it('la sangría entre etiquetas no es texto; en una hoja el texto va entero', () => {
    const root = parseXml(
      '<a>\n  <b>  con espacios  </b>\n  <c xml:space="preserve"> </c>\n  <d>\n</d>\n</a>',
    )
    expect(root.text).toBe('')
    expect(root.mixed).toBeUndefined()
    expect(textAt(root, 'b')).toBe('  con espacios  ')
    expect(textAt(root, 'c')).toBe(' ')
    expect(textAt(root, 'd')).toBe('\n')
    expect(textOf(root)).toBe('  con espacios   \n')
  })

  it('para XML «espacio» son solo espacio, tab, LF y CR: un NBSP es texto', () => {
    expect(textOf(parseXml('<a> <b>x</b></a>'))).toBe(' x')
  })

  it('CRLF y CR pasan a LF; un &#13; queda como CR', () => {
    expect(textOf(parseXml('<a>uno\r\ndos\rtres&#13;cuatro</a>'))).toBe('uno\ndos\ntres\rcuatro')
  })

  it('atributos: comillas de los dos tipos, entidades, espacio alrededor del «=» y tab/LF literales como espacio', () => {
    const n = parseXml(
      `<a uno='con "dobles"' dos = "con 'simples'" tres="1 &lt; 2 &amp;&amp; 3 &gt; 2" cuatro="a\tb\nc" cinco="a&#9;b&#10;c" seis=""/>`,
    )
    expect(n.attrs).toEqual({
      uno: 'con "dobles"',
      dos: "con 'simples'",
      tres: '1 < 2 && 3 > 2',
      cuatro: 'a b c',
      cinco: 'a\tb\nc',
      seis: '',
    })
  })

  it('contenido mixto: textOf respeta el orden real', () => {
    const p = parseXml('<p>Hola <b>mundo</b>, <i>che</i>.</p>')
    expect(textOf(p)).toBe('Hola mundo, che.')
    expect(p.text).toBe('Hola , .')
    expect(p.children.map((c) => c.name)).toEqual(['b', 'i'])
    expect(p.mixed?.map((x) => (typeof x === 'string' ? x : `<${x.name}>`))).toEqual([
      'Hola ',
      '<b>',
      ', ',
      '<i>',
      '.',
    ])
    // Solo espacio entre elementos no es contenido mixto.
    const q = parseXml('<p> <b>a</b> <i>b</i> </p>')
    expect(q.mixed).toBeUndefined()
    expect(textOf(q)).toBe('ab')
  })

  it('los atributos no heredan de Object.prototype: «__proto__» es un atributo más', () => {
    const n = parseXml('<a __proto__="x" constructor="y"/>')
    expect(Object.keys(n.attrs)).toEqual(['__proto__', 'constructor'])
    expect('toString' in n.attrs).toBe(false)
    expect('hasOwnProperty' in parseXml('<a b="1"/>').attrs).toBe(false)
    expect(attr(n, '__proto__')).toBe('x')
    expect(attr(n, 'constructor')).toBe('y')
    expect(attr(parseXml('<a/>'), 'constructor')).toBeNull()
    expect(attr(parseXml('<a/>'), 'toString')).toBeNull()
  })
})

describe('prefijos de namespace', () => {
  it('se ignoran en los nombres y en lo que se pide; qname guarda el original', () => {
    const env = parseXml(
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><m:Resp xmlns:m="urn:x"><m:Val>1</m:Val><Val>2</Val></m:Resp></s:Body></s:Envelope>',
    )
    expect(env.name).toBe('Envelope')
    expect(env.qname).toBe('s:Envelope')
    expect(textAt(env, 'Body/Resp/Val')).toBe('1')
    expect(textAt(env, 'soapenv:Body/ns9:Resp/Val')).toBe('1')
    expect(childrenNamed(nodeAt(env, 'Body/Resp'), 'x:Val').map(textOf)).toEqual(['1', '2'])
    expect(findFirst(env, 'soap:Body')?.qname).toBe('s:Body')
  })

  it('SOAP 1.2 se lee con los mismos caminos que SOAP 1.1', () => {
    const path = 'Body/FEDummyResponse/FEDummyResult/AppServer'
    expect(textAt(parseXml(FE_DUMMY_12), path)).toBe('OK')
    expect(textAt(parseXml(FE_DUMMY), path)).toBe('OK')
  })

  it('attr: exacto, por nombre local, con cualquier prefijo, y nunca un xmlns por nombre local', () => {
    const sheet = parseXml('<sheet xmlns:r="urn:rel" name="Hoja1" sheetId="1" r:id="rId1"/>')
    expect(attr(sheet, 'r:id')).toBe('rId1')
    expect(attr(sheet, 'id')).toBe('rId1')
    expect(attr(sheet, 'ns1:id')).toBe('rId1')
    expect(attr(sheet, 'name')).toBe('Hoja1')
    expect(attr(sheet, 'xmlns:r')).toBe('urn:rel')
    expect(attr(sheet, 'r')).toBeNull()
    expect(attr(sheet, 'nada')).toBeNull()
    expect(attr(parseXml('<t xml:space="preserve"> x </t>'), 'space')).toBe('preserve')
    // Pedido con prefijo, solo mira atributos con prefijo.
    const both = parseXml('<a id="plano" x:id="con-prefijo"/>')
    expect(attr(both, 'id')).toBe('plano')
    expect(attr(both, 'r:id')).toBe('con-prefijo')
    expect(attr(null, 'id')).toBeNull()
  })
})

describe('entidades y CDATA', () => {
  it('las cinco de XML y las numéricas (decimal, hexadecimal y fuera del BMP)', () => {
    expect(textOf(parseXml('<a>&lt;b&gt; &amp; &quot;c&quot; &apos;d&apos;</a>'))).toBe(
      `<b> & "c" 'd'`,
    )
    expect(textOf(parseXml('<a>&#225;&#xE1;&#xe1;&#x1F600;&#0000065;</a>'))).toBe('ááá😀A')
  })

  it('lo que no reconoce queda literal: HTML, «&» suelto, referencias inválidas', () => {
    const raw = 'AT&T &nbsp; &copy; &#0; &#xD800; &#x110000; &#; &#x; &amp sin punto y coma'
    expect(textOf(parseXml(`<a>${raw}</a>`))).toBe(raw)
  })

  it('el CDATA va tal cual (sin decodificar) y se pega al texto vecino', () => {
    const a = parseXml('<a>antes <![CDATA[<b>&amp; ]] ]]>después</a>')
    expect(a.children).toEqual([])
    expect(a.text).toBe('antes <b>&amp; ]] después')
    expect(textOf(parseXml('<a><![CDATA[]]></a>'))).toBe('')
  })

  it('decodeEntities: una sola pasada (para lo que vino escapado dos veces)', () => {
    expect(decodeEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;')
    expect(decodeEntities(decodeEntities('&amp;lt;b&amp;gt;'))).toBe('<b>')
    expect(decodeEntities('sin entidades')).toBe('sin entidades')
  })
})

describe('DTD: nunca se expande', () => {
  it('billion laughs: la entidad queda como texto literal', () => {
    const entities = Array.from(
      { length: 9 },
      (_, k) => `<!ENTITY lol${k + 1} "${`&lol${k || ''};`.repeat(10)}">`,
    )
    const bomb = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ELEMENT lolz (#PCDATA)>
  ${entities.join('\n  ')}
]>
<lolz>&lol9;</lolz>`
    expect(textOf(parseXml(bomb))).toBe('&lol9;')
  })

  it('XXE: una entidad externa no se resuelve', () => {
    const xxe =
      '<?xml version="1.0"?><!DOCTYPE foo [ <!ELEMENT foo ANY> <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><foo>&xxe;</foo>'
    expect(textOf(parseXml(xxe))).toBe('&xxe;')
  })

  it('saltea el subconjunto interno aunque traiga «]>» entre comillas o en un comentario', () => {
    const tricky = `<!DOCTYPE a [ <!ENTITY x "]>"> <!ENTITY y ']]>'> <!-- ]> --> ]><a>ok</a>`
    expect(textOf(parseXml(tricky))).toBe('ok')
    const xhtml =
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html/>'
    expect(parseXml(xhtml).name).toBe('html')
  })
})

describe('navegación', () => {
  const DOC = parseXml('<r><a><b id="1"><b id="2"/></b><c>uno</c><c>dos</c></a><b id="3"/></r>')

  it('findFirst y findAll: incluyen al propio nodo y van en orden de documento', () => {
    expect(findAll(DOC, 'b').map((b) => attr(b, 'id'))).toEqual(['1', '2', '3'])
    const b1 = findFirst(DOC, 'b')
    expect(attr(b1, 'id')).toBe('1')
    expect(findAll(b1, 'b').map((b) => attr(b, 'id'))).toEqual(['1', '2'])
    expect(findFirst(DOC, 'r')).toBe(DOC)
    expect(findFirst(DOC, 'nada')).toBeNull()
    expect(findAll(null, 'b')).toEqual([])
    expect(findFirst(undefined, 'b')).toBeNull()
  })

  it('child, childrenNamed, nodeAt y textAt (caminos relativos, solo hijos directos)', () => {
    expect(attr(child(DOC, 'b'), 'id')).toBe('3')
    expect(textAt(DOC, 'a/c')).toBe('uno')
    expect(childrenNamed(child(DOC, 'a'), 'c').map(textOf)).toEqual(['uno', 'dos'])
    expect(attr(nodeAt(DOC, 'a/b/b'), 'id')).toBe('2')
    expect(nodeAt(DOC, '/a//c/')?.text).toBe('uno')
    expect(nodeAt(DOC, '')).toBe(DOC)
    expect(nodeAt(DOC, 'a/nada/c')).toBeNull()
    expect(textAt(DOC, 'r/a')).toBeNull()
    expect(child(null, 'a')).toBeNull()
    expect(childrenNamed(undefined, 'a')).toEqual([])
    expect(textAt(null, 'a')).toBeNull()
  })

  it('textAt distingue vacío de ausente y no recorta', () => {
    const det = parseXml('<det><CAE></CAE><CAEFchVto /><Obs>  </Obs></det>')
    expect(textAt(det, 'CAE')).toBe('')
    expect(textAt(det, 'CAEFchVto')).toBe('')
    expect(textAt(det, 'Obs')).toBe('  ')
    expect(textAt(det, 'Resultado')).toBeNull()
  })
})

describe('respuestas reales de ARCA', () => {
  it('WSAA loginCms: el ticket viene escapado como texto y se vuelve a leer', () => {
    const env = parseXml(wsaaOk(axisEscape(TA)))
    const inner = textAt(env, 'Body/loginCmsResponse/loginCmsReturn')
    expect(inner).toBe(TA)
    const ta = parseXml(inner ?? '')
    expect(ta.name).toBe('loginTicketResponse')
    expect(attr(ta, 'version')).toBe('1.0')
    expect(textAt(ta, 'credentials/token')).toBe(
      'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pgo8c3NvIHZlcnNpb249IjIuMCI+',
    )
    expect(textAt(ta, 'credentials/sign')).toBe('Urp5dbarIb8m5y+Wq0VpX3l2Yg==')
    expect(textAt(ta, 'header/generationTime')).toBe('2019-09-26T13:56:14.467-03:00')
    expect(textAt(ta, 'header/expirationTime')).toBe('2019-09-27T01:56:14.467-03:00')
    expect(textAt(ta, 'header/destination')).toBe('SERIALNUMBER=CUIT 20123456786, CN=hubplataforma')
  })

  it('WSAA loginCms: el mismo ticket dentro de un CDATA, o escapado dos veces', () => {
    const path = 'Body/loginCmsResponse/loginCmsReturn'
    expect(textAt(parseXml(wsaaOk(`<![CDATA[${TA}]]>`)), path)).toBe(TA)
    const twice = textAt(parseXml(wsaaOk(axisEscape(axisEscape(TA)))), path)
    expect(textAt(parseXml(decodeEntities(twice ?? '')), 'credentials/sign')).toBe(
      'Urp5dbarIb8m5y+Wq0VpX3l2Yg==',
    )
  })

  it.each([
    ['cms.cert.untrusted', 'Certificado no emitido por AC de confianza'],
    ['cms.bad.base64', 'No se puede decodificar el BASE64'],
  ])('WSAA: fault %s', (code, message) => {
    const fault = findFirst(parseXml(wsaaFault(code, message)), 'Fault')
    expect(fault?.qname).toBe('soapenv:Fault')
    expect(textAt(fault, 'faultcode')).toBe(`ns1:${code}`)
    expect(textAt(fault, 'faultstring')).toBe(message)
    expect(textAt(fault, 'detail/exceptionName')).toBe(
      'gov.afip.desein.dvadac.sua.view.wsaa.LoginFault',
    )
    expect(textAt(fault, 'detail/hostname')).toBe('wsaaext1.homo.afip.gov.ar')
  })

  it('WSFE: FEDummy de producción, con FEHeaderInfo y un salto de línea entre Header y Body', () => {
    const env = parseXml(FE_DUMMY)
    expect(env.qname).toBe('soap:Envelope')
    expect(env.children.map((c) => c.name)).toEqual(['Header', 'Body'])
    expect(env.text).toBe('')
    expect(textAt(env, 'Header/FEHeaderInfo/ambiente')).toBe('Produccion - sr5')
    const result = nodeAt(env, 'Body/FEDummyResponse/FEDummyResult')
    expect(result?.children.map((c) => [c.name, c.text])).toEqual([
      ['AppServer', 'OK'],
      ['DbServer', 'OK'],
      ['AuthServer', 'OK'],
    ])
    expect(parseXml(`﻿${FE_DUMMY}`).name).toBe('Envelope')
  })

  it('WSFE: Err 600 con un token inválido (HTTP 200, el error viene adentro)', () => {
    const result = findFirst(parseXml(ULTIMO_ERR_600), 'FECompUltimoAutorizadoResult')
    expect(textAt(result, 'CbteNro')).toBe('0')
    const errs = childrenNamed(child(result, 'Errors'), 'Err')
    expect(errs.map((e) => textAt(e, 'Code'))).toEqual(['600'])
    expect(textAt(errs[0], 'Msg')).toBe('ValidacionDeToken: No valido token.')
  })

  it('FECAESolicitar aprobado: CAE, dos observaciones y un evento', () => {
    const result = nodeAt(parseXml(CAE_A), 'Body/FECAESolicitarResponse/FECAESolicitarResult')
    expect(textAt(result, 'FeCabResp/Resultado')).toBe('A')
    expect(textAt(result, 'FeCabResp/FchProceso')).toBe('20261008123456')
    const det = nodeAt(result, 'FeDetResp/FECAEDetResponse')
    expect(textAt(det, 'CAE')).toBe('76412345678901')
    expect(textAt(det, 'CAEFchVto')).toBe('20261018')
    const obs = childrenNamed(child(det, 'Observaciones'), 'Obs').map((o) => ({
      code: textAt(o, 'Code'),
      msg: textAt(o, 'Msg'),
    }))
    expect(obs).toHaveLength(2)
    expect(obs[0]?.code).toBe('10245')
    expect(obs[1]).toEqual({
      code: '10217',
      msg: 'Observación de prueba con <marcas> & comillas "dobles"',
    })
    expect(childrenNamed(child(result, 'Events'), 'Evt').map((e) => textAt(e, 'Code'))).toEqual([
      '33',
    ])
    expect(childrenNamed(child(result, 'Errors'), 'Err')).toEqual([])
  })

  it('FECAESolicitar rechazado: <CAE /> vacío no es lo mismo que ausente; dos Err', () => {
    const result = findFirst(parseXml(CAE_R), 'FECAESolicitarResult')
    const det = findFirst(result, 'FECAEDetResponse')
    expect(textAt(det, 'Resultado')).toBe('R')
    expect(textAt(det, 'CAE')).toBe('')
    expect(textAt(det, 'CAEFchVto')).toBe('')
    expect(textAt(det, 'FchProceso')).toBeNull()
    expect(childrenNamed(child(result, 'Errors'), 'Err').map((e) => textAt(e, 'Code'))).toEqual([
      '10016',
      '10048',
    ])
  })

  it('padrón getPersona_v2: impuestos repetidos, entidades y tildes', () => {
    const persona = nodeAt(parseXml(PADRON_RI), 'Body/getPersona_v2Response/personaReturn')
    expect(textAt(persona, 'datosGenerales/razonSocial')).toBe('HERMANOS GARCÍA & CÍA. S.R.L.')
    expect(textAt(persona, 'datosGenerales/domicilioFiscal/localidad')).toBe('CÓRDOBA')
    expect(
      childrenNamed(child(persona, 'datosRegimenGeneral'), 'impuesto').map((i) =>
        textAt(i, 'idImpuesto'),
      ),
    ).toEqual(['10', '30'])
    expect(childrenNamed(child(persona, 'datosMonotributo'), 'impuesto')).toEqual([])
    expect(child(persona, 'errorConstancia')).toBeNull()
  })

  it('padrón: errorConstancia con varios «error», y el fault «Token malformado»', () => {
    const persona = findFirst(parseXml(PADRON_MONO_CON_ERRORES), 'personaReturn')
    expect(childrenNamed(child(persona, 'errorConstancia'), 'error').map(textOf)).toEqual([
      'La CUIT consultada no tiene domicilio fiscal electrónico',
      'Faltan datos en el padrón',
    ])
    expect(findAll(persona, 'idImpuesto').map(textOf)).toEqual(['20', '20'])
    expect(textAt(persona, 'datosMonotributo/categoriaMonotributo/descripcionCategoria')).toBe(
      'B LOCACIONES DE SERVICIO',
    )
    const fault = findFirst(parseXml(PADRON_FAULT), 'Fault')
    expect(textAt(fault, 'faultcode')).toBe('soap:Server')
    expect(textAt(fault, 'faultstring')).toBe('Token malformado')
  })
})

describe('partes de un XLSX', () => {
  const shared = childrenNamed(parseXml(SHARED_STRINGS), 'si').map(richText)

  it('sharedStrings: simple, con espacios, rich text, fonética y saltos de línea', () => {
    expect(shared).toEqual([
      'Mis Comprobantes Recibidos - CUIT 30712345678',
      'Fecha',
      'Tipo',
      'Denominación Emisor',
      '1 - Factura A',
      'PROVEEDOR UNO & CÍA SA',
      '  con espacios  ',
      '東京',
      'Línea 1\nLínea 2',
    ])
    // textOf mezclaría la lectura fonética: por eso el lector toma `t` y `r/t`.
    const kanji = childrenNamed(parseXml(SHARED_STRINGS), 'si')[7]
    expect(kanji && textOf(kanji)).toBe('東京トウキョウ')
  })

  it('un <si> con sangría (otro generador) da el mismo texto', () => {
    const sst = parseXml(
      '<sst>\n  <si>\n    <r>\n      <t xml:space="preserve">Hola </t>\n    </r>\n    <r>\n      <t>mundo</t>\n    </r>\n  </si>\n</sst>',
    )
    expect(childrenNamed(sst, 'si').map(richText)).toEqual(['Hola mundo'])
    expect(textOf(sst)).toBe('Hola mundo')
  })

  it('sheet1.xml: compartidos, inlineStr, números, fórmula, booleano, error y celda vacía', () => {
    const sheet = parseXml(SHEET)
    expect(attr(child(sheet, 'dimension'), 'ref')).toBe('A1:F4')
    expect(attr(findFirst(sheet, 'mergeCell'), 'ref')).toBe('A1:F1')
    expect(readCells(sheet, shared)).toEqual({
      A1: 'Mis Comprobantes Recibidos - CUIT 30712345678',
      A2: 'Fecha',
      B2: 'Tipo',
      C2: 'Punto de Venta',
      D2: 'Denominación Emisor',
      E2: 'Imp. Total',
      F2: 'Pagado',
      A3: '46022',
      B3: '1 - Factura A',
      C3: '3',
      D3: 'PROVEEDOR UNO & CÍA SA',
      E3: '33500.5',
      F3: '1',
      A4: '02/12/2025',
      B4: '3 - Nota de Crédito A',
      D4: '  con espacios  ',
      E4: '-1.5E-2',
      F4: '#N/A',
    })
    const c4 = findAll(sheet, 'c').find((c) => attr(c, 'r') === 'C4')
    expect(c4 && { attrs: c4.attrs, children: c4.children }).toEqual({
      attrs: { r: 'C4', s: '3' },
      children: [],
    })
  })

  it('la misma hoja escrita con prefijo x: (Open XML SDK) se lee igual', () => {
    expect(readCells(parseXml(SHEET_SDK), shared)).toEqual({
      A1: 'Fecha',
      B1: 'Punto de Venta',
      A2: '46022',
      B2: '3',
    })
  })

  it('workbook.xml y sus .rels: la primera hoja por r:id, aunque el prefijo sea otro', () => {
    const firstSheet = findFirst(parseXml(WORKBOOK), 'sheet')
    expect(attr(firstSheet, 'name')).toBe('Hoja1')
    const rid = attr(firstSheet, 'r:id')
    expect(rid).toBe('rId1')
    const target = childrenNamed(parseXml(WORKBOOK_RELS), 'Relationship').find(
      (r) => attr(r, 'Id') === rid,
    )
    expect(attr(target, 'Target')).toBe('worksheets/sheet1.xml')
    const otherPrefix = parseXml(
      '<workbook xmlns:ns1="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoja1" sheetId="1" ns1:id="rId1"/></sheets></workbook>',
    )
    expect(attr(findFirst(otherPrefix, 'sheet'), 'r:id')).toBe('rId1')
  })

  it('una hoja grande se lee entera (45.000 celdas)', () => {
    const col = (i: number) =>
      (i < 26 ? '' : String.fromCharCode(64 + Math.floor(i / 26))) +
      String.fromCharCode(65 + (i % 26))
    const rows: string[] = []
    for (let r = 1; r <= 1500; r++) {
      let cells = ''
      for (let c = 0; c < 30; c++) cells += `<c r="${col(c)}${r}"><v>${r * 100 + c}</v></c>`
      rows.push(`<row r="${r}">${cells}</row>`)
    }
    const sheet = parseXml(`<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`)
    const parsed = childrenNamed(child(sheet, 'sheetData'), 'row')
    expect(parsed).toHaveLength(1500)
    const last = parsed[1499]
    expect(attr(last?.children[29], 'r')).toBe('AD1500')
    expect(textAt(last?.children[29], 'v')).toBe('150029')
  })
})

describe('errores', () => {
  it.each([
    ['vacío', ''],
    ['solo espacio', '  \n '],
    ['solo la declaración', '<?xml version="1.0"?>'],
    ['sin cerrar', '<a><b></b>'],
    ['un cierre que no corresponde', '<a></b>'],
    ['un cierre de más', '<a/></a>'],
    ['dos raíces', '<a/><b/>'],
    ['texto antes de la raíz', 'hola<a/>'],
    ['texto después de la raíz', '<a/>chau'],
    ['una entidad fuera de la raíz', '<a/>&amp;'],
    ['un CDATA fuera de la raíz', '<![CDATA[x]]><a/>'],
    ['un «<» suelto en el texto', '<a>1 < 2</a>'],
    ['un atributo sin valor', '<a b></a>'],
    ['un atributo sin comillas', '<a b=1></a>'],
    ['un «<» dentro de un atributo', '<a b="x<y"/>'],
    ['un atributo repetido', '<a b="1" b="2"/>'],
    ['comillas que no cierran', '<a b="1/>'],
    ['una etiqueta cortada', '<a b="1"'],
    ['«/» sin «>»', '<a/ >'],
    ['un comentario sin cerrar', '<a><!-- nada</a>'],
    ['un CDATA sin cerrar', '<a><![CDATA[x</a>'],
    ['una instrucción sin cerrar', '<a><?pi </a>'],
    ['un DOCTYPE dentro de la raíz', '<a><!DOCTYPE a></a>'],
    ['un DOCTYPE sin cerrar', '<!DOCTYPE a [ <!ENTITY x "y"> <a/>'],
    ['una declaración suelta', '<a><!ENTITY x "y"></a>'],
    ['un <!doctype> en minúscula (HTML)', '<!doctype html><html></html>'],
    ['una etiqueta sin nombre', '<>x</>'],
  ])('%s → XmlParseError', (_, xml) => {
    expect(() => parseXml(xml)).toThrow(XmlParseError)
  })

  it('la página HTML de error de un proxy tira en vez de devolver un árbol a medias', () => {
    const pages = [
      '<html>\n<head><title>502 Bad Gateway</title></head>\n<body>\n<center><h1>502 Bad Gateway</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>',
      "<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Please consult with your administrator.<br><br>Your support ID is: 1234567890<br><br><a href='javascript:history.back();'>[Go Back]</a></body></html>",
      '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Mantenimiento</title></head><body></body></html>',
    ]
    for (const html of pages) expect(() => parseXml(html)).toThrow(XmlParseError)
  })

  it('el mensaje dice dónde y qué etiqueta, pero no copia el texto del documento', () => {
    const xml = '<persona><nombre>Juana Pérez</apellido></persona>'
    const e = errorOf(xml)
    expect(e.code).toBe('xml_parse')
    expect(e.position).toBe(xml.indexOf('</apellido>'))
    expect(e.message).toContain('</nombre>')
    expect(e.message).not.toContain('Juana')
    expect(errorOf(`<${'x'.repeat(5000)}>`).message.length).toBeLessThan(200)
  })

  it(`anidamiento: hasta ${MAX_DEPTH} niveles se lee (los helpers no recurren); uno más tira`, () => {
    const deep = (levels: number) =>
      `${'<a>'.repeat(levels - 1)}<b>fondo</b>${'</a>'.repeat(levels - 1)}`
    const root = parseXml(deep(MAX_DEPTH))
    expect(findAll(root, 'a')).toHaveLength(MAX_DEPTH - 1)
    expect(findFirst(root, 'b')?.text).toBe('fondo')
    expect(textOf(root)).toBe('fondo')
    expect(() => parseXml(deep(MAX_DEPTH + 1))).toThrow(XmlParseError)
  })
})

describe('escapeXml', () => {
  it('escapa los cinco de XML y tab, LF y CR', () => {
    expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;',
    )
    expect(escapeXml('a\tb\nc\r\nd')).toBe('a&#9;b&#10;c&#13;&#10;d')
    expect(escapeXml('30712345678')).toBe('30712345678')
  })

  it('saca lo que XML 1.0 no admite y deja tildes y emojis', () => {
    expect(escapeXml('a\u0000b\u0007c\u000bd\u001fe￾f￿g')).toBe('abcdefg')
    expect(escapeXml('x\ud800y\udc00z')).toBe('xyz')
    expect(escapeXml('Peñaloza Ñandú 😀')).toBe('Peñaloza Ñandú 😀')
  })

  it('ida y vuelta exacta como texto y como atributo, con comillas de los dos tipos', () => {
    const s = `Café & "Cía" <S.A.> 'x'\n\tcon tab\r\ny CRLF 😀`
    const n = parseXml(`<a v="${escapeXml(s)}" w='${escapeXml(s)}'>${escapeXml(s)}</a>`)
    expect(attr(n, 'v')).toBe(s)
    expect(attr(n, 'w')).toBe(s)
    expect(n.text).toBe(s)
  })
})
