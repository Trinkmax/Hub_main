# ARCA — Investigación técnica: WSAA, WSFEv1 y Padrón (para HUB! Coffee & Bar)

> Fecha de corte: **08/10/2026**. Objetivo: tener todo lo necesario para implementar la integración con ARCA **sin dependencias npm nuevas** (Node 22: `node:crypto`, `node:https`/`fetch`; ASN.1/DER a mano), corriendo en Vercel `iad1` (AWS us-east-1).
>
> Convenciones: **[OFICIAL]** = documento de ARCA; **[VERIFICADO]** = lo probé yo hoy contra los servidores reales (detalles en §8); **[SECUNDARIA]** = SDK/foro/prensa; **A CONFIRMAR** = no lo pude confirmar con fuente oficial o prueba.
>
> Código de referencia probado (sin dependencias): `scratchpad/research/ref/der.mjs`, `csr.mjs`, `cms.mjs` (+ scripts `*-probe.mjs`). Ruta completa: `/private/tmp/claude-501/-Users-ignaciobaldovino-Hub-main/6bc921ab-2546-4d32-8fb8-1435c8671f61/scratchpad/research/ref/`.

---

## 0. Resumen ejecutivo (lo que importa para decidir)

1. **Flujo**: firmar un TRA (XML) como CMS/PKCS#7 → `LoginCms` del WSAA → `token` + `sign` (válidos **12 h**) → usarlos en cada llamada a WSFEv1 / Padrón. [OFICIAL]
2. **Todo se puede hacer con Node puro**: generé un CSR PKCS#10 y un CMS SignedData con DER escrito a mano (~150 líneas). OpenSSL 3.6 los valida, y el **WSAA de homologación parseó el CMS** y respondió `cms.cert.untrusted` (lo esperable con un certificado autofirmado; no hubo `cms.bad`). [VERIFICADO]
3. **Problema real de TLS en producción**: `servicios1.afip.gov.ar` (WSFEv1 prod) negocia **DHE de 1024 bits** y Node con OpenSSL ≥ 3.2 (Node 22.20+ trae OpenSSL 3.5.2) corta con `ERR_SSL_DH_KEY_TOO_SMALL`. **Fix limpio que probé**: un `https.Agent` que ofrezca **solo suites ECDHE** (`ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256`); no hace falta bajar el `SECLEVEL`. Homologación no tiene el problema. [VERIFICADO]
4. **No hay bloqueo geográfico**: desde **AWS us-east-1 (Ashburn, la región de Vercel iad1)**, us-east-2, us-west-2 y otros nodos de EE.UU., Brasil y Alemania, todos los endpoints responden HTTP 200 (GET `?wsdl`). Solo probé GET; las llamadas SOAP autenticadas desde AWS siguen **A CONFIRMAR** (es muy probable que anden igual). [VERIFICADO]
5. **Condición frente al IVA del receptor (`CondicionIVAReceptorId`, RG 5616)**: hoy es una observación no excluyente (código 10245). Según varias fuentes, desde el **01/12/2026** el WS **rechaza** (código 10246) si falta el dato. Hay que mandarlo **siempre** desde el día 1. No encontré el texto oficial de ARCA con esa fecha: **A CONFIRMAR**. [OFICIAL + SECUNDARIA]
6. **Ley 27.743 (Transparencia Fiscal)**: **no agrega campos al WS**. Solo cambia la representación impresa/PDF: leyenda «Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)» con «IVA Contenido» y «Otros Impuestos Nacionales Indirectos». [OFICIAL]
7. **Padrón para autocompletar razón social y condición de IVA**: usar **`ws_sr_constancia_inscripcion` → `getPersona_v2`**, que trae impuestos y monotributo. `ws_sr_padron_a13` solo trae identidad y domicilios, sin impuestos; sirve de respaldo. [OFICIAL]
8. **Usar los hosts `*.afip.gov.ar`**. Las variantes `*.arca.gob.ar` que aparecen en algunos manuales nuevos están incompletas: algunas no resuelven y otras tienen certificado TLS que no coincide. [VERIFICADO]
9. **UX clave para el instructivo**: la **plataforma puede generar la clave privada y el CSR**, así el usuario no toca OpenSSL. El usuario pega el CSR en ARCA, descarga el `.crt` y lo sube. La clave nunca sale del servidor.
10. **Prerrequisitos de la SAS** que hacen fallar `FECAESolicitar` (código 10000): ser RI activo con actividad activa, estar habilitada a emitir electrónicos y clase A, y tener **Domicilio Fiscal Electrónico activo**. Además necesita un **punto de venta propio de Web Services (RECE)**, **distinto del que usa Thinkeon**; si no, choca la numeración (10016). [OFICIAL]

---

## 1. Endpoints y hosts

### 1.1 Tabla de endpoints (vigentes al 08/10/2026)

| Servicio | Homologación | Producción | ID para WSAA (`<service>`) |
|---|---|---|---|
| WSAA (`LoginCms`) | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` | `https://wsaa.afip.gov.ar/ws/services/LoginCms` | — |
| WSFEv1 | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` | `https://servicios1.afip.gov.ar/wsfev1/service.asmx` | `wsfe` |
| Constancia de inscripción (ex A5) | `https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5` | `https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5` | `ws_sr_constancia_inscripcion` |
| Padrón A13 | `https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13` | `https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13` | `ws_sr_padron_a13` |

Fuentes: WSAA [página WSAA](https://www.afip.gob.ar/ws/documentacion/wsaa.asp) y [Manual del Desarrollador WSAA 20.2.19](https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf). WSFEv1 [manual v4.7, §«Dirección URL»](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf). Constancia [manual v4.1, §2.4–2.5](https://www.afip.gob.ar/ws/WSCI/manual_ws_sr_ws_constancia_inscripcion.pdf). A13 [manual v1.4, §2.3–2.4](https://www.afip.gob.ar/ws/ws-padron-a13/manual-ws-sr-padron-a13-v1.4.pdf). Los WSDL se obtienen agregando `?wsdl` / `?WSDL`.

### 1.2 Ojo con los dominios «arca» [VERIFICADO 08/10/2026]

Los manuales nuevos mezclan dominios. Esto es lo que probé:

| Host | Resultado |
|---|---|
| `wsaa.arca.gob.ar` | Anda: el certificado TLS incluye el SAN `wsaa.arca.gob.ar`, pero el WSDL sigue anunciando `wsaa.afip.gov.ar`. |
| `wsaahomo.arca.gob.ar` | **No resuelve** (ENOTFOUND). |
| `aws.arca.gob.ar` (padrón prod) | Anda (certificado `*.arca.gob.ar`). |
| `awshomo.arca.gob.ar` | **No resuelve**, aunque el manual de constancia v4.1 lo indica para testing. |
| `servicios1.arca.gob.ar`, `wswhomo.arca.gob.ar` | Resuelven, pero el **certificado no coincide** (`ERR_TLS_CERT_ALTNAME_INVALID`). |
| `wsaa.arca.gov.ar` / `wsaahomo.arca.gov.ar` (FAQ 10.1 del manual WSAA) | **No resuelven**. |

**Recomendación**: hosts `*.afip.gov.ar` en configuración por ambiente, nunca hardcodeados en la lógica. No fijar (pin) certificados del servidor: todos son de **Sectigo** (CA pública, confiable para Node) y rotan; el de `servicios1` vence el 18/10/2026.

---

## 2. WSAA (autenticación)

### 2.1 Flujo oficial [OFICIAL]

Según la [Especificación Técnica WSAA 1.2.2, «Flujo Principal»](https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf):

1. Generar el TRA (`LoginTicketRequest.xml`).
2. Generar un CMS que contenga el TRA, su firma electrónica y el certificado X.509.
3. Codificar el CMS en Base64.
4. Invocar `loginCms` y recibir `LoginTicketResponse.xml`.
5. Extraer y validar el TA (Ticket de Acceso).

### 2.2 TRA (`loginTicketRequest`) exacto

XSD oficial (especificación 1.2.2):

- Raíz `loginTicketRequest`, con atributo `version` opcional (decimal, default `1.0`).
- `header`:
  - `source`: opcional.
  - `destination`: opcional.
  - `uniqueId`: `xsd:unsignedInt`, obligatorio.
  - `generationTime`: `xsd:dateTime`, obligatorio.
  - `expirationTime`: `xsd:dateTime`, obligatorio.
- `service`: patrón `[az,AZ][az,AZ,\,_,09]*`, largo 3–32.

Reglas:

- `uniqueId`: entero de 32 bits sin signo; junto con `generationTime` identifica el requerimiento.
- `generationTime`: «La tolerancia de aceptación será de hasta 24 horas previas al requerimiento de acceso». Si está en el futuro, da `xml.generationTime.invalid`.
- `expirationTime`: «hasta 24 horas posteriores». Si es menor a la hora actual, da `xml.expirationTime.expired`; si supera 24 h, `xml.expirationTime.invalid`.
- `source` / `destination` son opcionales y **se recomienda no incluirlos**: «cuando genere el TRA, no incluya los campos source y destination… para evitar inconvenientes en el futuro si cambian los DN» ([Manual WSAA, FAQ 10.5](https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf)).
- Las mayúsculas y minúsculas del XML importan (FAQ 10.10).

TRA mínimo recomendado. Es el mismo patrón que usa `@arcasdk/core`: `uniqueId` = segundos unix, ventana ±10 min, `toISOString()` UTC ([datetime-ref.ts](https://github.com/ralcorta/arcasdk/blob/main/packages/core/src/infrastructure/utils/datetime-ref.ts), [time.constants.ts](https://github.com/ralcorta/arcasdk/blob/main/packages/core/src/infrastructure/constants/time.constants.ts)) [SECUNDARIA]:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>1791428790</uniqueId>
    <generationTime>2026-10-08T02:46:30.804Z</generationTime>
    <expirationTime>2026-10-08T03:06:30.804Z</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>
```

Los ejemplos de ARCA usan offset local (`2019-09-26T10:09:20-03:00` o `2018-01-29T13:52:57.467-03:00`). Ambos formatos son `xsd:dateTime` válidos.

### 2.3 Requisitos del CMS / PKCS#7

Lo que dice ARCA [OFICIAL]:

- «Se deberá generar un mensaje CMS del tipo “SignedData” que contenga el mensaje… y su firma electrónica utilizando **SHA1+RSA**» (spec 1.2.2, texto histórico).
- El CMS debe contener el certificado X.509.
- El contenido va adjunto (no detached): el ejemplo oficial usa `openssl cms -sign … -nodetach`.

Comando oficial ([Manual WSAA, cap. 5](https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf)):

```
openssl cms -sign -in MiLoginTicketRequest.xml -out MiLoginTicketRequest.xml.cms -signer MiCertificado2019.pem -inkey MiPrivada2019.key -nodetach -outform PEM
```

Lo que sale en la práctica [VERIFICADO]: ese mismo comando con OpenSSL 3.x produce

- digest **SHA-256** (no SHA-1);
- **signed attributes**: `contentType`, `signingTime`, `messageDigest` y `SMIMECapabilities`;
- `signatureAlgorithm` = `rsaEncryption`;
- el certificado incluido.

Es decir, el ejemplo del propio manual de ARCA ya usa SHA-256 con atributos firmados. `@arcasdk/core` (SDK Node mantenido, último push 04/10/2026) firma igual con node-forge: SHA-256, `authenticatedAttributes` = contentType(data) + messageDigest + signingTime, certificado incluido, DER en base64 sin saltos de línea ([crypt-data.ts](https://github.com/ralcorta/arcasdk/blob/main/packages/core/src/infrastructure/utils/crypt-data.ts)) [SECUNDARIA].

**Decisión recomendada**: SHA-256 + RSA PKCS#1 v1.5, contenido adjunto, certificado incluido, atributos firmados `contentType` + `signingTime` + `messageDigest`, SID = `IssuerAndSerialNumber` (SignerInfo v1).

- **Sin atributos firmados**: la especificación no lo prohíbe, pero no lo probé → **A CONFIRMAR** (no usarlo).
- **SHA-1**: lo menciona la especificación, pero está deprecado → no usarlo.

Estructura ASN.1 exacta (RFC 5652), la que implementé y verifiqué:

```
ContentInfo ::= SEQUENCE {
  contentType  OID 1.2.840.113549.1.7.2 (signedData)
  content [0] EXPLICIT SignedData }
SignedData ::= SEQUENCE {
  version INTEGER 1
  digestAlgorithms SET { SEQUENCE { OID 2.16.840.1.101.3.4.2.1 (sha256) } }   -- params ausentes (RFC 5754)
  encapContentInfo SEQUENCE { OID 1.2.840.113549.1.7.1 (data), [0] EXPLICIT OCTET STRING <bytes UTF-8 del TRA> }
  certificates [0] IMPLICIT SET OF Certificate   -- el .crt de ARCA, en DER
  signerInfos SET { SignerInfo } }
SignerInfo ::= SEQUENCE {
  version INTEGER 1
  sid IssuerAndSerialNumber ::= SEQUENCE { issuer Name, serialNumber INTEGER }  -- copiados tal cual del TBSCertificate
  digestAlgorithm SEQUENCE { OID sha256 }
  signedAttrs [0] IMPLICIT SET OF Attribute {
     { OID 1.2.840.113549.1.9.3 contentType,   SET { OID data } }
     { OID 1.2.840.113549.1.9.5 signingTime,   SET { UTCTime } }
     { OID 1.2.840.113549.1.9.4 messageDigest, SET { OCTET STRING sha256(TRA) } } }
  signatureAlgorithm SEQUENCE { OID 1.2.840.113549.1.1.1 rsaEncryption, NULL }
  signature OCTET STRING  -- RSA-SHA256 sobre el DER de signedAttrs codificado como SET (tag 0x31), NO con tag [0] (0xA0)
}
```

Trampas de DER:

1. Se firma el `SET OF Attribute` con tag **0x31**, y en el `SignerInfo` va re-etiquetado como `[0]` (**0xA0**).
2. Un `SET OF` en DER se ordena por codificación (X.690 §11.6).
3. `issuer` y `serial` se copian **byte a byte** del certificado, no se reconstruyen desde strings. Node expone `new crypto.X509Certificate(pem).raw`, pero no el issuer en DER, así que hace falta un mini lector DER (incluido abajo).

#### 2.3.1 Implementación de referencia sin dependencias [VERIFICADO]

La validé con `openssl cms -verify -inform DER -noverify` («CMS Verification successful», contenido idéntico) y con WSAA homologación, que respondió `cms.cert.untrusted`: estructura parseada, falla recién la confianza porque el certificado es autofirmado.

`der.mjs` (encoder/lector DER mínimo):

```js
import { Buffer } from 'node:buffer';
const encLen = (n) => { if (n < 0x80) return Buffer.from([n]); const b = []; while (n > 0) { b.unshift(n & 0xff); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); };
export const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), encLen(body.length), body]); };
export const seq = (...p) => tlv(0x30, ...p);
export const set = (...p) => tlv(0x31, ...p);
export const setOf = (...p) => tlv(0x31, ...[...p].sort(Buffer.compare)); // DER SET OF ordenado
export const nul = () => Buffer.from([0x05, 0x00]);
export const octet = (b) => tlv(0x04, b);
export const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
export const printable = (s) => { if (!/^[A-Za-z0-9 '()+,\-./:=?]*$/.test(s)) throw new Error('not PrintableString'); return tlv(0x13, Buffer.from(s, 'ascii')); };
export const bitString = (b) => tlv(0x03, Buffer.from([0x00]), b);
export const int = (v) => { let b = Buffer.isBuffer(v) ? v : Buffer.from(v.toString(16).padStart(2, '0').replace(/^(.(..)*)$/, '0$1'), 'hex');
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return tlv(0x02, b); };
export const oid = (s) => { const a = s.split('.').map(Number); const out = [40 * a[0] + a[1]];
  for (const n0 of a.slice(2)) { let n = n0; const t = [n & 0x7f]; n = Math.floor(n / 128); while (n > 0) { t.unshift(0x80 | (n & 0x7f)); n = Math.floor(n / 128); } out.push(...t); }
  return tlv(0x06, Buffer.from(out)); };
export const utcTime = (d) => { const p = (x) => String(x).padStart(2, '0');
  return tlv(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, 'ascii')); };
export const explicit = (n, ...p) => tlv(0xa0 + n, ...p);
export const implicitConstructed = (n, der) => { const b = Buffer.from(der); b[0] = 0xa0 + n; return b; };
export function readTLV(buf, off = 0) { let len = buf[off + 1], hdr = 2; if (len & 0x80) { const k = len & 0x7f; len = 0; for (let i = 0; i < k; i++) len = len * 256 + buf[off + 2 + i]; hdr += k; }
  return { tag: buf[off], end: off + hdr + len, body: buf.subarray(off + hdr, off + hdr + len), raw: buf.subarray(off, off + hdr + len) }; }
export function children(n) { const out = []; let o = 0; while (o < n.body.length) { const c = readTLV(n.body, o); out.push(c); o = c.end; } return out; }
```

`cms.mjs` (TRA + firma):

```js
import crypto from 'node:crypto';
import { seq, setOf, set, int, oid, nul, octet, utcTime, explicit, implicitConstructed, readTLV, children } from './der.mjs';
const OID = { data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5', sha256: '2.16.840.1.101.3.4.2.1', rsaEncryption: '1.2.840.113549.1.1.1' };
function issuerAndSerial(certDer) { const f = children(children(readTLV(certDer, 0))[0]); const i = f[0].tag === 0xa0 ? 1 : 0; return { serial: f[i].raw, issuer: f[i + 2].raw }; }
export function signTra(traXml, certPem, keyPem, now = new Date()) {
  const content = Buffer.from(traXml, 'utf8');
  const certDer = new crypto.X509Certificate(certPem).raw;
  const { serial, issuer } = issuerAndSerial(certDer);
  const sha256Alg = seq(oid(OID.sha256));
  const signedAttrsSet = setOf(
    seq(oid(OID.contentType), set(oid(OID.data))),
    seq(oid(OID.signingTime), set(utcTime(now))),
    seq(oid(OID.messageDigest), set(octet(crypto.createHash('sha256').update(content).digest()))));
  const signature = crypto.sign('sha256', signedAttrsSet, crypto.createPrivateKey(keyPem)); // RSASSA-PKCS1-v1_5
  const signerInfo = seq(int(1), seq(issuer, serial), sha256Alg, implicitConstructed(0, signedAttrsSet), seq(oid(OID.rsaEncryption), nul()), octet(signature));
  const signedData = seq(int(1), set(sha256Alg), seq(oid(OID.data), explicit(0, octet(content))), implicitConstructed(0, set(certDer)), set(signerInfo));
  return seq(oid(OID.signedData), explicit(0, signedData)).toString('base64'); // va en <in0>, una sola línea
}
export function buildTra(service, now = new Date()) {
  const iso = (d) => d.toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${iso(new Date(now.getTime() - 600_000))}</generationTime>` +
    `<expirationTime>${iso(new Date(now.getTime() + 600_000))}</expirationTime>` +
    `</header><service>${service}</service></loginTicketRequest>`;
}
```

### 2.4 `LoginCms`: request y response

El WSDL es Apache Axis 1.4, SOAP 1.1 document/literal, `soapAction=""`. Elementos en el namespace `http://wsaa.view.sua.dvadac.desein.afip.gov` con `elementFormDefault="qualified"`: `loginCms/in0 : xsd:string` y `loginCmsResponse/loginCmsReturn : xsd:string` [VERIFICADO sobre el WSDL vivo]. El manual usa `SOAPAction: urn:LoginCms` en su ejemplo con curl; yo probé `SOAPAction: ""` y anda [VERIFICADO].

Request:

```http
POST /ws/services/LoginCms HTTP/1.1
Host: wsaa.afip.gov.ar
Content-Type: text/xml; charset=utf-8
SOAPAction: ""
```

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>MIIG2AYJKoZIhvcNAQcCoIIGyTCC…</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>
```

Response OK. `loginCmsReturn` es un `xsd:string` que contiene XML: hay que **decodificar entidades** (`&lt; &gt; &amp; &quot; &apos;`) antes de parsear. Conviene tolerar también CDATA (A CONFIRMAR cuál de los dos manda exactamente; el string viene escapado por ser `xsd:string`).

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">
      <loginCmsReturn>&lt;?xml version="1.0" encoding="UTF-8" standalone="yes"?&gt;&lt;loginTicketResponse version="1.0"&gt;…</loginCmsReturn>
    </loginCmsResponse>
  </soapenv:Body>
</soapenv:Envelope>
```

`loginTicketResponse`, ya decodificado (ejemplo del [manual](https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf), cap. 6.2):

```xml
<loginTicketResponse version="1.0">
  <header>
    <source>CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239</source>
    <destination>SERIALNUMBER=CUIT 20190178154, CN=glarriera20190903</destination>
    <uniqueId>3866895167</uniqueId>
    <generationTime>2019-09-26T13:56:14.467-03:00</generationTime>
    <expirationTime>2019-09-27T01:56:14.467-03:00</expirationTime>
  </header>
  <credentials>
    <token>PD94bWwgdmVyc2lv…</token>
    <sign>Urp5dbarIb8m5y…</sign>
  </credentials>
</loginTicketResponse>
```

- `token` y `sign` se mandan tal cual en cada WSN: `Auth/Token` y `Auth/Sign` en WSFEv1; `token`/`sign` en Padrón.
- El `token` es base64 de un XML SSO con `exp_time` (epoch), `service` y **`relations`**, que son las CUIT que ese certificado puede representar. Decodificarlo sirve para diagnosticar el error 601 de WSFEv1 («CUIT representada no incluida en token»). [OFICIAL, manual cap. 6.3]

Response de error (SOAP Fault, **HTTP 500**). Respuesta real de homologación con mi CMS autofirmado [VERIFICADO]:

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" …><soapenv:Body><soapenv:Fault>
  <faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:cms.cert.untrusted</faultcode>
  <faultstring>Certificado no emitido por AC de confianza</faultstring>
  <detail><ns2:exceptionName xmlns:ns2="http://xml.apache.org/axis/">gov.afip.desein.dvadac.sua.view.wsaa.LoginFault</ns2:exceptionName>
  <ns3:hostname xmlns:ns3="http://xml.apache.org/axis/">wsaaext1.homo.afip.gov.ar</ns3:hostname></detail>
</soapenv:Fault></soapenv:Body></soapenv:Envelope>
```

Con base64 inválido devuelve `ns1:cms.bad.base64` / «No se puede decodificar el BASE64» [VERIFICADO].

### 2.5 Vida del TA, caché y «ya posee un TA válido»

- **El TA dura 12 h** desde su emisión. «Los CEE que hayan obtenido TA para un determinado servicio, deberán utilizarlo mientras sea valido, antes de solicitar uno nuevo» (spec 1.2.2). La vigencia real viene en `expirationTime`. [OFICIAL]
- **`coe.alreadyAuthenticated`** («El CEE ya posee un TA valido para el acceso al WSN solicitado»). El manual WSAA (FAQ 10.6) dice textualmente: «ACTUALMENTE ESE LAPSO PREVENTIVO ES DE 10 MINUTOS EN EL WSAA DE TESTING Y 2 MINUTOS EN EL WSAA DE PRODUCCION. TENER EN CUENTA QUE ESTOS VALORES PUEDEN SER MODIFICADOS DINÁMICAMENTE Y SIN AVISO PREVIO». [OFICIAL] La comunidad reporta que a veces no dan otro TA hasta que vence ([pyafipws](https://groups.google.com/g/pyafipws/c/faq4C4nWmSM), [afipts FAQ](https://www.afipts.com/faq/errors.html)) [SECUNDARIA].
- **Política de reintentos oficial** (spec 1.2.2):
  - Ante errores **distintos** de `wsaa.*` o `wsn.unavailable`, no pedir TA nuevos «hasta que no hayan solucionado el inconveniente».
  - Ante `wsaa.*` / `wsn.unavailable`, no pedir TA nuevos «dentro de los siguientes 60 segundos».

Diseño recomendado para serverless (Vercel), donde cada instancia arranca sin memoria:

1. Caché del TA **en la base**, cifrado (pgcrypto, igual que los tokens de Meta). Clave: `(tenant_id, ambiente, servicio, alias del certificado)`; guarda `token`, `sign`, `generation_time`, `expiration_time`.
2. Reusar el TA hasta `expiration_time - 10 min`.
3. Refrescar **bajo lock** (`pg_advisory_xact_lock` sobre hash de la clave) para que dos funciones no pidan TA a la vez, que es justo lo que provoca `coe.alreadyAuthenticated`.
4. Si llega `coe.alreadyAuthenticated` y no hay TA en caché (se perdió), esperar con backoff (2–10 min) y reintentar. Plan B: otro alias/certificado, porque el TA se emite «por CEE» (A CONFIRMAR si es por DN o por certificado).
5. **No compartir el mismo certificado entre ambientes**: una laptop de desarrollo y Vercel pidiendo TA con el mismo certificado se pisan. Homologación usa un certificado WSASS; producción, uno propio.

### 2.6 Reloj (clock skew)

- ARCA pide sincronizar por NTP («time.afip.gov.ar u otros») y, si se usa hora local, zona **GMT-3** (spec 1.2.2 y manual FAQ 10.7/10.9). Sugiere restar «algunos minutos» a `generationTime`. [OFICIAL]
- En Vercel la hora está sincronizada y es UTC: usar `toISOString()` (Z) con `generationTime = ahora − 10 min` y `expirationTime = ahora + 10 min`.

### 2.7 Códigos de error del WSAA [OFICIAL, spec 1.2.2]

| Código | Descripción |
|---|---|
| `coe.notAuthorized` | CEE no autorizado a acceder a los servicios de ARCA |
| `coe.alreadyAuthenticated` | Ya dispone de TA válido para ese WSN |
| `cms.bad` / `cms.bad.base64` | CMS inválido / no se puede decodificar el BASE64 |
| `cms.cert.notFound` | No hay certificado de firma en el CMS |
| `cms.sign.invalid` | Firma inválida o algoritmo no soportado |
| `cms.cert.expired` / `cms.cert.invalid` / `cms.cert.untrusted` | Certificado expirado / con fecha futura / no emitido por AC de confianza (p. ej. certificado de homologación contra producción) |
| `xml.bad` | No valida contra el schema |
| `xml.source.invalid` / `xml.destination.invalid` | `source` / `destination` no coinciden con el DN |
| `xml.version.notSupported` | Versión no soportada |
| `xml.generationTime.invalid` | `generationTime` en el futuro o con más de 24 h |
| `xml.expirationTime.expired` / `xml.expirationTime.invalid` | Ya expiró / supera 24 h |
| `wsn.unavailable` / `wsn.notFound` | WSN fuera de servicio / inexistente |
| `wsaa.unavailable` / `wsaa.internalError` | WSAA caído / error interno |

Mensajes frecuentes del manual (cap. 10): «Computador no autorizado a acceder al servicio» (falta la relación o la delegación, o el `service` está mal) y «Certificado no emitido por AC de confianza» (certificado de homologación usado contra producción o al revés).

---

## 3. Clave privada, CSR y certificado

### 3.1 Requisitos [OFICIAL]

Fuentes: [WSASS «Cómo generar CSR»](https://www.afip.gob.ar/ws/WSASS/html/generarcsr.html), [Manual WSASS §4](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf) y spec 1.2.2 «Requerimientos de los certificados».

- **RSA 2048 bits**: `openssl genrsa -out MiClavePrivada.key 2048`.
- CSR: `openssl req -new -key MiClavePrivada.key -subj "/C=AR/O=Empresa/CN=Sistema/serialNumber=CUIT nnnnnnnnnnn" -out MiPedidoCSR.csr`.
- `serialNumber` (OID 2.5.4.5) = literal **`CUIT` + espacio + 11 dígitos sin guiones**, en PrintableString.
- `O` = nombre de la empresa; `CN` = nombre del sistema; `C` = `AR` (ISO 3166).
- Firma del CSR: SHA-256 con RSA (`sha256WithRSAEncryption`, default de OpenSSL 3).
- Formato PEM (`-----BEGIN CERTIFICATE REQUEST-----`).

### 3.2 CSR con Node puro [VERIFICADO]

`openssl req -verify` responde «self-signature verify OK», `subject=C=AR, O=HUB SAS, CN=hub-plataforma, serialNumber=CUIT 30123456789`.

```js
import crypto from 'node:crypto';
import { seq, set, int, oid, nul, utf8, printable, bitString, tlv } from './der.mjs';
const rdn = (type, v) => set(seq(oid(type), v));
export function buildCsr({ privateKey, publicKey, org, cn, cuit }) {   // keys: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  if (!/^\d{11}$/.test(cuit)) throw new Error('CUIT de 11 dígitos');
  const subject = seq(rdn('2.5.4.6', printable('AR')), rdn('2.5.4.10', utf8(org)), rdn('2.5.4.3', utf8(cn)), rdn('2.5.4.5', printable(`CUIT ${cuit}`)));
  const info = seq(int(0), subject, publicKey.export({ type: 'spki', format: 'der' }), tlv(0xa0)); // attributes [0] vacío
  const der = seq(info, seq(oid('1.2.840.113549.1.1.11'), nul()), bitString(crypto.sign('sha256', info, privateKey)));
  return `-----BEGIN CERTIFICATE REQUEST-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;
}
```

UX propuesta: la plataforma genera el par de claves, guarda la privada **cifrada** (`privateKey.export({type:'pkcs8',format:'pem'})`) y muestra el CSR para copiar y pegar. El usuario sube el `.crt` que descarga de ARCA. Al subirlo, validar que la clave pública del `.crt` coincide con la privada guardada: comparar `X509Certificate.publicKey.export({type:'spki',format:'der'})` con la pública derivada de la privada.

### 3.3 Qué devuelve ARCA y cuánto dura

- **Homologación (WSASS)**: devuelve un X.509 en **PEM** (`-----BEGIN CERTIFICATE-----`). El DN queda `SERIALNUMBER=CUIT nnnnnnnnnnn, CN=<alias>`. Los certificados no se pueden borrar ([WSASS «Crear certificado»](https://www.afip.gob.ar/ws/WSASS/html/crearcertificado.html)). [OFICIAL]
  - WSASS **solo se usa con clave fiscal de persona física** y siempre emite el certificado a la CUIT de esa persona.
  - Para operar por la SAS en homologación: «Crear Autorización a Servicio» con **CUIT representada = la de la SAS** y servicio `wsfe` ([Manual WSASS §3.3 y FAQ 12.2–12.3](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf); [cómo adherirse](https://www.afip.gob.ar/ws/WSASS/WSASS_como_adherirse.pdf)). [OFICIAL]
- **Producción**: servicio «**Administración de Certificados Digitales**» → «Agregar alias» → subir el CSR → «Ver» → descargar el certificado ([PDF oficial](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)). Se descarga como **`.crt`** [SECUNDARIA: [Fierro](https://soporte.fierro.com.ar/portal/es/kb/articles/renovar-certificado-factura-electronica)]. Formato PEM o DER **A CONFIRMAR**: aceptar ambos (si no empieza con `-----BEGIN`, convertir DER a PEM).
- **Vigencia: 2 años** para certificados emitidos desde el 03/01/2024: «los certificados digitales obtenidos mediante el servicio 'Administración de Certificados Digitales' contarán con una vigencia de 2 años» (comunicado de AFIP citado por [Bit Ingeniería](https://bitingenieria.com.ar/afip-certificados-renovacion/)) [SECUNDARIA]. Para renovar hace falta un **alias nuevo** ([Fierro](https://soporte.fierro.com.ar/portal/es/kb/articles/renovar-certificado-factura-electronica)). La app debería avisar unos 30 días antes leyendo `X509Certificate.validTo`.
- **Asociar el certificado al WS** (producción): «Administrador de Relaciones de Clave Fiscal» → «Nueva Relación» → buscar el WSN («Facturación Electrónica») → Representante = el **computador fiscal** (alias) → Confirmar ([PDF oficial](https://www.afip.gob.ar/ws/WSAA/wsaa_asociar_certificado_a_wsn_produccion.pdf); [Delegación de Webservices](https://www.afip.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)). Hay que hacer lo mismo para «Constancia de Inscripción» si se usa el padrón. El nombre exacto de cada servicio en el listado (p. ej. «ARCA - WebService - Facturación Electrónica») es **A CONFIRMAR** con capturas actuales.
- **Cadenas de CA** de producción vigentes «2024 hasta 2035» ([certificados.asp](https://www.afip.gob.ar/ws/documentacion/certificados.asp)). Para el cliente no hacen falta: el TLS de los servidores es Sectigo.

### 3.4 Dos modelos posibles para la plataforma multi-tenant (decisión de producto)

El [documento oficial de delegación](https://www.afip.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf) describe dos situaciones:

- **Situación 1, desarrollo propio**: cada bar genera su certificado (su CUIT) y lo relaciona a su propio computador fiscal. La plataforma guarda un par clave/certificado **por tenant**.
- **Situación 2, tercerización**: el bar **delega** el WS a la CUIT del proveedor (Nueva Relación → representante = CUIT del proveedor, constancia F3283/E). El proveedor **acepta** la designación y asigna uno de sus computadores fiscales. Un solo certificado de la plataforma alcanza para todos los bares, y el token trae a cada CUIT delegante en `relations`.

Para HUB hoy, la situación 1 es lo directo (la SAS es dueña de su certificado). La situación 2 da mejor UX a futuro (el bar solo «delega», sin CSR), pero exige que la plataforma tenga su propia CUIT y asuma ese rol. **Decisión A CONFIRMAR con Nacho**.

---

## 4. WSFEv1 (Factura electrónica, RG 4291)

Manual vigente: **«RG 4291 – Proyecto FE v4.7», revisión del 01/09/2026** (el PDF del sitio tiene Last-Modified 31/08/2026) ([PDF](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf), [índice de manuales](https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp)). Gosocket menciona una «v4.8» ([nota](https://gosocket.net/centro-de-recursos/argentina-arca-publica-la-v4-8-del-manual-del-desarrollador-wsfev1/), devuelve 403), pero al 08/10/2026 ARCA sigue sirviendo la 4.7 → **v4.8 A CONFIRMAR**.

### 4.1 Transporte y SOAP [VERIFICADO]

- ASMX (.NET) con bindings **SOAP 1.1 (`ServiceSoap`)** y **SOAP 1.2 (`ServiceSoap12`)** en la misma URL. Namespace: `http://ar.gov.afip.dif.FEV1/`.
- **SOAP 1.1 (recomendado)**: `Content-Type: text/xml; charset=utf-8` y `SOAPAction: "http://ar.gov.afip.dif.FEV1/<Metodo>"`.
  - Con un SOAPAction incorrecto o **vacío (`""`)** responde **HTTP 500**: `soap:Client` «Server did not recognize the value of HTTP Header SOAPAction».
  - **Sin el header** enruta por el body y anda, pero no conviene depender de eso: **mandar siempre el SOAPAction exacto**.
- SOAP 1.2: `Content-Type: application/soap+xml; charset=utf-8; action="http://ar.gov.afip.dif.FEV1/<Metodo>"`. Probado con FEDummy: anda.
- Los errores de negocio vuelven con **HTTP 200** dentro de `<Errors>`; los SOAP Fault (HTTP 500) son errores de protocolo.
- Cada respuesta trae `soap:Header/FEHeaderInfo` (`ambiente`, `fecha`, `id`). Valores reales: `HomologacionExterno - srt` y `Produccion - sr5`.
- Ojo: varios ejemplos de respuesta del manual muestran el envelope de SOAP 1.2 (`http://www.w3.org/2003/05/soap-envelope`); si pedís SOAP 1.1, la respuesta vuelve en SOAP 1.1.
- Para los nombres de elementos, manda el **WSDL** sobre el manual. Ejemplos: el detalle de observaciones es `Observaciones > Obs > (Code, Msg)`; el método se llama `FEParamGetCondicionIvaReceptor` (el manual dice por error `FEParamGetCondicionFrenteIvaReceptor`).

### 4.2 Métodos que necesitamos

| Método | Para qué | Request (dentro de `<soapenv:Body>`) | Response clave |
|---|---|---|---|
| `FEDummy` | Salud del servicio (sin auth) | `<ar:FEDummy/>` | `FEDummyResult/{AppServer,DbServer,AuthServer}` = `OK` |
| `FECompUltimoAutorizado` | Último número por PtoVta + tipo | `<ar:FECompUltimoAutorizado><ar:Auth>…</ar:Auth><ar:PtoVta>3</ar:PtoVta><ar:CbteTipo>6</ar:CbteTipo></ar:FECompUltimoAutorizado>` | `FECompUltimoAutorizadoResult/{PtoVta,CbteTipo,CbteNro}`; errores 11000/11001/11002 |
| `FECAESolicitar` | Autorizar y obtener **CAE** | ver §4.4 | ver §4.5 |
| `FECompConsultar` | Recuperar un comprobante emitido (reconciliar timeouts) | `<ar:FECompConsultar><ar:Auth>…</ar:Auth><ar:FeCompConsReq><ar:CbteTipo>6</ar:CbteTipo><ar:CbteNro>123</ar:CbteNro><ar:PtoVta>3</ar:PtoVta></ar:FeCompConsReq></ar:FECompConsultar>` | `FECompConsultarResult/ResultGet`: todos los campos de `FECAEDetRequest`, más `Resultado`, `CodAutorizacion` (el CAE), `EmisionTipo` (tipo de emisión, CAE o CAEA; el string exacto es A CONFIRMAR), `FchVto`, `FchProceso`, `Observaciones`, `PtoVta` y `CbteTipo` [VERIFICADO en el WSDL] |
| `FEParamGetPtosVenta` | Validar que el PtoVta existe y es de WS | `<ar:FEParamGetPtosVenta><ar:Auth>…</ar:Auth></ar:FEParamGetPtosVenta>` | `ResultGet/PtoVenta/{Nro,EmisionTipo,Bloqueado,FchBaja}` |
| `FEParamGetTiposCbte` | Catálogo de tipos de comprobante | `<ar:FEParamGetTiposCbte><ar:Auth>…</ar:Auth></ar:FEParamGetTiposCbte>` | `ResultGet/CbteTipo/{Id,Desc,FchDesde,FchHasta}` |
| `FEParamGetTiposIva` | Catálogo de alícuotas | ídem | `ResultGet/IvaTipo/{Id,Desc,FchDesde,FchHasta}` (en el WSDL `Id` es string) |
| `FEParamGetCondicionIvaReceptor` | Catálogo de condiciones de IVA del receptor (RG 5616) | `<ar:FEParamGetCondicionIvaReceptor><ar:Auth>…</ar:Auth><ar:ClaseCmp>B</ar:ClaseCmp></ar:FEParamGetCondicionIvaReceptor>`; `ClaseCmp` opcional: `A`, `ALEY`, `B`, `C`, `49` | `ResultGet/CondicionIvaReceptor/{Id,Desc,Cmp_Clase}`; error 10244 si `ClaseCmp` es inválido |
| `FECompTotXRequest` | Máximo de registros por request | `<ar:FECompTotXRequest><ar:Auth>…</ar:Auth></ar:FECompTotXRequest>` | `RegXReq` |

`Auth` es siempre `<ar:Auth><ar:Token>…</ar:Token><ar:Sign>…</ar:Sign><ar:Cuit>30XXXXXXXXX</ar:Cuit></ar:Auth>`, donde `Cuit` es la CUIT **emisora o representada**, que tiene que estar en `relations` del token.

Respuesta real de producción a FEDummy [VERIFICADO]:

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" …><soap:Header><FEHeaderInfo xmlns="http://ar.gov.afip.dif.FEV1/"><ambiente>Produccion - sr5</ambiente><fecha>2026-10-07T23:54:40.7402751-03:00</fecha><id>7.0.0.60</id></FEHeaderInfo></soap:Header>
<soap:Body><FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse></soap:Body></soap:Envelope>
```

Respuesta real con token inválido (HTTP 200) [VERIFICADO]:

```xml
<FECompUltimoAutorizadoResult><PtoVta>0</PtoVta><CbteTipo>0</CbteTipo><CbteNro>0</CbteNro><Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No valido token. …</Msg></Err></Errors></FECompUltimoAutorizadoResult>
```

### 4.3 `FECAESolicitar`: campos (orden del WSDL)

Los elementos de una `sequence` van **en este orden**:

- `FeCabReq`: `CantReg` (1–9998), `PtoVta` (1–99998), `CbteTipo`. Todos los registros del request deben ser del mismo tipo y punto de venta.
- `FeDetReq/FECAEDetRequest`, en orden:

| Campo | Tipo | Oblig. | Regla |
|---|---|---|---|
| `Concepto` | int | S | 1 Productos, 2 Servicios, 3 Productos y Servicios |
| `DocTipo` | int | S | 80 CUIT, 86 CUIL, 96 DNI, 99 Doc. (Otro) / consumidor final anónimo |
| `DocNro` | long | S | 0 si `DocTipo` = 99 |
| `CbteDesde` / `CbteHasta` | long | S | = último autorizado + 1. Para A y C, Desde = Hasta (10011/10012) |
| `CbteFch` | string `yyyymmdd` | N | Concepto 1: N±5 días y sin pasar el mes de presentación. Concepto 2/3: N±10. Tiene que ser ≥ la fecha del último del mismo tipo y PtoVta |
| `ImpTotal` | double (13+2) | S | = `ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA` (10048) |
| `ImpTotConc` | double | S | Neto no gravado (0 en clase C) |
| `ImpNeto` | double | S | Neto gravado = Σ `AlicIva.BaseImp` (10061) |
| `ImpOpEx` | double | S | Exento |
| `ImpTrib` | double | S | Σ `Tributo.Importe` (10029) |
| `ImpIVA` | double | S | Σ `AlicIva.Importe` (10023). Si es > 0, el array `Iva` es obligatorio (10018/10070) |
| `FchServDesde` / `FchServHasta` / `FchVtoPago` | `yyyymmdd` | N | **Obligatorios si `Concepto` = 2 o 3** (10049) |
| `MonId` | string(3) | S | `PES` |
| `MonCotiz` | double (4+6) | N, pero en la práctica S | **Obligatorio e igual a 1 si `MonId` = PES** (10039) |
| `CanMisMonExt` | `S`/`N` | N | Con PES, omitir o mandar `N` (10241) |
| `CondicionIVAReceptorId` | int | N → será S | RG 5616, ver §4.6 |
| `CbtesAsoc/CbteAsoc` | `Tipo`, `PtoVta`, `Nro`, `Cuit`?, `CbteFch`? | N | Para ND/NC: obligatorio esto **o** `PeriodoAsoc` (10197) |
| `Tributos/Tributo` | `Id`, `Desc`?, `BaseImp`, `Alic`, `Importe` | N | Solo si `ImpTrib` > 0 (10024). `Desc` es obligatoria si `Id` = 99 |
| `Iva/AlicIva` | `Id`, `BaseImp`, `Importe` | N | Un renglón por alícuota, sin repetir `Id` (10022) |
| `Opcionales`, `Compradores`, `PeriodoAsoc` (`FchDesde`, `FchHasta`), `Actividades` | — | N | No hacen falta para el bar, salvo `PeriodoAsoc` en NC/ND sin comprobante asociado |

Fuente: manual v4.7, «Mensaje de solicitud», tablas y validaciones 10001–10284; orden y tipos según el [WSDL de homologación](https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL) [VERIFICADO].

### 4.4 Ejemplos de request

HUB es RI. Los ejemplos van con PtoVta 3 a modo ilustrativo; usar el PtoVta RECE real.

**Factura B (6) a consumidor final anónimo**, $12.100 finales con IVA 21% incluido:

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
 <soapenv:Header/>
 <soapenv:Body>
  <ar:FECAESolicitar>
   <ar:Auth><ar:Token>…</ar:Token><ar:Sign>…</ar:Sign><ar:Cuit>30XXXXXXXXX</ar:Cuit></ar:Auth>
   <ar:FeCAEReq>
    <ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>3</ar:PtoVta><ar:CbteTipo>6</ar:CbteTipo></ar:FeCabReq>
    <ar:FeDetReq>
     <ar:FECAEDetRequest>
      <ar:Concepto>1</ar:Concepto>
      <ar:DocTipo>99</ar:DocTipo>
      <ar:DocNro>0</ar:DocNro>
      <ar:CbteDesde>101</ar:CbteDesde>
      <ar:CbteHasta>101</ar:CbteHasta>
      <ar:CbteFch>20261008</ar:CbteFch>
      <ar:ImpTotal>12100.00</ar:ImpTotal>
      <ar:ImpTotConc>0.00</ar:ImpTotConc>
      <ar:ImpNeto>10000.00</ar:ImpNeto>
      <ar:ImpOpEx>0.00</ar:ImpOpEx>
      <ar:ImpTrib>0.00</ar:ImpTrib>
      <ar:ImpIVA>2100.00</ar:ImpIVA>
      <ar:MonId>PES</ar:MonId>
      <ar:MonCotiz>1</ar:MonCotiz>
      <ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>
      <ar:Iva>
       <ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>10000.00</ar:BaseImp><ar:Importe>2100.00</ar:Importe></ar:AlicIva>
      </ar:Iva>
     </ar:FECAEDetRequest>
    </ar:FeDetReq>
   </ar:FeCAEReq>
  </ar:FECAESolicitar>
 </soapenv:Body>
</soapenv:Envelope>
```

- **Factura A (1) a un RI**: igual que la B, con `CbteTipo` 1, `DocTipo` 80, `DocNro` = CUIT del cliente y `CondicionIVAReceptorId` 1.
  - La clase A exige `DocTipo` 80 (10013).
  - El receptor tiene que figurar activo en IVA o monotributo en el padrón; si no, aparecen las observaciones 10017/10063.
  - **Factura A a un monotributista**: `CondicionIVAReceptorId` 6 (o 13 / 16). El PDF lleva la leyenda de la Ley 27.618, ver §4.7.
- **Nota de crédito B (8)** que anula total o parcialmente la factura B 3-101. Importes **positivos**:

```xml
<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>3</ar:PtoVta><ar:CbteTipo>8</ar:CbteTipo></ar:FeCabReq>
<ar:FeDetReq><ar:FECAEDetRequest>
  <ar:Concepto>1</ar:Concepto><ar:DocTipo>99</ar:DocTipo><ar:DocNro>0</ar:DocNro>
  <ar:CbteDesde>7</ar:CbteDesde><ar:CbteHasta>7</ar:CbteHasta><ar:CbteFch>20261008</ar:CbteFch>
  <ar:ImpTotal>12100.00</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>10000.00</ar:ImpNeto>
  <ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>2100.00</ar:ImpIVA>
  <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>
  <ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>
  <ar:CbtesAsoc>
    <ar:CbteAsoc><ar:Tipo>6</ar:Tipo><ar:PtoVta>3</ar:PtoVta><ar:Nro>101</ar:Nro><ar:Cuit>30XXXXXXXXX</ar:Cuit><ar:CbteFch>20261008</ar:CbteFch></ar:CbteAsoc>
  </ar:CbtesAsoc>
  <ar:Iva><ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>10000.00</ar:BaseImp><ar:Importe>2100.00</ar:Importe></ar:AlicIva></ar:Iva>
</ar:FECAEDetRequest></ar:FeDetReq>
```

- **NC A (3)**: igual que la NC B, asociando `Tipo` 1 y con los datos de receptor de la factura A original.
- **ND A (2) / ND B (7)**: igual, con `CbtesAsoc` o `PeriodoAsoc`.

Reglas de asociación (10040):

- A 02/03 se pueden asociar 01, 02, 03, 04, 05, 34, 39, 60, 63, 88 y 991.
- A 07/08 se pueden asociar 06, 07, 08, 09, 10, 35, 40, 61, 64, 88 y 991.
- Si el PtoVta asociado es electrónico, el comprobante tiene que existir en ARCA (observación 10041).
- Si la NC supera el comprobante asociado, sale la observación 10237.
- Para NC/ND es **obligatorio** informar `PeriodoAsoc` (Desde/Hasta) **o al menos un comprobante asociado** (10197). En facturas no se informa `PeriodoAsoc` (10198).

### 4.5 Respuesta de `FECAESolicitar`

```xml
<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
 <FECAESolicitarResult>
  <FeCabResp><Cuit>30XXXXXXXXX</Cuit><PtoVta>3</PtoVta><CbteTipo>6</CbteTipo><FchProceso>20261008123456</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>
  <FeDetResp>
   <FECAEDetResponse>
    <Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>101</CbteDesde><CbteHasta>101</CbteHasta><CbteFch>20261008</CbteFch>
    <Resultado>A</Resultado><CAE>76412345678901</CAE><CAEFchVto>20261018</CAEFchVto>
    <!-- opcional: <Observaciones><Obs><Code>10245</Code><Msg>…</Msg></Obs></Observaciones> -->
   </FECAEDetResponse>
  </FeDetResp>
  <!-- opcional: <Events><Evt><Code/><Msg/></Evt></Events>  <Errors><Err><Code/><Msg/></Err></Errors> -->
 </FECAESolicitarResult>
</FECAESolicitarResponse>
```

Cómo interpretarla (manual v4.7) [OFICIAL]:

- **`Resultado`**: `A` aprobado, `R` rechazado, `P` parcial (este último solo en lotes).
- **Aprobado con observaciones**: hay CAE y además `Observaciones/Obs` con validaciones no excluyentes. Guardarlas y mostrarlas.
- **Rechazado**: sin CAE, con `Obs` o `Errors`.
- **`Errors` a nivel resultado**: problemas del emisor o de autenticación, p. ej. 600 token/firma, 601 CUIT no incluida en el token, 602 sin datos, 500/501/502 errores internos.
- **`Events`**: informativos.
- **`FchProceso`** viene como `yyyymmddhhmiss`; **`CAEFchVto`** como `yyyymmdd`.

### 4.6 `CondicionIVAReceptorId` (RG 5616)

Historia del campo:

- **v4.0 (17/03/2025)**: se agregan `CondicionIVAReceptorId` y `CanMisMonExt` y el método `FEParamGetCondicionIvaReceptor`. «A partir del 6 de abril de 2025 podrá enviarse de forma opcional… hasta tanto entre en vigencia su obligatoriedad reglamentada por la Resolución General N°5616, en cuyo momento pasará a rechazar la emisión de comprobantes sin este dato» (historial del manual v4.7). [OFICIAL]
- **Validaciones vigentes** (manual v4.7) [OFICIAL]:
  - 10242 (excluyente): valor no permitido.
  - 10243 (excluyente): valor no válido para la clase de comprobante.
  - **10246 (excluyente)**: «Campo Condición Frente al IVA del receptor es obligatorio conforme a lo reglamentado por la RG 5616».
  - **10245 (no excluyente)**: «resultará obligatorio…». Es la observación que sale hoy si falta.
- **Fecha de rechazo**:
  - RG 5616 ya fijaba la obligatoriedad desde el 15/04/2025, pero el WS lo mantuvo como dato no excluyente ([tusfacturas](https://developers.tusfacturas.app/changelog), [Afip SDK](https://afipsdk.com/blog/factura-electronica-solucion-a-error-10242/)).
  - En agosto de 2026 se publicó que pasaba a obligatorio el 01/09/2026 junto con la v4.7 ([signature.ar, 11/08/2026](https://www.signature.ar/novedades/actualizaci%C3%B3n-arca:-lanzamiento-del-wsfev1-v4.7-y-obligatoriedad-del-iva-receptor)).
  - Luego se informó «dato no excluyente hasta el 30/11/2026, inclusive» y «a partir del 01/12/2026 se rechazarán…» ([Afip SDK](https://afipsdk.com/blog/factura-electronica-solucion-a-error-10242/); [SIAP 08/09/2026](https://siap.blogdelcontador.com.ar/novedades/arca-rechazara-facturas-sin-condicion-iva-receptor-diciembre-2026/); [iProfesional 09/09/2026](https://www.iprofesional.com/impuestos/464104-nuevo-requisito-arca-puede-trabar-emision-facturas); [La Gaceta 18/09/2026](https://www.lagaceta.com.ar/nota/1154550/economia/vencimiento-arca-para-facturas-electronicas-cual-fecha-limite-para-evitar-rechazos)) [SECUNDARIA].
  - **Documento oficial con el 01/12/2026: A CONFIRMAR**. Da igual para la implementación: mandarlo siempre.

Tabla de valores y clase de comprobante permitida ([anexo del manual v4.7](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf); coincide con el [fixture de django-afip](https://github.com/WhyNotHugo/django-afip/tree/main/django_afip/fixtures)):

| Id | Descripción | Clase de comprobante |
|---|---|---|
| 1 | IVA Responsable Inscripto | A / ALEY, C |
| 4 | IVA Sujeto Exento | B, C |
| 5 | Consumidor Final | B, C, 49 |
| 6 | Responsable Monotributo | A / ALEY, C |
| 7 | Sujeto No Categorizado | B, C |
| 8 | Proveedor del Exterior | B, C |
| 9 | Cliente del Exterior | B, C |
| 10 | IVA Liberado – Ley N° 19.640 | B, C |
| 13 | Monotributista Social | A / ALEY, C |
| 15 | IVA No Alcanzado | B, C |
| 16 | Monotributo Trabajador Independiente Promovido | A / ALEY, C |

Para HUB (RI): **Factura A** a 1, 6, 13 y 16; **Factura B** a 4, 5, 7, 8, 9, 10 y 15.

### 4.7 Ley 27.743: Régimen de Transparencia Fiscal al Consumidor

- **No hay campo nuevo en WSFEv1**: el historial v4.0–4.7 no agrega nada por esta ley, y el SDK Node lo trata como tema del PDF ([arcasdk #224](https://github.com/ralcorta/arcasdk/issues/224)). [OFICIAL + SECUNDARIA]
- La **RG 5614/2024** modifica la RG 1415: en el **espacio inferior izquierdo** del comprobante va el título «**Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)**» y debajo «**IVA Contenido**» y «**Otros Impuestos Nacionales Indirectos**», cada uno con su importe. Alcanza a comprobantes A, B, C y E emitidos a consumidores finales. Vigencia: 01/01/2025 para grandes empresas y **01/04/2025** obligatorio para el resto ([texto de la RG 5614](https://www.argentina.gob.ar/normativa/nacional/norma-407183/texto)). [OFICIAL]
- Cálculo práctico ([arcasdk #224](https://github.com/ralcorta/arcasdk/issues/224)) [SECUNDARIA]:
  - IVA Contenido = `ImpIVA`.
  - Otros Impuestos Nacionales Indirectos = Σ tributos de tipo 1 («Impuestos nacionales») y 4 («Impuestos Internos»). Mostrar cada renglón solo si es > 0.
  - Que la contadora confirme si a HUB le corresponde algo en «otros» (impuestos internos en bebidas): **A CONFIRMAR**.
- Leyendas provinciales de transparencia: CABA, Mendoza, Entre Ríos y Chubut tienen las suyas con vigencias 09/2026–01/2027 ([arcasdk #224](https://github.com/ralcorta/arcasdk/issues/224)). **Córdoba: A CONFIRMAR**.
- Otra leyenda obligatoria del PDF: **Factura A de un RI a un monotributista** (condición 6, 13 o 16) debe decir: «El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618» (RG 5003/2021, citado en [arcasdk #224](https://github.com/ralcorta/arcasdk/issues/224); el WS además emite la observación 10217 con un texto parecido).

### 4.8 Importes y redondeo (y cómo calcularlos desde centavos)

- Tipos `double` con **2 decimales** en importes (13+2) y 6 en `MonCotiz` (4+6). Mandar `.` como separador decimal y **nunca más de 2 decimales** (10056).
- Tolerancias: «Error relativo porcentual <= 0.01% o el error absoluto <= 0.01». Para 10023 y 10061 el absoluto se multiplica por la cantidad de alícuotas. «El criterio de redondeo que utilizamos en este servicio es **Round Half Even**» (manual v4.7, «Margen de error»). [OFICIAL]
- Algoritmo para precios finales con IVA incluido (en la carta del bar), trabajando en centavos `bigint` como manda el CLAUDE.md. Por cada alícuota `r` (21% → Id 5, 10,5% → Id 4…):
  1. `T` = Σ precios finales de los ítems con esa alícuota.
  2. `neto = round_half_even(T / (1 + r))`, a centavos.
  3. `iva = T − neto`.

  Así `ImpTotal` cuadra exacto con la suma y `|iva − r·neto| = (1+r)·|T/(1+r) − neto| ≤ 0.00605` < 0.01, de modo que pasa la 10051. Totales: `ImpNeto = Σ neto`, `ImpIVA = Σ iva`, `ImpTotal = Σ T + ImpTrib`. Formatear desde bigint sin pasar por float: `${c / 100n}.${String(c % 100n).padStart(2, '0')}`.
- **Fecha del comprobante (`CbteFch`)**: calcularla en **`America/Argentina/Cordoba`**, nunca en UTC. Vercel corre en UTC, y a las 22:00 de Córdoba ya es el día siguiente en UTC.

### 4.9 Tablas de códigos

Los valores salen de los `FEParamGet*` de ARCA. Los cruzo con los ejemplos del manual (Id 3 = 0%, 4 = 10,5%, 5 = 21%, 6 = 27%) y con el dump en los [fixtures de django-afip](https://github.com/WhyNotHugo/django-afip/tree/main/django_afip/fixtures) [OFICIAL + SECUNDARIA].

- **Alícuotas IVA (`AlicIva.Id`)**: 3 = 0%, 4 = 10,5%, 5 = 21%, 6 = 27%, **8 = 5%**, **9 = 2,5%** (las dos últimas por la Ley 26.982, desde 2014).
- **Tipos de comprobante**:
  - 1 Factura A, 2 ND A, 3 NC A.
  - 6 Factura B, 7 ND B, 8 NC B.
  - 11/12/13 clase C.
  - 51/52/53 «A con leyenda “Operación sujeta a retención”». Reemplaza a la clase M desde el 01/12/2025 (manual v4.1; RG 5762/2025 según [arcasdk #224](https://github.com/ralcorta/arcasdk/issues/224)).
  - 201–213 FCE MiPyME.
- **Documento**: 80 CUIT, 86 CUIL, 87 CDI, 96 DNI, 94 Pasaporte, 99 Doc. (Otro).
- **Concepto**: 1 Productos, 2 Servicios, 3 Productos y Servicios.
- **Tributos**: 1 Imp. nacionales, 2 provinciales, 3 municipales, 4 internos, 5 IIBB, 6 Percepción IVA, 7 Percepción IIBB, 8 Perc. municipales, 9 Otras percepciones, 13 Percepción IVA a no categorizado, 99 Otro.
- **Moneda**: `PES` (cotización 1).
- **Identificar al consumidor final**: solo es obligatorio desde **$10.000.000** por operación (RG 5700/2025, vigente desde el 29/05/2025; [contadoresenred 20/01/2026](https://contadoresenred.com/facturacion-a-partir-de-que-monto-se-debe-identificar-al-consumidor-final-en-2026/), [iProfesional](https://www.iprofesional.com/impuestos/429313-arca-elevo-a-10-millones-el-monto-para-identificar-en-las-facturas-a-consumidores-finales)). Por debajo, Factura B con `DocTipo` 99 y `DocNro` 0 (10015). El WS valida contra el «monto según RG 4444», cuyo valor exacto dentro del WS es **A CONFIRMAR**.
- **Concepto recomendado para un bar**: 1 (Productos), que evita las fechas de servicio. **A CONFIRMAR con la contadora**.
- Nueva en v4.7, la **10284** (excluyente) controla que el número sea coherente con el tipo de documento CUIT. Conviene validar el dígito verificador de la CUIT del lado nuestro (módulo 11, pesos 5,4,3,2,7,6,5,4,3,2).

### 4.10 Errores y observaciones más comunes (manual v4.7) [OFICIAL]

| Código | Qué pasa / qué hacer |
|---|---|
| 600 / 601 | Token y firma no corresponden / la CUIT no está en el token → renovar el TA o revisar la relación o delegación |
| 500 / 501 / **502** | Error interno. **502 = «Transacción Activa»**: hubo dos requests concurrentes para el mismo PtoVta y tipo → serializar |
| 10000 | Problemas del emisor: 01 no es RI, 02 no autorizado a emitir electrónicos o período de inicio posterior, 03 domicilio fiscal, 04 no autorizado clase A, 05 CUIT no activa, 06 sin actividad activa, 09 no autorizado a «A con leyenda», 11 **sin Domicilio Fiscal Electrónico activo** |
| 10005 | El PtoVta no existe o **no es de tipo RECE** (Web Services) |
| 10013 / 10015 | Clase A sin `DocTipo` 80 / reglas de documento de la clase B |
| **10016** | El número no es el último + 1, o la fecha es anterior al último → consultar `FECompUltimoAutorizado` |
| 10018 / 10023 / 10051 / 10061 / 10070 | Inconsistencias del array `Iva` contra `ImpIVA` / `ImpNeto` |
| 10039 | `MonCotiz` tiene que ser 1 con PES |
| 10048 | `ImpTotal` no cuadra con la suma |
| 10049 | Faltan las fechas de servicio con `Concepto` 2 o 3 |
| 10197 | NC/ND sin `CbtesAsoc` ni `PeriodoAsoc` |
| 10242 / 10243 / 10246 / 10245 | `CondicionIVAReceptorId` inválido / no permitido para la clase / obligatorio / observación |
| 10017 / 10063 (obs.) | Receptor de clase A no activo en el padrón o no inscripto en IVA ni monotributo |
| **10192** | Por categoría y monto correspondía **FCE MiPyME**. Puede pasar con eventos corporativos a grandes empresas; el monto mínimo vigente de FCE es A CONFIRMAR |
| 11000 / 11001 / 11002 | `FECompUltimoAutorizado`: PtoVta inválido / tipo inválido / PtoVta no habilitado para el WS |

### 4.11 Errores de comunicación y concurrencia [OFICIAL + recomendación]

- El manual (v4.7, «Operatoria con errores de comunicación») dice que **si hay timeout no hay que reenviar a ciegas**. Primero se usa **`FECompConsultar`** con el número que se intentó emitir, o `FECompUltimoAutorizado`, para saber si ARCA ya otorgó el CAE.
- **Serializar por (tenant, PtoVta, CbteTipo)**:
  1. Tomar un lock en la base (`pg_advisory_xact_lock`).
  2. Llamar a `FECompUltimoAutorizado` y sumar 1.
  3. Llamar a `FECAESolicitar`.
  4. Persistir el CAE.

  Esto evita el 10016 y el 502.
- **Un comprobante por request** (`CantReg` = 1). En lotes, si un comprobante se rechaza, los siguientes quedan «no procesados» (manual v4.7, «Rechazo parcial»).
- `MonCotiz`, cotizaciones y moneda extranjera (RG 5616, `CanMisMonExt`): no aplican a HUB mientras facture en pesos.

### 4.12 Código QR del comprobante (RG 4892) [OFICIAL]

Según la [especificación del QR](https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf):

- El QR codifica `{URL}?p={JSON en Base64}`.
- La especificación dice `{URL}=https://www.arca.gob.ar/fe/qr/`; su propio ejemplo usa `https://www.afip.gob.ar/fe/qr/?p=…`. Cuál conviene usar es **A CONFIRMAR** (es probable que anden los dos).
- JSON versión 1: `{"ver":1,"fecha":"2020-10-13","cuit":30000000007,"ptoVta":10,"tipoCmp":1,"nroCmp":94,"importe":12100,"moneda":"DOL","ctz":65,"tipoDocRec":80,"nroDocRec":20000000001,"tipoCodAut":"E","codAut":70417054367476}`.
  - `tipoCodAut` es `"E"` para CAE y `"A"` para CAEA.
  - `tipoDocRec` / `nroDocRec` van «de corresponder»: con `DocTipo` 99 se omiten (A CONFIRMAR).

---

## 5. Padrón: autocompletar razón social y condición de IVA por CUIT

### 5.1 Cuál conviene

Catálogo oficial: [catalogo.asp](https://www.afip.gob.ar/ws/documentacion/catalogo.asp) [OFICIAL].

- **`ws_sr_constancia_inscripcion`** (ex `ws_sr_padron_a5`, manual **v4.1, marzo 2026**). Método **`getPersona_v2`**, más `getPersonaList_v2` para hasta 250 CUIT. Devuelve:
  - `datosGenerales`: `razonSocial` o `apellido`/`nombre`, `tipoPersona`, `estadoClave`, `domicilioFiscal`, `caracterizacion`, `esSucesion`, `mesCierre`, etc.
  - `datosRegimenGeneral`: `impuesto[]`, `actividad[]`, `regimen[]`, `categoriaAutonomo`.
  - `datosMonotributo`: `impuesto`, `categoriaMonotributo`, `actividadMonotributista`.
  - `errorConstancia` / `errorRegimenGeneral` / `errorMonotributo`.

  **Es el que sirve para razón social + condición de IVA.**
- **`ws_sr_padron_a13`** (manual v1.4, 14/08/2026; métodos `getPersona`, `getPersonaV2`, `getIdPersonaListByDocumento`): identidad, `estadoClave`, domicilios fiscal y legal, `formaJuridica`, actividad principal. **No trae impuestos**, así que no alcanza para deducir la condición de IVA. Sirve como **respaldo** de nombre y domicilio cuando la constancia vuelve con `errorConstancia`, y para **buscar CUIT por DNI**.
- A4 y A10 siguen existiendo, pero no aportan nada para este caso; A5 está deprecado.

### 5.2 `getPersona_v2`: request y response [OFICIAL + VERIFICADO]

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Header/>
  <soapenv:Body>
    <a5:getPersona_v2>
      <token>…</token><sign>…</sign>
      <cuitRepresentada>30XXXXXXXXX</cuitRepresentada>   <!-- debe estar en relations del token -->
      <idPersona>20111111112</idPersona>                 <!-- CUIT a consultar -->
    </a5:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>
```

- Headers: `Content-Type: text/xml; charset=utf-8` y `SOAPAction: ""` (anda) [VERIFICADO].
- `dummy` de producción responde `appserver`/`authserver`/`dbserver` = `OK` [VERIFICADO].
- Los errores son **SOAP Fault, HTTP 500**. Ejemplo real con token inválido: `<faultcode>soap:Server</faultcode><faultstring>Token malformado</faultstring>` [VERIFICADO].
- Los problemas de la persona consultada vienen dentro del `personaReturn` (`errorConstancia/error`, p. ej. «No existe persona con ese Id»). El manual (§5.3) lista los mensajes: CUIT limitada, sin domicilio fiscal electrónico, etc.

Response (recortada del manual v4.1):

```xml
<ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/"><personaReturn>
  <datosGenerales>
    <razonSocial>…</razonSocial>  <!-- o <apellido>/<nombre> si es FISICA -->
    <tipoPersona>JURIDICA</tipoPersona><tipoClave>CUIT</tipoClave><estadoClave>ACTIVO</estadoClave>
    <domicilioFiscal><direccion>…</direccion><localidad>…</localidad><codPostal>…</codPostal><idProvincia>3</idProvincia><descripcionProvincia>CORDOBA</descripcionProvincia><tipoDomicilio>FISCAL</tipoDomicilio></domicilioFiscal>
  </datosGenerales>
  <datosRegimenGeneral>
    <impuesto><descripcionImpuesto>IVA</descripcionImpuesto><estadoImpuesto>AC</estadoImpuesto><idImpuesto>30</idImpuesto><periodo>…</periodo></impuesto>
  </datosRegimenGeneral>
  <!-- o bien -->
  <datosMonotributo>
    <categoriaMonotributo><idImpuesto>20</idImpuesto><descripcionCategoria>B LOCACIONES DE SERVICIO</descripcionCategoria>…</categoriaMonotributo>
    <impuesto><idImpuesto>20</idImpuesto><descripcionImpuesto>MONOTRIBUTO</descripcionImpuesto><estadoImpuesto>AC</estadoImpuesto>…</impuesto>
  </datosMonotributo>
  <errorConstancia><error>…</error></errorConstancia>
</personaReturn></ns2:getPersona_v2Response>
```

### 5.3 Cómo deducir `CondicionIVAReceptorId` desde la constancia

Es la misma lógica de pyafipws ([ws_sr_padron.py](https://github.com/PyAr/pyafipws/blob/main/ws_sr_padron.py), LGPL). Juntando los `idImpuesto` de régimen general y monotributo:

| Condición en el padrón | → `CondicionIVAReceptorId` |
|---|---|
| Impuesto **32** (IVA EXENTO) | 4 Exento |
| Impuesto **30** (IVA), activo | 1 Responsable Inscripto |
| Categoría de monotributo con `idImpuesto` **20** (o **21**), activa | 6 Monotributo. Para distinguir 13 Social y 16 Trabajador Independiente Promovido, mirar la categoría o descripción: **A CONFIRMAR** |
| 34 (IVA NO ALCANZADO) | 15 IVA No Alcanzado |
| 33 (Resp. No Inscripto, legado) | caso legado, A CONFIRMAR |
| Nada de lo anterior | 5 Consumidor Final (o 7 No Categorizado si es CUIT: A CONFIRMAR con la contadora) |

En pyafipws el orden de precedencia es: 32 → EX; si no 33 → NI; si no 34 → NA; si no 30 → RI; si no, monotributo → MT; y si no, CF. Conviene mostrarle siempre al usuario el resultado sugerido y dejar que lo edite.

`estadoImpuesto` sale de la tabla SUPA (`AC` = activo). `getPersonaList_v2` acepta hasta **250** `idPersona` por request (manual v4.1 §3.3). Los límites de tasa no están documentados: **A CONFIRMAR**.

---

## 6. Trampas de Node y Vercel

### 6.1 `dh key too small` en producción [VERIFICADO]

Síntoma, con Node 25.2.1 / OpenSSL 3.6.2 desde Córdoba:

```
fetch https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL
=> ERR_SSL_DH_KEY_TOO_SMALL error:0A00018A:SSL routines:tls_process_ske_dhe:dh key too small
```

Diagnóstico con `openssl s_client`:

- `servicios1.afip.gov.ar` solo habla **TLS 1.2** (no TLS 1.3). Si el cliente ofrece DHE, el servidor elige **DHE-RSA-AES256-GCM-SHA384** con **«Peer Temp Key: DH, 1024 bits»**.
- Si el cliente **no** ofrece DHE, negocia **ECDHE-RSA-AES256-GCM-SHA384** sin problema.
- El resto de los hosts (`wsaa`, `wsaahomo`, `wswhomo`, `aws`, `awshomo`) ya negocian ECDHE con P-256.

Por qué falla:

- OpenSSL **3.2 subió el security level por defecto de 1 a 2**: con nivel 2, «DH keys … less than 2048 bits … are now no longer allowed» ([notas de OpenSSL 3.2](https://openssl-library.org/news/openssl-3.2-notes)).
- **Node 22.20.0 (24/09/2025) pasó a incluir OpenSSL 3.5.2** ([release v22.20.0](https://nodejs.org/en/blog/release/v22.20.0)). En Node 22 actual de Vercel el error aparece; con versiones de Node 22 anteriores (OpenSSL 3.0.x) puede no aparecer.
- Los mismos reportes en el SDK Node: [arcasdk #112](https://github.com/ralcorta/arcasdk/issues/112) (Node 21, producción) y [arcasdk #104](https://github.com/ralcorta/arcasdk/issues/104) (Node 24.11, «`minDHSize` no alcanza»). En Python: [pyafipws #94](https://github.com/reingart/pyafipws/issues/94) y [odoo-argentina #59](https://github.com/ctmil/odoo-argentina/issues/59).

Fixes, en orden de preferencia (los dos primeros los probé contra producción, HTTP 200):

1. **Agent dedicado con solo ECDHE**, que mantiene SECLEVEL 2 y forward secrecy:
   ```js
   import https from 'node:https';
   export const arcaAgent = new https.Agent({
     keepAlive: true,                // reusa TLS entre invocaciones de una misma instancia (≈0,3–0,5 s menos por llamada)
     ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256',
     minVersion: 'TLSv1.2',
   });
   // https.request(url, { method: 'POST', agent: arcaAgent, headers: {...} }, cb)
   ```
2. `ciphers: 'DEFAULT@SECLEVEL=1'` en el agent: acepta DH de 1024. Funciona, pero es más débil.
3. **No usar** `tls.DEFAULT_CIPHERS = 'DEFAULT@SECLEVEL=1'` global ni `NODE_OPTIONS=--tls-cipher-list=…`, que es el «workaround» de los issues: baja la seguridad de **todas** las conexiones TLS del proceso, incluidas Supabase y Meta.
4. `minDHSize: 512` solo **no alcanza**: OpenSSL rechaza antes por el security level ([arcasdk #104](https://github.com/ralcorta/arcasdk/issues/104)).

**Con `fetch`**: el `fetch` global de Node usa undici, pero Node no expone `undici.Agent` sin instalar el paquete npm (dependencia nueva).

- Probé un hack que anda en Node 25: tomar el constructor del dispatcher interno `globalThis[Symbol.for('undici.globalDispatcher.1')]` y pasar `{ dispatcher: new Agent({ connect: { ciphers } }) }` a fetch. Depende de internals: **no recomendado**.
- **Recomendación**: un mini-cliente SOAP sobre **`node:https`** con el agent del punto 1, para los tres servicios.
- **Runtime**: estas llamadas tienen que correr en el **runtime Node.js** (Route Handlers y Server Actions por defecto), no en Edge, que no permite configurar ciphers ni tiene `node:https`.

### 6.2 SOAP 1.1 vs 1.2 (resumen) [VERIFICADO]

| Servicio | Recomendado | Headers |
|---|---|---|
| WSAA (Axis 1.4) | SOAP 1.1 | `Content-Type: text/xml; charset=utf-8`, `SOAPAction: ""` (el WSDL declara `soapAction=""`; el ejemplo con curl usa `urn:LoginCms`) |
| WSFEv1 (ASMX) | SOAP 1.1 | `Content-Type: text/xml; charset=utf-8`, `SOAPAction: "http://ar.gov.afip.dif.FEV1/<Metodo>"`, que es **obligatorio y exacto** (vacío da 500) |
| Padrón (JAX-WS) | SOAP 1.1 | `Content-Type: text/xml; charset=utf-8`, `SOAPAction: ""` |

Parseo sin dependencias: Node no trae parser XML. Las respuestas son chicas y regulares; alcanza con un mini-parser propio de elementos + texto + entidades, que ignore namespaces y prefijos (`soap:`, `ns2:`) y trate las repeticiones como arrays (`AlicIva`, `Obs`, `Err`, `impuesto`, `actividad`). En el request, **escapar** `& < > " '` en todo texto libre (p. ej. `Tributo.Desc`).

### 6.3 ¿ARCA bloquea IPs de fuera de Argentina? [VERIFICADO]

No encontré reportes públicos de bloqueo geográfico de los web services. Lo medí:

- **Globalping** (probes reales en la nube, 08/10/2026, GET `?wsdl`), todos con **HTTP 200**:

| Probe | wsaa prod | wsaahomo | servicios1 (WSFE prod) | wswhomo | aws A5 | aws A13 |
|---|---|---|---|---|---|---|
| **AWS us-east-1, Ashburn VA, AS14618** (= Vercel iad1) | 200 (834 ms) | 200 | 200 (1,0 s) | 200 (2,1 s) | 200 | 200 |
| AWS us-east-2 (Columbus) | 200 | — | — | — | — | — |
| AWS us-west-2 (Boardman) | — | 200 | 200 | 200 | 200 | 200 |
| Oracle Ashburn / Verizon Virginia | 200 / 200 | — | — | — | — | — |

  Mediciones (API `https://api.globalping.io/v1/measurements/<id>`): `24SIXMj4A2VSJjIJN00021HCV` (wsaa), `273DQKw2DHiKLbmjd00021HCW` (servicios1), `2XJVmkVXL4kXqUhcY00021HCW` (wsaahomo), `2DiMdiHst9Cf4H7BD00021HCW` (wswhomo), `2Yo6bti6vcQrUMALh00021HCW` (A5), `25NigzKKUCZq04u2M00021HCW` (A13). El cliente de Globalping acepta DH de 1024, por eso a servicios1 le negoció DHE.
- **check-host.net**: nodos de Los Ángeles, Dallas, Atlanta, Nueva York, São Paulo y Frankfurt → 200 en wsaa, A5, wswhomo y wsaahomo. Contra servicios1 dio **«dh key too small»** desde *todos* los países: es el problema de TLS, no geografía. El TCP a `servicios1:443` conecta desde todos lados. Reportes: [wsaa](https://check-host.net/check-report/4f9ce0b7ke83), [A5](https://check-host.net/check-report/4f9ce0cckaa3), [servicios1](https://check-host.net/check-report/4f9ce0f8k912), [wswhomo](https://check-host.net/check-report/4f9ce121kab0), [wsaahomo](https://check-host.net/check-report/4f9ce12eke8e), [tcp servicios1](https://check-host.net/check-report/4f9ce14ak34f). Los nodos de Miami y Vancouver fallaron también contra google.com ([control](https://check-host.net/check-report/4f9d94fbk830)), así que se descartan.
- **Límite**: probé GET de WSDL y POST sin credenciales válidas (desde Argentina). El POST autenticado desde AWS queda **A CONFIRMAR** en el primer smoke desde Vercel; no hay motivo técnico para que difiera. No hay límites de tasa documentados para WSFEv1 ni Padrón: **A CONFIRMAR**.
- ARCA registra la IP de origen: el manual A13 pide en las consultas de soporte «fecha y hora en la que se realiza el llamado e IP desde la que se envió».
- **Mitigaciones si algún día bloquean**:
  1. Dejar el transporte detrás de una interfaz (`ArcaTransport`) para poder cambiarlo sin tocar la lógica.
  2. Plan B: un relay HTTPS mínimo y autenticado (mTLS o HMAC) en un VPS con IP argentina, que solo reenvíe a `*.afip.gov.ar`.
  3. Las IPs estáticas de Vercel no resuelven un bloqueo geográfico, porque siguen en EE.UU.
  4. Mientras tanto, timeouts de 20–30 s por llamada, sin reintentos ciegos de `FECAESolicitar` (§4.11) y keep-alive.

### 6.4 Otros detalles operativos

- **Hora argentina** para `CbteFch` y para los «días» del bar (§4.8).
- **Secretos**: la clave privada y el certificado, cifrados en la base (pgcrypto y una clave en env, igual que `META_TOKEN_KEY`). **Nunca loguear** el TRA firmado, la clave, el token ni el sign; las CUIT de clientes, redactadas.
- **Separar ambientes**: homologación usa el certificado WSASS (persona física, representando a la SAS) y los hosts `*homo`; producción usa el certificado de la SAS y un PtoVta RECE propio.
- **Punto de venta**: crear uno nuevo de tipo Web Services (RECE) en «Administración de puntos de venta y domicilios», **exclusivo de la plataforma** y distinto del de Thinkeon, para no pisar numeración (10005/10016). La etiqueta exacta del sistema en ese ABM es A CONFIRMAR con capturas. En homologación no hace falta crear PtoVta (A CONFIRMAR; se usa cualquier número).
- **Canales de soporte de ARCA**: `sri@arca.gob.ar` (producción), `wsfev1@arca.gov.ar` (funcional de homologación), `webservices-desa@arca.gob.ar` (LoginCms y certificados), `facturaelectronica@arca.gov.ar` (normativa) (manual v4.7, «Canales de Atención»; manual A13 §2.1).

---

## 7. Checklist de implementación (sin dependencias nuevas)

1. `lib/arca/der.ts`: encoder y lector DER (§2.3.1).
2. `lib/arca/csr.ts`: par RSA 2048 y CSR PKCS#10 (§3.2). Guardar la clave PKCS#8 cifrada.
3. `lib/arca/cms.ts`: TRA y firma CMS SHA-256 (§2.3.1).
4. `lib/arca/transport.ts`: `node:https` con agent solo ECDHE, keep-alive y timeout; SOAP 1.1 con el SOAPAction de cada servicio (§6.1–6.2).
5. `lib/arca/xml.ts`: mini-parser y escape (§6.2).
6. `lib/arca/wsaa.ts`: `getTicket(tenant, env, service)` con caché en la base, lock, margen de 10 min y política de errores (§2.5–2.7).
7. `lib/arca/wsfe.ts`: `dummy`, `ultimoAutorizado`, `solicitarCAE` (con lock por PtoVta+tipo y reconciliación vía `FECompConsultar`), `ptosVenta`, `condicionesIvaReceptor` (§4).
8. `lib/arca/padron.ts`: `getPersona_v2` y mapeo a `CondicionIVAReceptorId` (§5).
9. `lib/arca/importes.ts`: cálculo neto/IVA por alícuota desde centavos con half-even, y formateo (§4.8). **Tests unitarios obligatorios** (CLAUDE.md §10).
10. PDF y representación: leyendas de Ley 27.743 y 27.618, y QR (§4.7 y §4.12).
11. Tests: firmar con un certificado autofirmado y verificar la estructura (como hice con OpenSSL); fixtures XML de las respuestas reales de §2.4, §4.2 y §5.2.

---

## 8. Evidencia propia (08/10/2026)

Entorno: macOS, Node v25.2.1, OpenSSL 3.6.2, salida a internet por Córdoba (Telecom AR, AS7303). Scripts en `scratchpad/research/` (`probe*.mjs`, `checkhost.sh`, `gp.mjs`) y `scratchpad/research/ref/`.

- CSR generado en Node: `openssl req -verify` → OK.
- CMS generado en Node: `openssl cms -verify -noverify` → «CMS Verification successful», contenido idéntico al TRA.
- WSAA homologación con ese CMS (certificado autofirmado) → fault `ns1:cms.cert.untrusted`; con base64 basura → `ns1:cms.bad.base64`.
- FEDummy en homologación y producción → OK; FEDummy por SOAP 1.2 → OK; `FECompUltimoAutorizado` con token basura → `Err 600`; SOAPAction vacío → HTTP 500; sin SOAPAction → 200.
- Padrón: A5 `dummy` de producción → OK; `getPersona_v2` con token basura → Fault «Token malformado».
- TLS: tabla de §6.1. DNS de los dominios «arca»: tabla de §1.2. Geografía: §6.3.

---

## 9. A CONFIRMAR (lista consolidada)

1. Texto oficial de ARCA que fija el **01/12/2026** como fecha de rechazo sin `CondicionIVAReceptorId`, y si existe un manual **v4.8**.
2. Si el WSAA acepta CMS **sin** atributos firmados. No hace falta: se usan siempre.
3. Formato exacto de `loginCmsReturn` (entidades vs CDATA). Soportar ambos.
4. Formato del `.crt` de producción (PEM o DER). Soportar ambos.
5. Nombres exactos actuales de los servicios en «Administrador de Relaciones» y del sistema RECE en el ABM de puntos de venta, para capturas del instructivo.
6. Si `coe.alreadyAuthenticated` es por DN o por certificado, y el lapso real en producción (el manual dice 2 min y «puede cambiar»).
7. POST autenticado desde AWS us-east-1: confirmar en el primer smoke desde Vercel. Límites de tasa de WSFEv1 y Padrón.
8. Monto de RG 4444 que valida el WS para la Factura B anónima (normativa: $10.000.000, RG 5700/2025).
9. Concepto (1 vs 3) y alícuotas para la actividad del bar; «Otros Impuestos Nacionales Indirectos» de HUB; leyendas provinciales de Córdoba. Todo con la contadora.
10. Clase A habilitada para la SAS nueva: «A» común, «A con leyenda “Operación sujeta a retención”» (51–53) o «A con CBU informada». Soportar 1/2/3 y 51/52/53 por configuración.
11. Mapeo de monotributo social y trabajador promovido (13/16) desde `getPersona_v2`, y cuándo usar 7 (No Categorizado).
12. Modelo de certificados: por tenant (situación 1) o delegación al proveedor (situación 2).
13. Monto mínimo vigente de FCE MiPyME (validación 10192) para eventos corporativos.
14. QR: base `www.arca.gob.ar/fe/qr/` o `www.afip.gob.ar/fe/qr/`, y si se omiten `tipoDocRec`/`nroDocRec` con `DocTipo` 99.

---

## 10. Fuentes

**Oficiales (ARCA y normativa)**
- Especificación Técnica WSAA 1.2.2: https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf
- WSAA Manual del Desarrollador (Publicación 20.2.19): https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf
- Página WSAA: https://www.afip.gob.ar/ws/documentacion/wsaa.asp
- Arquitectura general: https://www.afip.gob.ar/ws/documentacion/arquitectura-general.asp
- Certificado de producción: https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf
- Asociar certificado a WSN: https://www.afip.gob.ar/ws/WSAA/wsaa_asociar_certificado_a_wsn_produccion.pdf
- Delegación de Webservices (Administrador de Relaciones): https://www.afip.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf
- WSASS, generar CSR: https://www.afip.gob.ar/ws/WSASS/html/generarcsr.html
- WSASS, crear certificado: https://www.afip.gob.ar/ws/WSASS/html/crearcertificado.html
- Manual WSASS: https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf
- Cómo adherirse a WSASS: https://www.afip.gob.ar/ws/WSASS/WSASS_como_adherirse.pdf
- Cadenas de certificación: https://www.afip.gob.ar/ws/documentacion/certificados.asp
- Manual WSFEv1 (v4.7, revisión 01/09/2026): https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf
- Índice de manuales FE: https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp
- WSDL WSFEv1 homologación: https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL
- Catálogo de WS (padrones): https://www.afip.gob.ar/ws/documentacion/catalogo.asp
- Manual Constancia de Inscripción v4.1: https://www.afip.gob.ar/ws/WSCI/manual_ws_sr_ws_constancia_inscripcion.pdf
- Manual Padrón A13 v1.4: https://www.afip.gob.ar/ws/ws-padron-a13/manual-ws-sr-padron-a13-v1.4.pdf
- Especificación del QR: https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
- RG 5614/2024 (Transparencia Fiscal): https://www.argentina.gob.ar/normativa/nacional/norma-407183/texto

**Secundarias**
- @arcasdk/core, auth y firma: https://github.com/ralcorta/arcasdk/blob/main/packages/core/src/infrastructure/repositories/auth/auth.repository.ts · https://github.com/ralcorta/arcasdk/blob/main/packages/core/src/infrastructure/utils/crypt-data.ts · https://github.com/ralcorta/arcasdk/blob/main/packages/core/src/infrastructure/utils/datetime-ref.ts
- arcasdk issues: DH en producción https://github.com/ralcorta/arcasdk/issues/112 · https://github.com/ralcorta/arcasdk/issues/104 · leyendas del PDF https://github.com/ralcorta/arcasdk/issues/224
- FAQ afipts (errores): https://www.afipts.com/faq/errors.html
- pyafipws padrón: https://github.com/PyAr/pyafipws/blob/main/ws_sr_padron.py · issue DH https://github.com/reingart/pyafipws/issues/94 · reutilización del TA https://groups.google.com/g/pyafipws/c/faq4C4nWmSM
- django-afip, fixtures de tablas ARCA: https://github.com/WhyNotHugo/django-afip/tree/main/django_afip/fixtures
- odoo-argentina, issue DH: https://github.com/ctmil/odoo-argentina/issues/59
- Afip SDK, error 10242 y fechas RG 5616: https://afipsdk.com/blog/factura-electronica-solucion-a-error-10242/
- signature.ar, v4.7: https://www.signature.ar/novedades/actualizaci%C3%B3n-arca:-lanzamiento-del-wsfev1-v4.7-y-obligatoriedad-del-iva-receptor
- SIAP: https://siap.blogdelcontador.com.ar/novedades/arca-rechazara-facturas-sin-condicion-iva-receptor-diciembre-2026/
- iProfesional, 01/12/2026: https://www.iprofesional.com/impuestos/464104-nuevo-requisito-arca-puede-trabar-emision-facturas
- La Gaceta: https://www.lagaceta.com.ar/nota/1154550/economia/vencimiento-arca-para-facturas-electronicas-cual-fecha-limite-para-evitar-rechazos
- Gosocket, v4.8: https://gosocket.net/centro-de-recursos/argentina-arca-publica-la-v4-8-del-manual-del-desarrollador-wsfev1/
- tusfacturas changelog: https://developers.tusfacturas.app/changelog
- RG 5700, $10M: https://contadoresenred.com/facturacion-a-partir-de-que-monto-se-debe-identificar-al-consumidor-final-en-2026/ · https://www.iprofesional.com/impuestos/429313-arca-elevo-a-10-millones-el-monto-para-identificar-en-las-facturas-a-consumidores-finales
- Vigencia de certificados (2 años): https://bitingenieria.com.ar/afip-certificados-renovacion/ · https://soporte.fierro.com.ar/portal/es/kb/articles/renovar-certificado-factura-electronica
- Notas de OpenSSL 3.2 (SECLEVEL 2): https://openssl-library.org/news/openssl-3.2-notes
- Node.js v22.20.0 (OpenSSL 3.5.2): https://nodejs.org/en/blog/release/v22.20.0
- Mediciones: Globalping https://globalping.io · check-host https://check-host.net
