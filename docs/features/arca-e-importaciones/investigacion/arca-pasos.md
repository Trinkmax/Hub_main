# Topic B — ARCA paso a paso para una SAS responsable inscripta (insumo del instructivo visual)

> **Estado al 08/10/2026.** Investigación para HUB! Coffee & Bar SAS (Córdoba, responsable inscripta en IVA), que va a
> facturar por web services (WSFEv1) desde la plataforma y bajar comprobantes recibidos de «Mis Comprobantes».
> Convenciones:
> - Todo dato no obvio lleva su link. Códigos de fuente: **[O*]** = oficial ARCA / Boletín Oficial; **[S*]** = secundaria
>   confiable (Afip SDK, guías de software de facturación). Lista completa al final (§13).
> - **«A CONFIRMAR»** = no lo pude verificar en una fuente confiable o pudo haber cambiado. No inventé nombres de botones:
>   donde no hay captura o manual, lo marco.
> - Los nombres entre «comillas» son los **textos exactos que se ven en pantalla** según capturas/manuales de 2024–2026.
> - Las pantallas viejas de ARCA siguen con estética AFIP (tablas celestes, botones azules en MAYÚSCULAS); el portal y
>   «Mis Comprobantes» tienen diseño nuevo. Lo aclaro en cada pantalla para que el diseñador pueda dibujar los mockups.

---

## 0. Mapa del recorrido (una pantalla)

| # | Paso | Quién lo hace | Servicio de ARCA | Tiempo aprox. | Lo que se lleva a la plataforma |
|---|---|---|---|---|---|
| 0 | Chequeo previo (clave nivel 3, DFE, IVA, actividad, local) | Administrador de Relaciones de la SAS | Constancia de CUIT · Sistema Registral · Domicilio Fiscal Electrónico | 10 min | — (si algo falla, se arregla antes) |
| 1 | Entrar y **actuar en representación de la SAS** | Admin | Administrador de Relaciones de Clave Fiscal | 2 min | — |
| 2 | Crear el **punto de venta de web services** | Admin (o alguien con el servicio delegado) | Administración de Puntos de Venta y Domicilios | 5 min (+ propagación) | **Número de punto de venta** |
| 3 | *(Sólo si van a emitir Factura A)* Habilitación clase A (F. 856) | Admin + socios | Regímenes de Facturación y Registración (REAR/RECE/RFI) | 15 min – algunos días | Tipo de «A» autorizado |
| 4 | Pruebas en **homologación** | **Desarrollador** con su CUIT personal | WSASS - Autogestión Certificados Homologación | 15 min | Certificado de prueba (no sirve para producción) |
| 5 | Habilitar «Administración de Certificados Digitales» **para la SAS** | Admin | Administrador de Relaciones | 3 min | — |
| 6 | Crear el **certificado** (alias) subiendo el CSR que genera la plataforma | Admin | Administración de Certificados Digitales | 3 min | **Archivo .crt**, **alias**, **fecha de vencimiento** |
| 7 | Autorizar ese certificado («computador fiscal») a **Facturación Electrónica** y **Consulta de constancia de inscripción** | Admin | Administrador de Relaciones | 5 min | Constancia **F. 3283/E** |
| 8 | Probar conexión desde la plataforma | Plataforma | — | 1 min | «Conectado» + punto de venta visible |
| 9 | Habilitar **Mis Comprobantes** y bajar recibidos | Admin o contadora | Administrador de Relaciones + Mis Comprobantes | 5 min por mes | ZIP/CSV o Excel de recibidos |

Resumen oficial de ARCA de lo que hay que hacer para consumir el WS de factura electrónica (PDF del 30/09/2026):
certificado de homologación por WSASS; en producción generar certificado, asociarlo al WSN y, si corresponde, delegarlo;
pedir el alta de un punto de venta; «No es necesario gestionar un certificado digital por cada WSN»; «El servicio
correspondiente al WSN wsfev1 es WSFE»; los alcanzados por el régimen general (ex RG 3749) **no** deben empadronarse
([O5](https://www.afip.gob.ar/fe/documentos/AccionesarealizarparaconsumirunWebservicedeFacturaElectr.pdf)).

---

## 1. Glosario en criollo (para el instructivo)

| Término de ARCA | Qué es, en una línea |
|---|---|
| **Clave fiscal** | Usuario y contraseña de ARCA de una **persona** (no de la SAS). Tiene niveles 2, 3 y 4. |
| **Administrador de Relaciones** | La persona que maneja la clave fiscal «en nombre de» la SAS y reparte permisos. Para personas jurídicas es el representante legal designado ([O14](https://www.afip.gob.ar/clavefiscal/ayuda/personas-juridicas.asp), [O21](https://www.argentina.gob.ar/servicio/designar-administrador-de-relaciones-o-apoderado-ante-arca)). |
| **Servicio** | Cada «app» de ARCA (p. ej. «Mis Comprobantes»). Hay que **habilitarlo** para la SAS antes de usarlo. |
| **Relación** / **Nueva Relación** | El permiso que dice «tal persona o computadora puede usar tal servicio en nombre de la SAS». Genera la constancia **F. 3283/E** ([O3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)). |
| **Punto de venta (PdV)** | Número de 1 a 99998 que aparece en cada factura (00010-00000001). Cada PdV está atado a **un** sistema de emisión ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf), error 11000). |
| **Web service (WS)** | La «puerta» por donde la plataforma le habla a ARCA sin que nadie entre al portal. El de facturas es **WSFE** (wsfev1). |
| **CSR** | Archivo de pedido de certificado (texto que empieza con `-----BEGIN CERTIFICATE REQUEST-----`). Lo genera la plataforma ([O8 generarcsr](https://www.arca.gob.ar/ws/WSASS/html/generarcsr.html)). |
| **Certificado (.crt)** | Lo que devuelve ARCA a cambio del CSR (empieza con `-----BEGIN CERTIFICATE-----`). Dura **2 años** ([S4](https://afipsdk.com/blog/solucion-a-error-cert-expired/)). |
| **Alias** / **Computador Fiscal** | El nombre que le ponés al certificado en ARCA. ARCA llama «Computador Fiscal» a ese certificado cuando lo autorizás ([O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf), [S6](https://afipsdk.com/blog/como-obtener-certificado-para-web-services-arca/)). |
| **Homologación / Producción** | Ambiente de pruebas (facturas sin validez) / ambiente real. Tienen certificados distintos y no se mezclan ([S5](https://afipsdk.com/blog/solucion-a-certificado-no-emitido-por-ac-de-confianza/)). |
| **DFE** | Domicilio Fiscal Electrónico: la «casilla de mail oficial» de ARCA. Obligatorio ([O15](https://www.arca.gob.ar/DomicilioFiscalElectronico/servicio-clave-fiscal/default.asp)). |

---

## 2. Prerrequisitos

### 2.1 Quién hace todo esto (SAS)

- Las personas jurídicas **no tienen clave fiscal propia**: operan con la clave fiscal de su representante legal, que actúa
  como **Administrador de Relaciones** ([O14](https://www.afip.gob.ar/clavefiscal/ayuda/personas-juridicas.asp);
  definición en [O21](https://www.argentina.gob.ar/servicio/designar-administrador-de-relaciones-o-apoderado-ante-arca)).
- En el alta digital de CUIT de una persona jurídica (servicio «Inscripción y Modificación de Personas Jurídicas» →
  «Alta nueva persona jurídica») el sistema pide el dato **«Administrador de Relaciones»** y, en el mismo trámite,
  **constituye el Domicilio Fiscal Electrónico** de la sociedad (RG 5803/2025, art. 10, vigente desde 02/03/2026)
  ([O18](https://consejosalta.org.ar/wp-content/uploads/ARCA-5803.pdf)). Es decir: **la persona que figuró como
  Administrador de Relaciones cuando se sacó el CUIT de la SAS es la que tiene que hacer esta guía** (o delegar).
- **Cómo saber si sos vos:** entrás con tu CUIT personal → «Administrador de Relaciones» → si aparece la pantalla
  «Autoridad de Aplicación» con un desplegable donde está la SAS, sos administrador de esa SAS
  ([O3, p. 6](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf): «un desplegable conteniendo todas las personas
  para las que esta persona es Administrador de Relaciones»). Si no aparece la SAS → no sos el administrador (inferencia;
  A CONFIRMAR con un caso real).
- **Si hay que cambiar o asignar el administrador:** por web, con «Inscripción y Modificación de Personas Jurídicas»
  ([O18, art. 17](https://consejosalta.org.ar/wp-content/uploads/ARCA-5803.pdf)), o vía «Presentaciones digitales» →
  «Vinculación de clave fiscal para personas jurídicas» con documentación certificada
  ([O14](https://www.afip.gob.ar/clavefiscal/ayuda/personas-juridicas.asp)). Ojo: «El cese del mandato del
  Administrador de Relaciones de una persona jurídica, implicará la baja automática de los servicios habilitados» (las
  subdelegaciones siguen hasta que el nuevo administrador las revoque) ([S18](https://tristanyasociados.com/2025/05/subadministrador-de-relaciones/))
  → si cambia el administrador, hay que re-verificar las relaciones de §7.
- **Representación plural** (varios administradores en el estatuto): hay que designar a uno ([O14](https://www.afip.gob.ar/clavefiscal/ayuda/personas-juridicas.asp)).

### 2.2 Clave fiscal **nivel 3** (y datos biométricos) de la persona que opera

- Los servicios que vamos a usar piden nivel 3: «Administración de Certificados Digitales (Nivel de seguridad mínimo
  requerido 3)» ([O1, p. 3](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)), «Facturación
  Electrónica (Nivel de seguridad mínimo requerido 3)» ([O3, p. 7](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)),
  y «Administración de Puntos de Venta y Domicilios» exige «Clave Fiscal con Nivel de Seguridad 3 como mínimo»
  ([O17, RG 5824/2026](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto)).
- **Cómo subir a nivel 3 sin ir a ARCA:** app móvil de ARCA (Android/iOS), escaneo del DNI tarjeta + gestos de la cara →
  «obtendrás el nivel 3 de seguridad». Por **homebanking sólo se llega a nivel 2** (no alcanza). Presencial con turno
  también da nivel 3 ([O13](https://www.afip.gob.ar/clavefiscal/ayuda/obtener-clave-fiscal.asp)). La app se llama
  «ARCA Móvil» en la normativa ([O18](https://consejosalta.org.ar/wp-content/uploads/ARCA-5803.pdf)).
- **Datos biométricos:** «Todas las personas humanas con CUIT que operen con clave fiscal deberán tener registrados los
  datos biométricos», incluidos los representantes legales de personas jurídicas. Se hace desde la app, opción «Datos
  Biométricos»; si la clave se sacó/blanqueó desde la app no hay que aceptar nada más
  ([ARCA, ayuda datos biométricos](https://www.afip.gob.ar/clavefiscal/ayuda/datos-biometricos.asp)).
- Nivel 4 (app «Token») es opcional; no hace falta para nada de esta guía (ARCA lo describe como doble factor:
  [ayuda Token](https://www.afip.gob.ar/clavefiscal/ayuda/token.asp)).
- Mensaje exacto si el nivel no alcanza: A CONFIRMAR (terceros citan «mayor nivel de seguridad»).

### 2.3 Domicilio Fiscal Electrónico (DFE): obligatorio **y la factura lo controla**

- «Todos los ciudadanos y responsables deben constituir el Domicilio Fiscal Electrónico»; se constituye en el servicio
  «Domicilio Fiscal Electrónico» cargando **un e-mail y un celular**; es **delegable** (se puede autorizar a otra persona,
  p. ej. la contadora, a leer las notificaciones) ([O15](https://www.arca.gob.ar/DomicilioFiscalElectronico/servicio-clave-fiscal/default.asp); RG 4280 [O22](https://www.argentina.gob.ar/normativa/nacional/norma-312678/texto)).
- Para la SAS ya debería estar constituido desde el alta del CUIT ([O18, art. 10](https://consejosalta.org.ar/wp-content/uploads/ARCA-5803.pdf)).
- **Por qué importa para la plataforma:** el WSFE rechaza con el error **10000** mensaje **«11 LA CUIT INFORMADA NO TIENE
  ACTIVO EL DOMICILIO FISCAL ELECTRONICO»** ([O11, validaciones de `<Auth>`](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)).
- Además, ARCA notifica por DFE el resultado de la evaluación de Factura A (§5) ([O16, arts. 24–25](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf)).
- **Pantalla:** en el portal, ícono «Domicilio Fiscal Electrónico» (con globito rojo y «Tenés notificaciones» cuando hay
  avisos) ([S1, captura feb-2025](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta)).
  Recorrido interno de la pantalla de alta del DFE: A CONFIRMAR (no conseguí capturas 2025–2026).

### 2.4 La SAS tiene que estar «en regla» para facturar (lo que valida el WSFE)

El WSFE valida el CUIT emisor antes de autorizar (error **10000**, mensajes posibles) ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)):

| Mensaje exacto (10000) | Qué revisar antes de empezar |
|---|---|
| «01 LA CUIT INFORMADA NO CORRESPONDE A UN RESPONSABLE INSCRIPTO EN EL IMPUESTO» | Alta en IVA hecha (se ve en la Constancia de CUIT). |
| «02 LA CUIT INFORMADA NO SE ENCUENTRA AUTORIZADA A EMITIR COMPROBANTES ELECTRONICOS ORIGINALES O EL PERIODO DE INICIO AUTORIZADO ES POSTERIOR AL DE LA GENERACION DE LA SOLICITUD» | Fechas de alta en IVA / inicio de actividad; no emitir con fecha anterior al alta. |
| «03 LA CUIT INFORMADA REGISTRA INCONVENIENTES CON EL DOMICILIO FISCAL» | Domicilio fiscal confirmado (Sistema Registral → Registro Único Tributario → Domicilios). |
| «04 LA CUIT INFORMADA NO SE ENCUENTRA AUTORIZADA A EMITIR COMPROBANTES CLASE "A" …» | Sólo para Factura A → hacer §5. |
| «05 EL CUIT INFORMADO COMO EMISOR NO SE ENCUENTRA REGISTRADO DE FORMA ACTIVA…» | CUIT activa (no «limitada»). Una CUIT recién dada puede quedar limitada si la dependencia detecta inconsistencias; se resuelve en «Sistema Registral» → «Clave Limitada» ([O18, art. 2](https://consejosalta.org.ar/wp-content/uploads/ARCA-5803.pdf)). |
| «06 DEBE POSEER AL MENOS UNA ACTIVAD ACTIVA.» | Actividad declarada (CLAE F. 883). Para un bar suele usarse **561014 «Servicios de expendio de bebidas en bares»** (A CONFIRMAR con la contadora cuál corresponde). |
| «11 LA CUIT INFORMADA NO TIENE ACTIVO EL DOMICILIO FISCAL ELECTRONICO» | §2.3. |

- **Chequeo rápido sin loguearse:** botón «Constancia de CUIT» en la portada de arca.gob.ar ([O1, p. 1](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)).
- **Local del bar declarado como domicilio:** el PdV necesita un domicilio «Locales y Establecimientos» (ver §4.4).
- **No hace falta «empadronarse» en factura electrónica**: como responsable inscripto ya está alcanzada por el régimen
  general ([O5](https://www.afip.gob.ar/fe/documentos/AccionesarealizarparaconsumirunWebservicedeFacturaElectr.pdf)).

### 2.5 Cómo la SAS le da acceso a otra persona (contadora, socio, desarrollador)

- **Servicio por servicio** (recomendado: cada uno sólo lo que necesita): Administrador de Relaciones → elegir la SAS →
  «Nueva Relación» → «BUSCAR» servicio → «BUSCAR» representante → CUIT de la persona → «CONFIRMAR» → «CONFIRMAR» → sale
  el F. 3283/E ([O1, pp. 2–4](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf);
  [S19](https://www.CSCGlobal.com/cscglobal/pdfs/AR_portal_instructions_Generate_a_New_Relationship_at_AFIP-NIC.ar-ENGLISH.pdf)).
  La persona autorizada necesita clave nivel 3 ([S19](https://www.CSCGlobal.com/cscglobal/pdfs/AR_portal_instructions_Generate_a_New_Relationship_at_AFIP-NIC.ar-ENGLISH.pdf)).
  Después tiene que **cerrar sesión y volver a entrar**; si no ve el servicio, lo acepta en «Aceptación de Designación»
  ([O1, p. 4](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)).
- **Todo junto:** designar un **«Subadministrador de Relaciones»** (Nueva Relación → ARCA → «Servicios Interactivos» →
  «Subadministrador de Relaciones» → CUIT); actúa «de manera simultánea e indistinta» con el administrador; la persona
  acepta en «Aceptación de Designación»; regulado por RG 5048/2021 ([S18](https://tristanyasociados.com/2025/05/subadministrador-de-relaciones/)).
  El documento oficial de delegación de WS también lo menciona como alternativa al administrador ([O3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).
- **Para que el desarrollador cree el certificado de la SAS** sin ser administrador: el administrador le delega
  «Administración de Certificados Digitales» (es el caso que usa el manual oficial: «El Administrador de Relaciones de la
  Empresa le ha delegado a JOSE PEREZ ROMERO el servicio…») ([O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf)).
  La autorización del WS (§7.3) la sigue haciendo el administrador o subadministrador.
- **Revocar** cuando alguien deja de trabajar con la SAS: «CONSULTAR» → lupa del representante → «Revocar» →
  «Confirmar» (sale F. 3283/E) ([O3, §3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).

### 2.6 Qué tener a mano antes de empezar

1. CUIT personal + clave fiscal nivel 3 del administrador (y celular a mano).
2. CUIT de la SAS (11 dígitos).
3. **Qué números de punto de venta usa hoy Thinkeon** (para no pisarlos; ver §4.2).
4. El **CSR** que descarga la plataforma (archivo `.csr`) y el **alias** que te muestra (ver §7.2).
5. Dirección exacta del local (por si hay que declararlo).

---

## 3. Pantallas que se repiten (portal + Administrador de Relaciones)

Formato de cada pantalla: **Estilo** (para el mockup) · **Qué vas a ver** · **Qué tocás** · **Qué copiás** · **Ojo**.

### P-01 · Portada de arca.gob.ar
- **Estilo:** sitio nuevo; banner grande con foto; recuadro a la derecha.
- **Qué vas a ver:** recuadro «Ingresar con Clave Fiscal» con botón celeste «Iniciar sesión», link «Recuperar Clave
  Fiscal» y dos botones con borde: «Comenzar inscripción» y «Constancia de CUIT»
  ([O1, p. 1](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf); [O3, p. 4](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).
- **Qué tocás:** «Iniciar sesión» (abre otra ventana).
- **Qué copiás:** nada. («Constancia de CUIT» sirve para el chequeo de §2.4.)

### P-02 · «Ingresar con Clave Fiscal» (dos pasos)
- **Estilo:** tarjeta gris clara centrada sobre fondo azul noche; candado; botón azul ancho.
- **Qué vas a ver:** «Ingresar con Clave Fiscal», campo «CUIT/CUIL», botón «Siguiente», «¿Olvidaste tu clave?», botón con
  borde «Obtené tu Clave Fiscal», «¿Qué es la Clave Fiscal?», «Ayuda». En el segundo paso: campo de clave y botón
  «INGRESAR» ([O1, p. 1](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf); [S14, captura jun-2025](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip)).
- **Qué tocás:** tu **CUIT personal** (sin guiones) → «Siguiente» → tu clave → «INGRESAR».
- **Ojo:** nunca el CUIT de la SAS (no tiene clave). El manual oficial pide el CUIT «sin guiones ni separadores»
  ([O3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).

### P-03 · Portal con tus servicios («Mis Servicios»)
- **Estilo:** cabecera blanca con logo «ARCA | AGENCIA DE RECAUDACIÓN Y CONTROL ADUANERO» y, a la derecha, tu nombre +
  CUIT + avatar; franja azul marino con íconos circulares blancos; buscador grande.
- **Qué vas a ver:** íconos (varían por usuario) como «Estado de cuenta», «Registro Único Tributario», «Presentaciones
  Digitales», «Administrador de relaciones», «Domicilio Fiscal Electrónico» (con globito rojo y «Tenés notificaciones»);
  en otras cuentas aparece «Solicitud de Cuit». Buscador «¿Qué necesitás? | Buscá trámites y servicios»; debajo
  «Servicios | Más utilizados» con 4 tarjetas y «Ver todos». Al tipear, aparece una tarjeta negra/blanca con el nombre del
  servicio y su descripción (p. ej. «Administración de puntos de venta y domicilios»)
  ([S1, capturas feb-2025](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta);
  [S14, jun-2025](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip);
  [O7, jul-2025](https://www.arca.gob.ar/ws/WSASS/WSASS_como_adherirse.pdf)).
- **Qué tocás:** el buscador o el ícono «Administrador de relaciones». El manual oficial también indica «Ver todos» para
  encontrar un servicio ([O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf)).

### P-04 · Administrador de Relaciones → «Autoridad de Aplicación» (elegir a quién representás)
- **Estilo:** pantalla vieja: barra lateral negra con «ARCA», botones «>>> ACCESO CON CLAVE FISCAL» (celeste) y
  «>>> TRÁMITES Y SERVICIOS» (borde amarillo), lista de categorías (Autónomos, Contribuyentes Régimen General,
  Empleadores…, recuadro naranja «Accesos más utilizados»). Centro: cajas celestes.
- **Qué vas a ver:** «Bienvenido Usuario NOMBRE [CUIT]» y la caja «Autoridad de Aplicación — Por favor seleccione el
  contribuyente para el que va a operar este servicio» con el desplegable «-- Seleccione --»
  ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/habilitar-administrador-de-certificados-de-produccion);
  [O3, p. 6](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).
- **Qué tocás:** elegí **la SAS** («HUB … SAS [30-…]»).
- **Ojo — error N.º 1:** «En caso de seleccionar a [la persona] en este desplegable, los servicios autorizados serán
  autorizados para operar en nombre de [la persona], y no en nombre de [la empresa]» ([O3, p. 6](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).

### P-05 · Menú del Administrador de Relaciones
- **Qué vas a ver:** cabecera con dos líneas: «Bienvenido Usuario NOMBRE [CUIT]» y **«Actuando en representación de
  HUB … SAS [CUIT]»** (ARCA lo señala: «La cabecera del sistema indica quien esta operando y en representacion de quien»)
  ([O3, p. 6](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)). Caja «Servicio Administrador de Relaciones» con
  texto y botones azules: **«ADHERIR SERVICIO»**, **«Nueva Relación»**, **«CONSULTAR»**; cuando representás a otra
  persona aparece un cuarto renglón «Ud. se encuentra representando a otra persona. Utilice el botón "Consultar" para
  controlar si tiene Autorizaciones pendientes de Aceptación…» con otro «CONSULTAR» ([O3, p. 6](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf);
  [O1, p. 2](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)).
- **Qué tocás:** **«Nueva Relación»** para todo lo de la SAS.
- **Ojo:** el texto en pantalla dice que «Adherir Servicio» «no es válido para habilitar un servicio en representación de
  otra persona» ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/habilitar-administrador-de-certificados-de-produccion)),
  aunque el documento técnico dice que sí sirve para incorporar un servicio para el representado ([O3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).
  Para no depender de esa ambigüedad, **el instructivo usa siempre «Nueva Relación»** (y para los web services es la única
  que deja elegir el computador fiscal).

### P-06 · «Incorporar nueva Relación»
- **Qué vas a ver:** tabla celeste: «Autorizante (Dador)» = **la SAS**; «Representado» = desplegable gris con la SAS;
  «Servicio» = «Presione Buscar para seleccionar el servicio» + botón **«BUSCAR»** ([O3, p. 7](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).
- **Qué tocás:** «BUSCAR» (fila Servicio).
- **Ojo:** si «Autorizante (Dador)» muestra tu nombre, volvé a P-04 y elegí la SAS.

### P-07 · «Selección de Servicio a Habilitar» (árbol de organismos)
- **Qué vas a ver:** columna de botones-logo de organismos (ANAC, ANSES, agencias provinciales…) y el de **ARCA**; debajo
  de ARCA, dos carpetas: **«Servicios Interactivos»** y **«WebServices»**. Cada servicio: ícono de engranaje + nombre en
  gris negrita + descripción ([O1, p. 3](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf);
  [O3, p. 7](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf); [O7](https://www.arca.gob.ar/ws/WSASS/WSASS_como_adherirse.pdf)).
- **Qué tocás:** ARCA → carpeta → servicio. Los que usa esta guía:

| Para qué | Carpeta | Nombre exacto | Descripción que se ve | Nivel mínimo |
|---|---|---|---|---|
| Crear certificados | Servicios Interactivos | «Administración de Certificados Digitales» | «Administre aquí sus Certificados Digitales para webservices» ([O1](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)) | 3 |
| Facturar desde la plataforma | **WebServices** | «Facturación Electrónica» | «Factura electrónica» ([S8](https://docs.afipsdk.com/siguientes-pasos/web-services/factura-electronica)); en capturas viejas «Facturacion Electronica» ([O3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)) | 3 |
| Autocompletar datos por CUIT (padrón) | **WebServices** | «Consulta de constancia de inscripción» | «Servicio de Consulta de la Constancia de Inscripción de Padrón» ([S9](https://docs.afipsdk.com/siguientes-pasos/web-services/padron-de-constancia-de-inscripcion)) | A CONFIRMAR |
| Pruebas (sólo con CUIT personal) | Servicios Interactivos | «WSASS - Autogestión Certificados Homologación» | «Autogestión de certificados para Servicios Web en los ambientes de homologación» ([O7](https://www.arca.gob.ar/ws/WSASS/WSASS_como_adherirse.pdf)) | 2 |
| Bajar recibidos | Servicios Interactivos | «Mis Comprobantes» | En el buscador del portal: «Consulta de Comprobantes Electrónicos Emitidos y Recibidos» ([S14](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip)); descripción dentro del árbol: A CONFIRMAR | A CONFIRMAR |
| Puntos de venta | Servicios Interactivos | «Administración de puntos de venta y domicilios» | «Administración de Puntos de Venta y Domicilios» ([S1](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta)) | 3 ([O17](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto)) |
| Factura A | Servicios Interactivos | «Regímenes de Facturación y Registración (REAR/RECE/RFI)» | A CONFIRMAR | A CONFIRMAR |
| Delegar todo | Servicios Interactivos | «Subadministrador de Relaciones» | A CONFIRMAR | — |

- **Ojo:** en WebServices **no** elegir «Factura Electrónica con Detalle - MTXCA» (está justo arriba en la lista,
  [O3, p. 7](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)); el WSMTXCA sólo se usa si ARCA te obliga
  ([S3](https://docs.afipsdk.com/recursos/preguntas-frecuentes)). Tampoco «Comprobantes en línea» ([S12](https://declar.ar/blog/vincular-cuenta-arca-facturacion-electronica/)).

### P-08a · «Selección del Representante a autorizar» — servicio interactivo (una persona)
- **Qué vas a ver:** «Esta generando una nueva autorizacion para el servicio <servicio> (Nivel de seguridad mínimo
  requerido 3). El servicio que seleccionó es un servicio interactivo. Para hacer efectiva la autorización deberá
  designar a una persona Física con Clave Fiscal habilitada.»; campo «CUIT/CUIL/CDI Usuario», casilla «El usuario es
  Externo (Podrá delegar este servicio)», botones «BUSCAR» y «CONFIRMAR» ([O1, p. 4](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)).
  Antes, en P-06, aparece la fila nueva «Representante — Presione Buscar para seleccionar el Representante» + «BUSCAR».
- **Qué tocás:** tu CUIT personal (o el de la persona a habilitar) → «BUSCAR» (aparece el nombre) → «CONFIRMAR». Dejá la
  casilla «Externo» sin tildar salvo que esa persona tenga que poder re-delegar.

### P-08b · «Selección del Representante a autorizar» — web service (el «Computador Fiscal»)
- **Qué vas a ver:** «Esta generando una nueva autorizacion para el servicio Facturación Electrónica (Nivel de seguridad
  mínimo requerido 3). El servicio que seleccionó es un WebService. Para hacer efectiva la autorización deberá determinar
  un Computador Fiscal habilitado y asociado a la persona que esta Ud. representando, o bien designar a otra persona que si
  tenga un Computador Fiscal.» + «La persona HUB … SAS [CUIT] lo ha autorizado para delegar este servicio en su nombre.»
  Fila **«Computador Fiscal»** con desplegable «— Seleccione —» (lista los alias de la SAS). Fila «CUIT/CUIL/CDI Usuario»
  con la leyenda «Puede delegar el WebService a un tercero que lo ejecute en su nombre. El tercero debera tener un
  Computador Fiscal habilitado.» + «BUSCAR». Botón «CONFIRMAR»
  ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/autorizar-web-service-de-produccion); [O3, pp. 8–9](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).
- **Qué tocás:** en «Computador Fiscal» elegí **el alias que creaste** → «CONFIRMAR». (Al elegir un computador, el campo de
  CUIT se desactiva: [O3, p. 9](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf).)
- **Ojo:** desplegable vacío = el certificado no se creó a nombre de la SAS (ver §8, fila «Computador Fiscal vacío»).

### P-09 · Revisión final y constancia **F. 3283/E**
- **Qué vas a ver:** vuelve «Incorporar nueva Relación» con «Servicio: Facturación Electrónica (Nivel de seguridad mínimo
  requerido 3)» y «Representante: Computador Fiscal identificado como <alias> relacionado con la persona <CUIT>» +
  «CONFIRMAR» ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/autorizar-web-service-de-produccion)).
  Al confirmar se muestra el **F. 3283/E**: «Rubro 1. AUTORIZANTE» (denominación y CUIT de la SAS), «Rubro 2. AUTORIZADO»
  (… «Tipo de Autorizacion: Facturacion Electronica»), «Rubro 3. AUTORIZACION» (texto legal)
  ([O3, p. 11](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf); «se visualizará en pantalla el formulario F3283/E,
  como constancia de alta de la nueva relación» [S19](https://www.CSCGlobal.com/cscglobal/pdfs/AR_portal_instructions_Generate_a_New_Relationship_at_AFIP-NIC.ar-ENGLISH.pdf)).
- **Qué tocás:** «CONFIRMAR». Guardá la constancia (imprimir → PDF).
- **Qué copiás:** opcional, subir el PDF del F. 3283/E a la plataforma como respaldo.

### P-10 · «Aceptación de Designación» (sólo si hace falta)
- **Cuándo:** si tras cerrar sesión y volver a entrar no ves el servicio ([O1, p. 4](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)),
  si te designaron subadministrador ([S18](https://tristanyasociados.com/2025/05/subadministrador-de-relaciones/)) o si te
  delegaron un WS ([S1 aceptar delegación](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/aceptar-delegacion-de-web-service)).
- **Qué vas a ver:** la tarjeta «Aceptación de Designación» en el portal (aparece entre los servicios frecuentes en
  [S1](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta)); adentro, la lista de
  autorizaciones a confirmar con botón «Aceptar». Dentro del Administrador de Relaciones existe la tabla «Mis Relaciones
  Pendientes» (Representado · Representante · Autorizante · Servicio · Delegable · Aceptada · Aceptar) ([O3, p. 11](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).
- **Qué tocás:** «Aceptar».

---

## 4. Punto de venta para web services

### 4.1 Qué sistema elegir y por qué no se reutiliza otro

- **Responsable inscripto → «RECE para aplicativo y web services»** (texto exacto del desplegable en la captura de
  [S1](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta); mismo criterio en
  [S10](https://facturante.ladesk.com/521097-C%C3%B3mo-crear-un-punto-de-venta-asociado-a-WebServices-en-ARCA?r=1),
  [S11](https://migestion.app/guias/como-crear-un-punto-de-venta-asociado-a-webservices-en-ARCA),
  [S13 Fudo, 13/07/2026](https://soporte.fu.do/es/articles/11731376-1-argentina-dar-de-alta-el-punto-de-venta-electronico)).
  - «Factura Electronica - Monotributo - Web Services» es para monotributo; «Facturación Electrónica - Exento en IVA -
    WebServices» para exentos ([S10](https://facturante.ladesk.com/521097-C%C3%B3mo-crear-un-punto-de-venta-asociado-a-WebServices-en-ARCA?r=1)).
  - Variantes del nombre que aparecen en guías de terceros («Factura Electrónica – Web Services», «Factura electrónica -
    RECE - Webservices») parecen aproximaciones; el instructivo debe mostrar la captura con **«RECE para aplicativo y web
    services»** y decir «elegí la que dice *RECE* y *web services*».
- **Por qué no sirve el PdV de «Comprobantes en línea», ni el del controlador fiscal, ni el que usa Thinkeon:**
  1. Cada PdV queda atado al sistema con el que se emite (RG 1415 art. 47 según RG 5824/2026: «Los puntos de venta … deberán
     estar vinculados al sistema de facturación mediante el cual se emiten») ([O17](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto)).
  2. El WSFE sólo acepta PdV de web services; si no, **11002 «El punto de venta no se encuentra habilitado a usar el presente
     WS»** ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf); [S2](https://docs.afipsdk.com/recursos/errores-frecuentes)).
     Los válidos son los que devuelve `FEParamGetPtosVenta` («puntos de venta asignados a Facturación Electrónica que
     soporten CAE y CAEA vía Web Services») ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)).
  3. El sistema de un PdV no se cambia: se crea uno nuevo; conviven ([S11](https://migestion.app/guias/como-crear-un-punto-de-venta-asociado-a-webservices-en-ARCA);
     [S12](https://declar.ar/blog/vincular-cuenta-arca-facturacion-electronica/)).
  4. La numeración es por PdV y tipo de comprobante: si dos sistemas usan el mismo PdV se pisan los números y el WSFE
     rechaza con **10016** («El número o fecha del comprobante no se corresponde con el próximo a autorizar»)
     ([S2](https://docs.afipsdk.com/recursos/errores-frecuentes)). Por eso la plataforma necesita **su propio PdV**, separado
     del de Thinkeon, aunque Thinkeon también use web services.

### 4.2 Qué número elegir

- Rango válido **1 a 99998** ([O11, error 11000](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)). El campo
  «Número» del alta trae precargado el siguiente libre ([S1, captura con «4»](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta)).
- **Un PdV dado de baja no se puede volver a usar** («Cuando se ingrese la baja de un punto de venta, el mismo no podrá
  volver a utilizarse», RG 5824/2026) ([O17](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto)).
- Recomendación para HUB: mirar el «Listado de Puntos de Venta» (PV-04), anotar los que usa Thinkeon y elegir uno libre
  fácil de reconocer en la factura (p. ej. el siguiente libre, o 10). Criterio final A CONFIRMAR con la contadora.
- Debe ser **único** entre los PdV de la SAS ([S10](https://facturante.ladesk.com/521097-C%C3%B3mo-crear-un-punto-de-venta-asociado-a-WebServices-en-ARCA?r=1)).

### 4.3 Pantallas

**PV-01 · Buscar el servicio**
- **Qué vas a ver:** en el buscador del portal escribís «puntos de venta» y aparece la tarjeta «Administración de puntos de
  venta y domicilios — Administración de Puntos de Venta y Domicilios» ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta)).
- **Qué tocás:** la tarjeta. Si no aparece: habilitarlo para la SAS con P-04 → P-09 (Servicios Interactivos)
  ([S27](https://yo-facturo.com/blog/como-dar-de-alta-un-punto-de-venta-en-arca/) indica habilitarlo desde el Administrador
  de Relaciones si falta).

**PV-02 · Elegir el contribuyente**
- **Qué vas a ver:** lista/desplegable de contribuyentes que representás ([S13](https://soporte.fu.do/es/articles/11731376-1-argentina-dar-de-alta-el-punto-de-venta-electronico);
  [S10](https://facturante.ladesk.com/521097-C%C3%B3mo-crear-un-punto-de-venta-asociado-a-WebServices-en-ARCA?r=1): «hacé clic en el nombre de tu empresa»).
- **Qué tocás:** la SAS. (Diseño exacto de esta pantalla: A CONFIRMAR.)

**PV-03 · Menú principal**
- **Qué vas a ver:** opción **«A/B/M de Puntos de Venta»** ([S1](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta);
  [S13](https://soporte.fu.do/es/articles/11731376-1-argentina-dar-de-alta-el-punto-de-venta-electronico)); una guía de
  ago-2026 la nombra «A/B/M de puntos de venta / emisión» y avisa que puede salir una notificación para «Cerrar»
  ([S12](https://declar.ar/blog/vincular-cuenta-arca-facturacion-electronica/)). Texto exacto vigente: A CONFIRMAR.
- **Qué tocás:** «A/B/M de Puntos de Venta».

**PV-04 · «Listado de Puntos de Venta / Emisión»**
- **Estilo:** grilla vieja (jQuery), barra azul-gris con el título.
- **Qué vas a ver:** botones «Filtro..» y «Orden..», «Página: 1 de 1», tabla con «Número» y demás columnas
  ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta)); botón **«Agregar»**
  ([S10](https://facturante.ladesk.com/521097-C%C3%B3mo-crear-un-punto-de-venta-asociado-a-WebServices-en-ARCA?r=1);
  [S13](https://soporte.fu.do/es/articles/11731376-1-argentina-dar-de-alta-el-punto-de-venta-electronico)).
- **Qué copiás:** **anotá los números que ya existen** (son los de Thinkeon / Comprobantes en línea / controlador).
- **Qué tocás:** «Agregar».

**PV-05 · Modal «Alta de Punto de Venta / Emisión»**
- **Estilo:** ventana modal gris con título en barra gris-azul, «?» rojo arriba a la derecha.
- **Qué vas a ver** ([S1, captura RI](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta)):
  - Aviso en rojo/negro: «ATENCION: EN CASO QUE NO SE VISUALICE EL DOMICILIO DEBERA CONCURRIR A LA DEPENDENCIA A
    REGULARIZAR LA SITUACION.» (hoy se puede declarar el local por web: §4.4).
  - «Número:» (precargado con el siguiente libre).
  - «Nombre Fantasía:» (sólo lo ve ARCA; poné algo como «Plataforma HUB») ([S10](https://facturante.ladesk.com/521097-C%C3%B3mo-crear-un-punto-de-venta-asociado-a-WebServices-en-ARCA?r=1)).
  - «Dominio Asociado:» (opcional: la web del local) ([S10](https://facturante.ladesk.com/521097-C%C3%B3mo-crear-un-punto-de-venta-asociado-a-WebServices-en-ARCA?r=1)).
  - **«Sistema:»** desplegable → **«RECE para aplicativo y web services»**.
  - «Nuevo domicilio:» desplegable «-- Seleccionar --» → el **local del bar**.
  - Desde el 01/07/2026 el servicio permite **vincular opcionalmente una actividad económica** al PdV
    ([O17](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto)). Si aparece un campo de
    actividad en el alta o hay que hacerlo después: A CONFIRMAR.
  - Botones «Aceptar» (ícono rojo de guardar) y «Cancelar» (cruz roja).
- **Qué tocás:** completar → «Aceptar» → confirmar con «Sí» ([S10](https://facturante.ladesk.com/521097-C%C3%B3mo-crear-un-punto-de-venta-asociado-a-WebServices-en-ARCA?r=1)).
- **Qué copiás:** **el número de PdV** → a la plataforma.

**PV-06 · Constancia**
- Una guía de jul-2026 indica descargar el comprobante del alta del nuevo PdV ([S13](https://soporte.fu.do/es/articles/11731376-1-argentina-dar-de-alta-el-punto-de-venta-electronico)).
  Nombre/forma exacta de esa constancia: A CONFIRMAR.

### 4.4 Si el local no aparece en «Nuevo domicilio»

- Los domicilios que se vinculan al punto de emisión deben estar declarados como **«Locales y Establecimientos»** en el
  «Sistema Registral», menú «Registro Tributario», opción «F 420/D - Declaración de domicilios» (texto de RG 1415 art. 47
  sustituido por RG 5824/2026) ([O17](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto)).
  La RG 5803/2025 ubica la modificación de «locales y/o establecimientos» en «Sistema Registral», menú «Inicio», opción
  **«Registro Único Tributario»** ([O18, art. 17](https://consejosalta.org.ar/wp-content/uploads/ARCA-5803.pdf)).
- Recorrido descripto por terceros (2026): «Sistema Registral» → «Registro Único Tributario» → tarjeta **«Domicilios»** →
  **«Modificar»** (F. 420/D, clave nivel 3+) → **«Agregar»** → «Tipo de domicilio»: **«LOCALES Y ESTABLECIMIENTOS»** →
  elegir el destino comercial → confirmar ([S26](https://www.tg-cq.com/post/arca-rg-5809-2026-domicilio-fiscal-cambios-y-domicilios-especiales);
  resumen de búsqueda sobre FAQ oficial). Los textos exactos de botones: A CONFIRMAR.
- Novedades de domicilios: informarlas dentro de los 10 días hábiles ([O18](https://consejosalta.org.ar/wp-content/uploads/ARCA-5803.pdf)).

### 4.5 Plazos del punto de venta

- Normativa: el punto de emisión se informa «con no menos de TRES (3) días hábiles de anticipación a la fecha de inicio de
  las operaciones en el nuevo lugar habilitado» (RG 1415 art. 47 b, texto RG 5824/2026) ([O17](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto)).
  Para el instructivo: «creá el punto de venta unos días antes de empezar a facturar desde la plataforma». Si aplica a un
  PdV nuevo en un local que ya opera: A CONFIRMAR con la contadora.
- Técnica: el alta es inmediata en el ABM, pero puede tardar en verse desde el WSFE («la creación puede tardar en impactar
  en todos los sistemas de AFIP», [S2](https://docs.afipsdk.com/recursos/errores-frecuentes); «ARCA procesa la información
  en las próximas horas», [S12](https://declar.ar/blog/vincular-cuenta-arca-facturacion-electronica/)). No hay plazo
  oficial: A CONFIRMAR (en la práctica, de minutos a algunas horas).

---

## 5. Factura A: habilitación previa (F. 856) — sólo si la van a necesitar

**Para el instructivo:** a consumidor final se hace **Factura B** y no necesita este paso. Si algún cliente empresa pide
**Factura A** (eventos corporativos, proveedores), **primero** hay que hacer esto; si no, el WSFE rechaza o, peor, autoriza
con observación y después hay que anular con nota de crédito.

- Desde el **01/12/2025 no existe más la Factura M**: la RG 5762/2025 la reemplazó por «A» con leyenda **«OPERACIÓN SUJETA
  A RETENCIÓN»** y agregó la «A» con leyenda **«PAGO EN CBU INFORMADA»** ([O16](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf)).
- **Dónde:** servicio **«Regímenes de Facturación y Registración (REAR/RECE/RFI)»** → opción **«Habilitación de
  Comprobantes»** → generar el **F. 856** (personas jurídicas; el F. 855 es para personas humanas). Hay que hacerlo **antes**
  de pedir autorización de emisión ([O16, art. 2](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf)).
- **Requisitos para entrar al servicio:** CUIT «con estado administrativo activo sin limitaciones» y «al menos una actividad
  declarada … en el "Sistema Registral"» ([O16, art. 2](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf)).
- **Solvencia (la clave para una SAS nueva):** la acredita el **33 % como mínimo de los componentes** (socios) con:
  DDJJ de Bienes Personales de los 2 últimos períodos presentadas en término, con bienes > mínimo no imponible y bienes en el
  país > 15 % del MNI; **o** inmuebles/automotores en el país > 6 % del MNI; **o** la propia SAS es titular de
  inmuebles/automotores ([O16, art. 4](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf)).
  Cada socio que aporta solvencia entra con **su** clave fiscal al mismo servicio → opción **«Solvencia como Componente de
  Empresa»** → acepta su nominación ([O16, art. 2](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf)).
- **Resultados posibles** ([O16, art. 5](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf)):
  - «A» común: si cumple todo.
  - «A» con «OPERACIÓN SUJETA A RETENCIÓN»: el cliente le retiene **100 % del IVA + 6 % de Ganancias** (art. 13) → malo para
    vender a empresas.
  - «A» con «PAGO EN CBU INFORMADA»: opción para quien cumple los incisos a) y c) aunque no acredite solvencia; **se elige al
    presentar el F. 856 informando la CBU y el banco** («No resultará válida la opción que se efectúe con posterioridad»);
    el cliente paga por transferencia a esa CBU, sin esas retenciones (arts. 20–22).
- **Si la solvencia no se valida sola:** suspender la solicitud y adjuntar documentación por «Presentaciones Digitales» →
  «Habilitación de comprobantes – Suspensión para acreditación ante dependencia»; 15 días corridos o se archiva
  ([O16, art. 4](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf)).
- **Evaluación periódica:** cada cuatrimestre (febrero, junio, octubre) con el Libro IVA Digital; simulación preventiva en
  los primeros 7 días del mes y notificación por DFE hasta el día 20; detalle en el mismo servicio → «Habilitación de
  Comprobantes» → «Resultado de la Evaluación Periódica de su Habilitación» ([O16, arts. 23–25](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf)).
  (Octubre 2026 es mes de evaluación.)
- **Pantallas (A CONFIRMAR si cambiaron con la RG 5762):** guía de sep-2025 (previa a la RG 5762): elegir la persona
  representada → «Habilitación de comprobantes – Solicitud Habilitación de comprobantes A – 855/856» → declarar bienes
  (opción «Informar inmuebles y automotores del país») → «Analizar bienes de solicitud» → resultado → «Descargar constancia»;
  después «Consultas» → «Resultado de la Evaluación Periódica» ([S20](https://www.estudiopiccinini.com.ar/impositivo/factura-clase-a-solicitud-inicial-de-comprobantes/)).
- **Lo que pasa si no se hace** ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)):
  - Rechazo 10000 «04 LA CUIT INFORMADA NO SE ENCUENTRA AUTORIZADA A EMITIR COMPROBANTES CLASE "A" O FACTURA DE CREDITO»
    o «09 … CLASE A CON LEYENDA 'OPERACIÓN SUJETA A RETENCIÓN'».
  - Observación **10234**: «se ha detectado que esta pendiente de presentación el formulario de habilitación de comprobantes
    o su fecha de presentación es anterior a la fecha de alta en IVA … se debe proceder a anular la operación … mediante una
    Nota de Crédito».

---

## 6. Homologación (pruebas) — lo hace el **desarrollador**, no los dueños

**Reglas oficiales que definen quién y cómo:**
- WSASS es para gestionar certificados **sólo del entorno de testing**; los certificados «no son de aplicación para el
  ambiente de producción» ([O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).
- **No es delegable:** hay que adherirse «CON SU CLAVE FISCAL DE PERSONA FISICA (no de persona jurídica o empresa)», nivel
  **2 o superior** ([O7](https://www.arca.gob.ar/ws/WSASS/WSASS_como_adherirse.pdf)).
- «Los certificados generados por WSASS siempre se emiten para la CUIT de una persona física. Para crear una autorización para
  una CUIT REPRESENTADA (por ejemplo, la de una empresa) hay que crear una autorización para el certificado, indicando como
  CUIT REPRESENTADA la de la empresa» ([O6, FAQ 12.3](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).
- Soporte de testing: soporte-ws-testing@arca.gob.ar ([O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).

**H-01 · Adherir WSASS** (pasos oficiales, [O7](https://www.arca.gob.ar/ws/WSASS/WSASS_como_adherirse.pdf))
1. P-01/P-02 con el **CUIT personal del desarrollador**.
2. P-03 → «Administrador de relaciones» (o el cuadro «Administrador de Relaciones de Clave Fiscal»).
3. P-05 → **«ADHERIR SERVICIO»** (acá sí, porque es para uno mismo).
4. P-07 → ARCA → «Servicios Interactivos» → **«WSASS - Autogestión Certificados Homologación»**.
5. Se ve «Incorporar nueva Relación» con «Servicio: WSASS - Autogestión Certificados Homologación (Nivel de seguridad
   mínimo requerido 2)» y «Representante: <NOMBRE> [Clave Fiscal Nivel 3]» → **«CONFIRMAR»**.
6. Cerrar sesión y volver a entrar: aparece la tarjeta «WSASS - Autogestión Certificados Homologación — Autogestión de
   certificados para Servicios Web en los ambientes de homologación».
- Error típico: «El servicio no es delegable» = intentaste con la empresa ([O6, FAQ 12.2](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).

**H-02 · Pantalla de WSASS (estructura para el mockup)**
- Cabecera con degradé azul, ícono de globo/engranaje y el título «WSASS Autoservicio de Acceso a WebServices
  (TESTING/HOMOLOGACIÓN)», logo viejo de AFIP, botón «Cerrar Sesión» y «USUARIO: <CUIT>». Menú izquierdo «Autogestion de
  servicios»: «Introducción», «Servicios», «Certificados», «Nuevo Certificado», «Crear autorización a servicio», «Eliminar
  autorización a servicio», «Autorizaciones», «Agregar certificado a alias», «Contáctenos»
  ([S1, capturas](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-testing); [O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).

**H-03 · «Nuevo Certificado» → «Crear DN y certificado»**
- **Qué vas a ver:** «Formulario para crear un DN y el certificado inicialmente asociado al mismo.» Campos:
  «1. Nombre simbólico del DN» (alias nuevo, no repetido), «2. CUIT del contribuyente» (fijo: el CUIT logueado),
  «3. Solicitud de certificado en formato PKCS#10» (caja grande; a la derecha la ayuda «El CSR debe contener en el
  SerialNumber el valor "CUIT nnnnn"… Recuerde que la clave privada… debe tener un mínimo de 2048 bits. Copiar y Pegar en
  este campo el contenido del CSR.»). Botón **«Crear DN y obtener certificado»**; debajo aparece el certificado
  (`-----BEGIN CERTIFICATE-----…`) ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-testing);
  [O8 crearcertificado](https://www.arca.gob.ar/ws/WSASS/html/crearcertificado.html); [O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).
- **Qué tocás:** alias (p. ej. `hubtest`) + pegar el CSR **cuyo serialNumber es el CUIT personal del desarrollador** →
  «Crear DN y obtener certificado».
- **Qué copiás:** el texto del certificado → guardarlo como `.crt`/`.pem` junto con la clave privada ([O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).
- **Ojo:** «Los certificados creados no pueden ser eliminados, ni aún después de su fecha de expiración»; el DN queda «por
  diseño» como `SERIALNUMBER=CUIT nnnnnnnnnnn, CN=<alias>`; «Error creando certificado» suele ser que no pegaste un CSR o
  repetiste el alias ([O6, nota y FAQ 12.4](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).

**H-04 · «Crear autorización a servicio» → «Crear autorización»** (una vez por servicio)
- **Qué vas a ver:** «Formulario para crear una autorización para que un DN pueda utilizar un servicio representando a un
  contribuyente.» Campos: «1. Nombre simbólico del DN a autorizar» (desplegable, se ve como `SERIALNUMBER=CUIT …, CN=…`),
  «2. CUIT del DN a autorizar» (fijo), **«3. CUIT representado»**, «4. CUIT de quien genera la autorizacion» (fijo),
  **«5. Servicio al que desea acceder»** (desplegable). Botón **«Crear autorización de acceso»**. Recuadro «Resultado» con
  «OK. Autorización fue creada (CUITCOMPUTADOR=…, ALIASCOMPUTADOR=…, CUITREPRESENTADO=…, SERVICIO=ws://wsfe,
  CUITAUTORIZANTE=…).» ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/autorizar-web-service-de-testing);
  [O8 crearautorizacion](https://www.arca.gob.ar/ws/WSASS/html/crearautorizacion.html)).
- **Qué tocás:** alias → «CUIT representado» = **CUIT de la SAS** (para que las pruebas imiten producción; Afip SDK
  recomienda el CUIT propio «para no crear confusión» — cualquiera de los dos sirve para probar; si homologación valida la
  condición de IVA del representado: A CONFIRMAR) → servicio:
  - **«wsfe - Facturacion Electronica»** ([S8](https://docs.afipsdk.com/siguientes-pasos/web-services/factura-electronica)).
  - Repetir para **«ws_sr_constancia_inscripcion - Web service de Consulta de la Constancia de Inscripción de Padrón»**
    ([S9](https://docs.afipsdk.com/siguientes-pasos/web-services/padron-de-constancia-de-inscripcion)).
- **Qué copiás:** nada (verificar el «OK»).

**H-05 · «Autorizaciones»**
- **Qué vas a ver:** «Actualmente hay N certificados para la CUIT …» y una tabla «Dador · Alias · Representado · Servicio»
  con link «Eliminar» por fila ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/autorizar-web-service-de-testing); [O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).
- **Qué tocás:** nada; verificar que estén las dos filas (wsfe y ws_sr_constancia_inscripcion).

**Notas de homologación**
- Vigencia del certificado de testing: 2 años (ejemplo del manual oficial decodificado: válido del 30/09/2016 al 30/09/2018,
  emisor «CN=Computadores, O=AFIP») ([O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)). Para renovar: «Agregar
  certificado a alias» (se ignora el DN del nuevo CSR) ([O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)).
- **Punto de venta en homologación:** según la comunidad, no hay que crearlo y se puede usar cualquier número
  ([S21](https://groups.google.com/g/pyafipws/c/PqKowNnwdkw)); en 2018 hubo un período en que sólo aceptaba los números
  activos en producción ([hilo pyafipws 2018](https://groups.google.com/g/pyafipws/c/oGQFQqDq8sI)). A CONFIRMAR al probar;
  si da 11002 en homologación, usar el mismo número del PdV de producción.
- El padrón de testing devuelve datos de prueba o `null`; los comprobantes de homologación no tienen validez
  ([S3](https://docs.afipsdk.com/recursos/preguntas-frecuentes)).
- Endpoints (para el desarrollador): WSAA `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` (prod
  `https://wsaa.afip.gov.ar/ws/services/LoginCms`) ([O10](https://www.afip.gob.ar/ws/documentacion/wsaa.asp)); WSFEv1
  `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` (prod `https://servicios1.afip.gov.ar/wsfev1/service.asmx`)
  ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)). Verifiqué por DNS el 08/10/2026 que los hosts
  `*.afip.gov.ar` resuelven y que `wsaa.arca.gov.ar`, `wswhomo.arca.gov.ar`, `aws.arca.gov.ar` **no** resuelven (el detalle
  técnico, TLS y padrón está en `arca-tecnico.md`).

---

## 7. Producción — certificado de la SAS y autorizaciones

### 7.1 Habilitar «Administración de Certificados Digitales» **para la SAS**

Pasos oficiales ([O1, pp. 2–4](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)), en la versión «SAS»:
1. P-03 → «Administrador de relaciones».
2. P-04 → elegir **la SAS**.
3. P-05 → «Nueva Relación».
4. P-06 → «BUSCAR».
5. P-07 → ARCA → «Servicios Interactivos» → **«Administración de Certificados Digitales»**.
6. Vuelve P-06 con «Servicio: Administración de Certificados Digitales (Nivel de seguridad mínimo requerido 3)» y la fila
   «Representante — Presione Buscar para seleccionar el Representante» → «BUSCAR».
7. P-08a → tu CUIT personal → «BUSCAR» → «CONFIRMAR».
8. P-09 → «CONFIRMAR» (constancia F. 3283/E).
9. **Cerrar sesión y volver a entrar** para ver el servicio; si no aparece, P-10 «Aceptación de Designación»
   ([O1, p. 4](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)).

### 7.2 Crear el certificado (alias) con el CSR que genera la plataforma

**Recomendación de diseño (no es requisito de ARCA):** que la plataforma genere la clave privada y el CSR y que la clave
**nunca** salga de la plataforma; el dueño sólo descarga el `.csr`, lo sube en ARCA y vuelve con el `.crt`. Así nadie usa
OpenSSL ni maneja la `.key` (Afip SDK advierte que la key «representa la "contraseña"» del certificado y que el CSR no es el
certificado: [S1](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-produccion)).

**Contenido del CSR (para el desarrollador):** RSA de **2048 bits**; subject
`/C=AR/O=<razón social>/CN=<alias>/serialNumber=CUIT <CUIT de la SAS sin guiones>` («CUIT», un espacio y los 11 dígitos)
([O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf); [O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf):
«subj_cuit por la CUIT sin guiones de la empresa o programador»). Usar **CN = alias** porque el DN que emite ARCA queda
`SERIALNUMBER=CUIT …, CN=<alias>` ([S1, captura del detalle](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-produccion));
si ARCA rechaza un CSR con CN o serialNumber distintos: A CONFIRMAR.

**Alias sugerido:** minúsculas y números, sin espacios ni tildes, p. ej. `hubplataforma`. El manual oficial usa un ejemplo con
guion («facturacion-1») ([O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf)); Afip SDK pide «solo letras y
números» para el nombre del certificado ([S1](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-produccion)).
El alias **no puede repetirse** ([S22](https://soporte.fierro.com.ar/portal/es/kb/articles/renovar-certificado-factura-electronica)).

**C-01 · Entrar al servicio**
- **Qué tocás:** buscador → «Administración de Certificados Digitales» (o «Ver todos») ([O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf)).

**C-02 · Elegir en nombre de quién**
- **Qué vas a ver:** «un desplegable conteniendo todas las personas que han autorizado al usuario para Administrar sus
  Certificados Digitales» ([O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf)); mismo estilo que P-04.
- **Qué tocás:** **la SAS**. (Si sólo te representás a vos, esta pantalla no aparece — y entonces vas a crear el
  certificado a tu nombre: volver a §7.1.)

**C-03 · Lista «Certificados»**
- **Estilo:** pantalla vieja; título «Administración de Certificados Digitales»; cabecera «Bienvenido Usuario … / Actuando
  en representación de …» (**verificá que diga la SAS**).
- **Qué vas a ver:** caja «Certificados» con tabla «Alias · Ver Detalle» (link «Ver» por fila; vacía la primera vez) y
  botones **«Agregar alias»** y «VOLVER» ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-produccion);
  [O1, p. 4](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)).
- **Qué tocás:** «Agregar alias».

**C-04 · «Usted está solicitando un certificado con las siguientes características»**
- **Qué vas a ver:** fila «CUIT» (debe ser el **de la SAS**), campo **«Alias»**, texto «Para obtener un nuevo certificado,
  debe subir un CSR (Certificate Signing Request) en formato PKCS#10.», botón de archivo («Examinar…» / «Seleccionar
  archivo», según navegador) con «No se seleccionó un archivo.», botones **«Agregar alias»** y «VOLVER»
  ([S1, captura](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-produccion);
  [O1, p. 5](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)).
- **Qué tocás:** escribí el **alias que te muestra la plataforma** → elegí el `.csr` descargado → «Agregar alias».
- **Ojo:** no subir el `.crt` ni la `.key`: es el `.csr` ([S1](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-produccion)).
  Mensaje de error si el archivo no es un CSR válido: A CONFIRMAR (terceros citan «El Request enviado es inválido»).

**C-05 · Vuelve la lista con el alias nuevo**
- **Qué tocás:** «Ver» a la derecha del alias ([O1, p. 5](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)).

**C-06 · Detalle del alias («Computador Fiscal») y descarga**
- **Qué vas a ver:** «CUIT», «Alias», «DN» (`SERIALNUMBER=CUIT 30…, CN=<alias>`); tabla «Nro Serie · Fecha Emision · Fecha
  Vencimiento · Estado · Descargar» con una fila «VALIDO» y un **ícono en «Descargar»**; botones **«Agregar certificado»** y
  «VOLVER» ([S1, captura: emisión 10/9/2024, vencimiento 10/9/2026](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-produccion)).
  ARCA explica que la primera sección son «los datos identificatorios del Computador Fiscal: CUIT, Alias, y DN» y que con el
  ícono «Descargar» se obtiene «el certificado digital emitido (Archivo CRT)» ([O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf)).
- **Qué tocás:** el ícono de «Descargar».
- **Qué copiás:** el **archivo `.crt`** → subirlo a la plataforma; anotar la **«Fecha Vencimiento»** (2 años) y verificar
  que el DN tenga el **CUIT de la SAS**.

### 7.3 Autorizar el certificado a «Facturación Electrónica»

Pasos oficiales ([O2](https://www.afip.gob.ar/ws/WSAA/wsaa_asociar_certificado_a_wsn_produccion.pdf); [O3 §2.2](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf);
[S1](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/autorizar-web-service-de-produccion)):
1. P-03 → «Administrador de relaciones» → P-04 **la SAS** → P-05 «Nueva Relación».
2. P-06 → «BUSCAR».
3. P-07 → ARCA → **«WebServices»** → **«Facturación Electrónica»**.
4. Vuelve P-06 con «Servicio: Facturación Electrónica (Nivel de seguridad mínimo requerido 3)» → «BUSCAR» de la fila
   «Representante».
5. P-08b → «Computador Fiscal» = **tu alias** → «CONFIRMAR».
6. P-09 → «CONFIRMAR» → F. 3283/E («Tipo de Autorizacion: Facturacion Electronica»).
- Efecto: queda disponible para usar ([O3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf): «el servicio SI se
  encuentra disponible para ser utilizado»). En el WSFE, el campo `Auth.Cuit` de cada pedido va a ser el CUIT de la SAS
  ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf): «Cuit contribuyente (representado o Emisora)»).

### 7.4 Repetir para el padrón: «Consulta de constancia de inscripción»

- Mismos pasos de §7.3 eligiendo en P-07 → «WebServices» → **«Consulta de constancia de inscripción — Servicio de Consulta de
  la Constancia de Inscripción de Padrón»** (identificador técnico `ws_sr_constancia_inscripcion`) ([S9](https://docs.afipsdk.com/siguientes-pasos/web-services/padron-de-constancia-de-inscripcion);
  catálogo oficial [O19](https://www.arca.gob.ar/ws/documentacion/catalogo.asp); el Alcance 5 quedó reemplazado por Constancia
  de Inscripción, manual [O20](https://www.afip.gob.ar/ws/WSCI/manual-ws-sr-ws-constancia-inscripcion.pdf)).
- Un mismo computador fiscal sirve para varios web services y no hace falta un certificado por servicio
  ([O3, FAQ](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf); [O5](https://www.afip.gob.ar/fe/documentos/AccionesarealizarparaconsumirunWebservicedeFacturaElectr.pdf)).

### 7.5 Verificar

- **En ARCA:** P-05 → «CONSULTAR» → lista «Representantes del Usuario» → lupa a la derecha del renglón → ver los servicios
  habilitados para esa relación ([O3 §3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).
- **En la plataforma (propuesta):** botón «Probar conexión» que pide el ticket al WSAA y llama a `FEParamGetPtosVenta`; muestra
  el PdV con `Nro`, `EmisionTipo` y `Bloqueado` («Indica si el punto de venta esta bloqueado. De darse esta situación se deberá
  ingresar al ABM de puntos de venta a regularizar la situación») ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)).

### 7.6 Renovar cada 2 años (sin rehacer la autorización)

- Certificados: vida de **2 años** ([S4](https://afipsdk.com/blog/solucion-a-error-cert-expired/); [S22](https://soporte.fierro.com.ar/portal/es/kb/articles/renovar-certificado-factura-electronica)).
- Procedimiento oficial: «Para continuar utilizándolo deberá solicitar un nuevo certificado asociado a ese computador fiscal.
  Para esto, deberá utilizar el botón "Agregar Certificado" … donde deberá consignar el mismo Alias y enviar un nuevo CSR …
  Se sugiere verificar la fecha de vigencia del certificado emitido para planificar su renovación con anticipación»
  ([O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf)). Con el mismo alias «no es necesario que vuelvas a
  autorizar los web services» ([S4](https://afipsdk.com/blog/solucion-a-error-cert-expired/)).
- Ojo: algunas guías crean un **alias nuevo** al renovar ([S22](https://soporte.fierro.com.ar/portal/es/kb/articles/renovar-certificado-factura-electronica));
  en ese caso **sí** hay que repetir §7.3 y §7.4. (La investigación técnica `arca-tecnico.md` cita Fierro con «alias nuevo»:
  el camino oficial es «Agregar certificado» sobre el mismo alias.)
- Pantalla: C-01 → C-02 → C-03 → «Ver» del alias → C-06 → **«Agregar certificado»** → subir el CSR nuevo → descargar el nuevo
  `.crt` (formulario exacto de «Agregar certificado»: A CONFIRMAR).

### 7.7 No reutilizar el certificado de Thinkeon (y cachear el ticket)

- FAQ oficial: «¿Puedo utilizar el mismo certificado digital asociado un Computador Fiscal en más de un equipo? No» — mientras
  el ticket está vigente, ese computador no puede pedir otro para el mismo web service ([O3, FAQ](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).
  El ticket (TA) dura **12 horas** y hay que reusarlo ([O9](https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf)).
- Conclusión para HUB: la plataforma usa **su propio alias**; y dentro de la plataforma (serverless) el TA se guarda y se
  comparte en un único lugar (detalle técnico en `arca-tecnico.md`).

### 7.8 Alternativa futura (varios bares): delegar el WS a la empresa de la plataforma

- En vez de que cada bar cree su certificado, el bar delega «Facturación Electrónica» a un CUIT de la empresa proveedora
  (P-08b, campo «CUIT/CUIL/CDI Usuario»); ARCA advierte «Delegación de Servicio: Ha seleccionado autorizar a una Persona
  Jurídica… deberá determinar que Computador Fiscal será el autorizado»; la proveedora acepta en «Mis Relaciones Pendientes»
  y asigna su computador ([O3 §2.3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf); [S6](https://afipsdk.com/blog/como-obtener-certificado-para-web-services-arca/)).
  No aplica hoy a HUB (no hay empresa proveedora con CUIT propio): se deja anotado.

---

## 8. Errores típicos (mensaje exacto → qué significa → cómo se arregla)

### 8.1 En el portal (los ve el dueño)

| Dónde | Lo que pasa / mensaje | Causa | Arreglo |
|---|---|---|---|
| P-06 | «Autorizante (Dador)» muestra tu nombre | Elegiste a tu persona en P-04 | Volver a P-04 y elegir la SAS ([O3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)) |
| Portal | No aparece el servicio que habilitaste | Falta cerrar sesión / aceptar | Salir y entrar; si sigue, «Aceptación de Designación» ([O1](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)) |
| P-08b | El desplegable «Computador Fiscal» está vacío o no está tu alias | El certificado se creó a tu nombre (C-02 elegiste tu persona) | Crear el alias de nuevo eligiendo la SAS en C-02; la pantalla exige un computador «asociado a la persona que esta Ud. representando» ([S1](https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/autorizar-web-service-de-produccion)) |
| C-04 | Error al agregar alias (alias repetido) | El alias ya existe | Otro alias, o usar «Agregar certificado» sobre el existente ([S22](https://soporte.fierro.com.ar/portal/es/kb/articles/renovar-certificado-factura-electronica); [O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf)) |
| C-04 | Error al subir el archivo (texto exacto A CONFIRMAR) | Subiste el `.crt` o la `.key` en vez del `.csr`, o CSR mal formado | Subir el `.csr` que da la plataforma |
| PV-05 | El local no está en «Nuevo domicilio» | No está declarado como «Locales y Establecimientos» | §4.4 |
| WSASS | «El servicio no es delegable» | Se intentó adherir WSASS para la empresa | Adherirlo con la clave de una persona física ([O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)) |
| WSASS | «Error creando certificado» | Lo pegado no es un CSR o alias repetido | Pegar el CSR completo / alias nuevo ([O6](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf)) |
| Cualquier servicio nivel 3 | ARCA no deja operar | Clave nivel 2 (homebanking) | Subir a nivel 3 con la app ([O13](https://www.afip.gob.ar/clavefiscal/ayuda/obtener-clave-fiscal.asp)) |

### 8.2 Al conectar (WSAA; los muestra la plataforma)

Tabla oficial de errores del WSAA ([O9](https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf)) + soluciones:

| Código / mensaje | Qué significa | Arreglo |
|---|---|---|
| `coe.notAuthorized` — «Computador no autorizado a acceder al servicio» | Falta §7.3 (o §7.4 para padrón), o se hizo con el representado equivocado | Hacer la «Nueva Relación» con Representado = SAS y Computador Fiscal = alias ([S2](https://docs.afipsdk.com/recursos/errores-frecuentes)). ARCA pide no volver a pedir tickets hasta gestionarlo ([O9](https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf)) |
| `coe.alreadyAuthenticated` — «El CEE ya posee un TA valido para el acceso al WSN solicitado» | Se pidió otro ticket teniendo uno vigente (12 h), p. ej. dos sistemas/instancias con el mismo certificado | Reusar el TA guardado; si hay que forzar uno nuevo, esperar ~2 min en producción y ~10 min en homologación ([S2](https://docs.afipsdk.com/recursos/errores-frecuentes)); no compartir certificado con Thinkeon (§7.7) |
| `cms.cert.expired` — «Certificado expirado» | Pasaron los 2 años | §7.6 «Agregar certificado» con el mismo alias ([S4](https://afipsdk.com/blog/solucion-a-error-cert-expired/)) |
| `cms.cert.untrusted` — «Certificado no emitido por AC de confianza» | Certificado de homologación usado en producción o al revés | Usar el certificado del ambiente correcto ([S2](https://docs.afipsdk.com/recursos/errores-frecuentes); [S5](https://afipsdk.com/blog/solucion-a-certificado-no-emitido-por-ac-de-confianza/)) |
| `cms.sign.invalid` — «Firma inválida o algoritmo no soportado» | La clave privada no corresponde al certificado | Re-subir el `.crt` correcto o regenerar CSR+certificado |
| `cms.cert.invalid` — «Certificado con fecha de generación posterior a la actual» | Reloj atrasado | Sincronizar hora del servidor |
| `xml.generationTime.invalid` / `xml.expirationTime.expired` / `xml.expirationTime.invalid` | Horarios del pedido fuera de tolerancia (24 h) | Revisar reloj y zona horaria del pedido ([O9](https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf)) |
| `wsn.unavailable` / `wsaa.unavailable` / `wsaa.internalError` | ARCA caído momentáneamente | Reintentar más tarde; ante otros errores no pedir ticket nuevo antes de 60 s ([O9](https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf)) |

### 8.3 Al facturar (WSFE; los muestra la plataforma)

| Código / mensaje | Qué significa | Arreglo |
|---|---|---|
| **600** «ValidacionDeToken: No apareció CUIT en lista de relaciones: …» | El CUIT del pedido no está autorizado para ese certificado | Revisar §7.3 (Representado = SAS) o que se usa el CUIT correcto ([O12, ejemplo](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf); [S2](https://docs.afipsdk.com/recursos/errores-frecuentes)) |
| **600** «… Error al verificar hash: VerificacionDeHash: No validó la firma digital.» | Ticket de un ambiente usado en el otro | Pedir ticket del ambiente correcto ([S2](https://docs.afipsdk.com/recursos/errores-frecuentes)) |
| **601** «CUIT representada no incluida en token.» / **602** «No existen datos en nuestros registros.» | Token sin esa CUIT / dato inexistente | Revisar CUIT y relación ([O12](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf)) |
| **11002** «El punto de venta no se encuentra habilitado a usar el presente WS. Ver metodo FEParamGetPtosVenta» | PdV no es de web services o todavía no impactó | §4 (crear PdV «RECE…»); si es nuevo, esperar ([S2](https://docs.afipsdk.com/recursos/errores-frecuentes)) |
| **11000** «El PtoVta debe ser válido comprendido entre 1 y 99998» | Número fuera de rango | Corregir ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)) |
| PdV con `Bloqueado = S` | ARCA bloqueó el PdV | Regularizar en el ABM de puntos de venta ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)) |
| **10000** (mensajes 01–11, ver §2.4) | Problema del CUIT emisor (IVA, actividad, domicilio, DFE, clase A) | Según el mensaje ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)) |
| **10000** «04 … NO SE ENCUENTRA AUTORIZADA A EMITIR COMPROBANTES CLASE "A"…» / observación **10234** | Falta el F. 856 | §5 |
| **10016** «El número o fecha del comprobante no se corresponde con el próximo a autorizar» | Número salteado o fecha anterior al último | Pedir el último autorizado y usar el siguiente; no emitir con fecha anterior; PdV no compartido ([S2](https://docs.afipsdk.com/recursos/errores-frecuentes)) |
| **10246** «Campo Condición Frente al IVA del receptor es obligatorio conforme a lo reglamentado por la Resolución General N° 5616…» | Falta `CondicionIVAReceptorId` | Obligatorio con rechazo desde **01/12/2026** (manual v4.8: los códigos 10245/825 «quedaran en desuso») ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf); [S23](https://afipsdk.com/blog/factura-electronica-solucion-a-error-10242/)). Una guía de ago-2026 hablaba del 01/09/2026 ([S24](https://llbsolutions.com/es/facturacion-electronica-argentina-2026/)): quedó superada por la v4.8 |
| **501** «Error interno de base de datos» / **500** / **502** | Falla de ARCA | Reintentar ([O12](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf); [S2](https://docs.afipsdk.com/recursos/errores-frecuentes)) |

---

## 9. Tiempos y propagación

| Acción | Cuándo queda activa | Fuente |
|---|---|---|
| Nueva relación de un servicio interactivo | Al confirmar; para verla hay que **cerrar sesión y volver a entrar**; si no aparece, aceptar en «Aceptación de Designación» | [O1](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf) |
| Alta de alias/certificado | Inmediata (aparece en la lista; «Ver» → «Descargar») | [O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf) |
| Autorización del computador fiscal a un WS | Al confirmar («el servicio SI se encuentra disponible para ser utilizado») | [O3](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf) |
| Punto de venta nuevo visible en el WSFE | De minutos a horas; sin plazo oficial (A CONFIRMAR) | [S2](https://docs.afipsdk.com/recursos/errores-frecuentes); [S12](https://declar.ar/blog/vincular-cuenta-arca-facturacion-electronica/) |
| Aviso normativo del PdV | ≥ 3 días hábiles antes de operar en el lugar nuevo | [O17](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto) |
| Ticket de acceso (TA) | Vale **12 h**; reusarlo | [O9](https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf) |
| Pedir TA de nuevo tras un error | No antes de 60 s (salvo errores `coe.*`/`cms.*`: no pedir hasta arreglar) | [O9](https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf) |
| Forzar TA nuevo | ~2 min en producción, ~10 min en homologación | [S2](https://docs.afipsdk.com/recursos/errores-frecuentes) |
| Certificado | 2 años; renovar antes | [S4](https://afipsdk.com/blog/solucion-a-error-cert-expired/); [O4](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf) |
| F. 856 (Factura A) | A veces inmediato, a veces días; si se suspende, 15 días para documentar | [S20](https://www.estudiopiccinini.com.ar/impositivo/factura-clase-a-solicitud-inicial-de-comprobantes/); [O16](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf); histórico [contadoresenred 2019](https://contadoresenred.com/pasos-para-la-habilitacion-de-factura-a-segun-rg-4627-19/) |
| Mis Comprobantes | Muestra lo generado **hasta el día de ayer** | [S14, captura](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip) |

---

## 10. Mis Comprobantes (bajar los comprobantes recibidos)

(Formatos de archivo, columnas y deduplicación están en `arca-mis-comprobantes.md`; acá sólo cómo habilitarlo y dónde está
cada botón.)

### 10.1 Habilitarlo para la SAS
1. P-03 → «Administrador de relaciones» → P-04 **la SAS** → P-05 «Nueva Relación» → P-06 «BUSCAR».
2. P-07 → ARCA → «Servicios Interactivos» → **«Mis Comprobantes»** (ubicación en el árbol: A CONFIRMAR; guías indican que «se
   habilita una sola vez desde "Administrador de Relaciones de Clave Fiscal"» [S15](https://monito.ar/como-ver-facturacion)).
3. Representante → P-08a → tu CUIT (o el de la contadora) → «CONFIRMAR» → P-09 «CONFIRMAR».
4. Cerrar sesión y volver a entrar.
- Nivel de clave exigido: A CONFIRMAR (ARCA lo muestra al elegir el servicio como «(Nivel de seguridad mínimo requerido N)»;
  un medio especializado habla de nivel 3 [S17](https://contadoresenred.com/mis-comprobantes-permite-consultar-y-descargar-en-excel-periodos-de-hasta-365-dias/)).

### 10.2 Pantallas

**M-01 · Buscador del portal**
- **Qué vas a ver:** al tipear «mis comprobantes» aparece la tarjeta «Mis Comprobantes — Consulta de Comprobantes Electrónicos
  Emitidos y Recibidos» ([S14, captura jun-2025](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip)).
- **Qué tocás:** la tarjeta.

**M-02 · Elegir a quién representar**
- Si representás a más de una persona, elegís la SAS ([S14](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip)).
  Para sociedades se entra con el CUIT del administrador ([S7](https://afipsdk.com/blog/descargar-mis-comprobantes-de-arca-en-nodejs/)).
  Texto y diseño exactos de esta pantalla: A CONFIRMAR.

**M-03 · Portada del servicio**
- **Estilo:** diseño nuevo, banner azul con título blanco grande.
- **Qué vas a ver:** «Mis Comprobantes — Desde esta servicio pode consultar tus Comprobantes Electrónicos»; aviso amarillo
  «Tené en cuenta que desde este servicio solamente vas a poder visualizar los **comprobantes electrónicos generados hasta el
  día de ayer**.»; dos tarjetas: **«Emitidos — Comprobantes Emitidos»** (azul) y **«Recibidos — Comprobantes Recibidos»**
  ([S14, captura](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip)).
- **Qué tocás:** **«Recibidos»**.

**M-04 · Consulta** (captura disponible de «Comprobantes Emitidos»; «Recibidos» es análoga)
- **Qué vas a ver:** pestañas **«Consulta · Resultados · Historial»**; campo obligatorio **«Fecha del Comprobante \*»** con
  la leyenda **«Rango máximo: 365 días»**; filtros «Tipo de Comprobante», «Punto de Venta», «Número desde», «Número hasta»,
  «CUIT del Emisor» (desplegable), «Tipo y Nro. de Documento del Receptor» (botón «CUIT / CUIL / CDI» + número), «Código de
  Autorización»; botón ancho **«BUSCAR»** ([S14, captura](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip)).
  En «Recibidos» los campos de emisor/receptor se invierten (texto exacto: A CONFIRMAR); los filtros disponibles coinciden con
  los de la automatización de Afip SDK (`fechaEmision`, `puntosVenta`, `tiposComprobantes`, `comprobanteDesde/Hasta`,
  `tipoDoc`, `nroDoc`, `codigoAutorizacion`) ([S7](https://afipsdk.com/blog/descargar-mis-comprobantes-de-arca-en-nodejs/)).
- **Selector de fechas:** dos calendarios + atajos «Ayer», «Últimos 7 Días», «Últimos 15 Días», «Últimos 30 Días», «Este Mes»,
  **«Mes Pasado»**, «Este Año», «Año Pasado», «Rango Personalizado», botones «Aplicar» y «Cancelar»
  ([S14, captura](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip)).
- **Qué tocás:** «Mes Pasado» (o el rango) → «Aplicar» → «BUSCAR».

**M-05 · Resultados y descarga**
- **Qué vas a ver:** pestaña «Resultados»; caja azul «Filtro Aplicado» (p. ej. «Fecha del Comprobante: 01/03/2025 a
  19/06/2025»); botonera chica **«Excel» · «PDF» · «CSV»** + íconos de columnas, imprimir y filas por página; buscador «Buscar:»;
  tabla «Fecha · Tipo · Número · Denominación … · Imp. Total»; «Mostrando registros 1 al 5 de un total de 19» y paginado
  ([S14, captura](https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip)).
- **Qué tocás:** **«CSV»** (baja un **.zip** con el CSV adentro: [S15](https://monito.ar/como-ver-facturacion);
  [S16](https://ayuda.xubio.com/es-ar/como-importo-mis-facturas-de-compra-desde-afip/)) o «Excel».
- **Qué copiás:** subir el `.zip` (o el Excel) al importador de la plataforma.

### 10.3 Notas
- **No hay web service oficial** para listar/bajar recibidos (no figura en el catálogo [O19](https://www.arca.gob.ar/ws/documentacion/catalogo.asp));
  lo oficial relacionado es la constatación puntual WSCDC. La descarga es manual (1 vez por mes). Existen automatizaciones de
  terceros que piden **usuario y clave fiscal** ([S7](https://afipsdk.com/blog/descargar-mis-comprobantes-de-arca-en-nodejs/)):
  no recomendable (implica guardar la clave fiscal del administrador).
- El rango de consulta subió a 365 días en 2023 ([S17](https://contadoresenred.com/mis-comprobantes-permite-consultar-y-descargar-en-excel-periodos-de-hasta-365-dias/)).

---

## 11. Notas para el diseño del instructivo y del asistente de la plataforma

**Tres «familias» visuales de ARCA (para que los mockups se parezcan a lo real):**
1. **Portal nuevo** (P-01 a P-03, Mis Comprobantes): blanco + azul marino, íconos circulares, tarjetas, buscador grande.
2. **Servicios viejos** (Administrador de Relaciones, Certificados, Puntos de Venta): barra lateral negra con «ARCA», cajas
   celestes, botones azules en MAYÚSCULAS («BUSCAR», «CONFIRMAR», «VOLVER»), cabecera «Bienvenido Usuario … / Actuando en
   representación de …». El ABM de puntos de venta usa ventanas modales grises.
3. **WSASS** (sólo desarrollador): cabecera con degradé azul y logo viejo de AFIP.

**Tres alertas que conviene destacar en el instructivo (son los errores más comunes):**
1. «Siempre elegí **la SAS** en el desplegable; mirá que arriba diga *Actuando en representación de HUB…*» (P-04/P-05).
2. «El punto de venta tiene que decir **RECE para aplicativo y web services**; uno nuevo, no el de Thinkeon» (§4).
3. «Lo que subís a ARCA es el **.csr**; lo que bajás y traés a la plataforma es el **.crt**» (§7.2).

**Datos que el asistente de la plataforma debería pedir y validar:**

| Dato | Formato / validación |
|---|---|
| CUIT de la SAS | 11 dígitos con dígito verificador; debe coincidir con el `serialNumber` del certificado |
| Número de punto de venta | Entero 1–99998 ([O11](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)); verificar con `FEParamGetPtosVenta` que existe y `Bloqueado = N` |
| Alias | Lo propone la plataforma (minúsculas/números); se muestra para copiar |
| CSR | Lo genera la plataforma (RSA 2048, CN = alias, `serialNumber=CUIT <CUIT>`); botón «Descargar .csr» |
| Certificado | Archivo que empiece con `-----BEGIN CERTIFICATE-----` ([S2](https://docs.afipsdk.com/recursos/errores-frecuentes)); que corresponda a la clave guardada; leer el vencimiento y avisar ~30 días antes |
| Ambiente | Homologación / Producción (no mezclar certificados: [S5](https://afipsdk.com/blog/solucion-a-certificado-no-emitido-por-ac-de-confianza/)) |
| Servicios autorizados | Checklist «Facturación Electrónica» ✔ «Consulta de constancia de inscripción» ✔ (verificado con un ticket por servicio) |
| Factura A | Pregunta «¿Hiciste la habilitación de Factura A (F. 856)? ¿Qué te autorizaron: A / A con "Operación sujeta a retención" / A con "Pago en CBU informada"?» (define qué comprobantes ofrece la plataforma) |

**Nunca pedir:** la clave fiscal de nadie (todo lo de ARCA lo hace la persona en el portal).

---

## 12. A CONFIRMAR (lista consolidada)

1. Texto exacto actual del menú del ABM: «A/B/M de Puntos de Venta» vs «A/B/M de puntos de venta / emisión»; si aparece un aviso
   para «Cerrar» (§4.3).
2. Si el alta del PdV muestra el campo opcional de **actividad** (RG 5824, desde 01/07/2026) y su nombre (§4.3).
3. Diálogo de confirmación («Sí») y nombre/forma de la constancia descargable del alta del PdV (§4.3).
4. Tiempo real de propagación de un PdV nuevo al WSFE (§4.5, §9) y si el aviso de 3 días hábiles aplica a un PdV nuevo en un
   local que ya opera.
5. Botones exactos del alta de «Locales y Establecimientos» en el Registro Único Tributario (§4.4).
6. Si ARCA rechaza un CSR cuyo CN ≠ alias o cuyo `serialNumber` ≠ CUIT elegido; texto del error por archivo inválido (§7.2).
7. Formulario exacto de «Agregar certificado» (renovación) en producción (§7.6).
8. Nivel de clave de «Consulta de constancia de inscripción», «Mis Comprobantes» y «Regímenes de Facturación y Registración».
9. Ubicación de «Mis Comprobantes» en el árbol del Administrador de Relaciones y su descripción; texto de la pantalla para elegir
   representado; nombres de campos en «Comprobantes Recibidos» (§10).
10. Pantallas del F. 856 después de la RG 5762 (§5).
11. Si homologación valida la condición de IVA del CUIT representado y si acepta cualquier número de PdV (§6).
12. Recorrido interno de la pantalla del Domicilio Fiscal Electrónico 2025–2026 (§2.3).
13. Código CLAE correcto para HUB (561014 u otro) — con la contadora (§2.4).
14. Texto exacto del aviso de ARCA cuando la clave no tiene nivel suficiente (§2.2).
15. Inferencia «si no aparece la SAS en "Autoridad de Aplicación", no sos administrador» (§2.1).

---

## 13. Fuentes

**Oficiales (ARCA / Boletín Oficial)**
- [O1] ARCA — «¿Cómo obtener el Certificado Digital para entorno de producción?» (PDF con capturas; versión ARCA 2025): https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf
- [O2] ARCA — «¿Cómo asociar el Certificado Digital a un WSN (Web Service de Negocio)?» (PDF): https://www.afip.gob.ar/ws/WSAA/wsaa_asociar_certificado_a_wsn_produccion.pdf
- [O3] ARCA — «Documento Técnico Delegación de Webservices ARCA con el Administrador de Relaciones» (PDF, republicado 15/07/2025): https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf
- [O4] ARCA — «Generación de Certificados para Producción, Publicación 1.0» (PDF, republicado 14/07/2025): https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf
- [O5] ARCA — «Acciones a realizar para consumir un Webservice de Factura Electrónica» (PDF, 30/09/2026): https://www.afip.gob.ar/fe/documentos/AccionesarealizarparaconsumirunWebservicedeFacturaElectr.pdf
- [O6] ARCA — «Manual del Usuario del WSASS» (PDF, 14/07/2025): https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf
- [O7] ARCA — «WSASS: Cómo adherirse al servicio» (PDF, 15/07/2025): https://www.arca.gob.ar/ws/WSASS/WSASS_como_adherirse.pdf
- [O8] ARCA — Manual WSASS HTML: https://www.arca.gob.ar/ws/WSASS/html/index.html · generarcsr: https://www.arca.gob.ar/ws/WSASS/html/generarcsr.html · crearcertificado: https://www.arca.gob.ar/ws/WSASS/html/crearcertificado.html · crearautorizacion: https://www.arca.gob.ar/ws/WSASS/html/crearautorizacion.html
- [O9] ARCA — Especificación Técnica WSAA 1.2.2 (PDF, 15/07/2025): https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf
- [O10] ARCA — WSAA, documentación y URLs: https://www.afip.gob.ar/ws/documentacion/wsaa.asp
- [O11] ARCA — Manual para el desarrollador WSFEv1 «RG 4291 – Proyecto FE v4.8», revisión 01/12/2026 (PDF creado 27/08/2026): https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf
- [O12] ARCA — Manual WSFEv1 v4.0 (17/03/2025): https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf
- [O13] ARCA — Ayuda clave fiscal, obtener: https://www.afip.gob.ar/clavefiscal/ayuda/obtener-clave-fiscal.asp · datos biométricos: https://www.afip.gob.ar/clavefiscal/ayuda/datos-biometricos.asp · Token: https://www.afip.gob.ar/clavefiscal/ayuda/token.asp
- [O14] ARCA — Ayuda clave fiscal, personas jurídicas: https://www.afip.gob.ar/clavefiscal/ayuda/personas-juridicas.asp
- [O15] ARCA — Domicilio Fiscal Electrónico: https://www.arca.gob.ar/DomicilioFiscalElectronico/servicio-clave-fiscal/default.asp
- [O16] RG 5762/2025 (BO 25/09/2025, vigente 01/12/2025), texto vía Consejo Profesional de Salta: https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf
- [O17] RG 5824/2026 (BO 13/02/2026), texto oficial: https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto
- [O18] RG 5803/2025 (vigente 02/03/2026), texto vía Consejo Profesional de Salta: https://consejosalta.org.ar/wp-content/uploads/ARCA-5803.pdf
- [O19] ARCA — Catálogo de otros WS de negocio: https://www.arca.gob.ar/ws/documentacion/catalogo.asp
- [O20] ARCA — Manual ws_sr_constancia_inscripcion: https://www.afip.gob.ar/ws/WSCI/manual-ws-sr-ws-constancia-inscripcion.pdf
- [O21] Argentina.gob.ar — Designar Administrador de Relaciones o apoderado ante ARCA: https://www.argentina.gob.ar/servicio/designar-administrador-de-relaciones-o-apoderado-ante-arca
- [O22] RG 4280/2018 (DFE obligatorio): https://www.argentina.gob.ar/normativa/nacional/norma-312678/texto
- Otras oficiales consultadas: entorno de prueba FE https://www.afip.gob.ar/fe/ayuda/entorno-prueba.asp · certificados para programadores https://www.afip.gob.ar/ws/programadores/certificados-digitales.asp

**Secundarias**
- [S1] Afip SDK — Tutoriales «página de ARCA» (capturas feb-2025): crear punto de venta https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta · habilitar administrador de certificados (prod) https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/habilitar-administrador-de-certificados-de-produccion · obtener certificado de producción https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-produccion · autorizar web service de producción https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/autorizar-web-service-de-produccion · testing: https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/obtener-certificado-de-testing y https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/autorizar-web-service-de-testing · aceptar delegación https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/aceptar-delegacion-de-web-service
- [S2] Afip SDK — Errores frecuentes: https://docs.afipsdk.com/recursos/errores-frecuentes
- [S3] Afip SDK — Preguntas frecuentes: https://docs.afipsdk.com/recursos/preguntas-frecuentes
- [S4] Afip SDK — «Error: ns1:cms.cert.expired» (21/02/2025): https://afipsdk.com/blog/solucion-a-error-cert-expired/
- [S5] Afip SDK — «Certificado no emitido por AC de confianza» (17/02/2025): https://afipsdk.com/blog/solucion-a-certificado-no-emitido-por-ac-de-confianza/
- [S6] Afip SDK — «Obtener el certificado para conectar tu sistema…» (20/02/2025): https://afipsdk.com/blog/como-obtener-certificado-para-web-services-arca/
- [S7] Afip SDK — «Descargar Mis Comprobantes de ARCA en NodeJS» (24/10/2025): https://afipsdk.com/blog/descargar-mis-comprobantes-de-arca-en-nodejs/
- [S8] Afip SDK — Factura electrónica (etiquetas «Producción»/«Desarrollo» del servicio): https://docs.afipsdk.com/siguientes-pasos/web-services/factura-electronica
- [S9] Afip SDK — Padrón de constancia de inscripción (etiquetas): https://docs.afipsdk.com/siguientes-pasos/web-services/padron-de-constancia-de-inscripcion
- [S10] Facturante — Crear PdV asociado a WebServices: https://facturante.ladesk.com/521097-C%C3%B3mo-crear-un-punto-de-venta-asociado-a-WebServices-en-ARCA?r=1
- [S11] MiGestión — Crear PdV para Web Services: https://migestion.app/guias/como-crear-un-punto-de-venta-asociado-a-webservices-en-ARCA
- [S12] declar.ar — Vincular cuenta ARCA (27/08/2026): https://declar.ar/blog/vincular-cuenta-arca-facturacion-electronica/
- [S13] Fudo — Alta del punto de venta electrónico (13/07/2026): https://soporte.fu.do/es/articles/11731376-1-argentina-dar-de-alta-el-punto-de-venta-electronico
- [S14] Ecomm-App — «¿Dónde están mis comprobantes en ARCA?» (capturas, 19/06/2025): https://soporte.ecomm-app.com/hc/ayuda-ecommapp/articles/1687481287-donde-estan-mis-comprobantes-en-afip
- [S15] monito.ar — Ver facturación en Mis Comprobantes: https://monito.ar/como-ver-facturacion
- [S16] Xubio — Importar facturas de compra desde Mis Comprobantes: https://ayuda.xubio.com/es-ar/como-importo-mis-facturas-de-compra-desde-afip/
- [S17] Contadores en Red — Mis Comprobantes hasta 365 días: https://contadoresenred.com/mis-comprobantes-permite-consultar-y-descargar-en-excel-periodos-de-hasta-365-dias/
- [S18] Tristán y Asociados — Subadministrador de relaciones (14/05/2025): https://tristanyasociados.com/2025/05/subadministrador-de-relaciones/
- [S19] CSC / NIC.ar — «Generar nueva relación en AFIP» (F3283/E): https://www.CSCGlobal.com/cscglobal/pdfs/AR_portal_instructions_Generate_a_New_Relationship_at_AFIP-NIC.ar-ENGLISH.pdf
- [S20] Estudio Piccinini — Factura clase A, solicitud inicial (12/09/2025): https://www.estudiopiccinini.com.ar/impositivo/factura-clase-a-solicitud-inicial-de-comprobantes/
- [S21] PyAfipWs — puntos de venta en homologación: https://groups.google.com/g/pyafipws/c/PqKowNnwdkw (y 2018: https://groups.google.com/g/pyafipws/c/oGQFQqDq8sI)
- [S22] Fierro — Renovar certificado de factura electrónica: https://soporte.fierro.com.ar/portal/es/kb/articles/renovar-certificado-factura-electronica
- [S23] Afip SDK — Error 10242 / CondicionIVAReceptorId: https://afipsdk.com/blog/factura-electronica-solucion-a-error-10242/
- [S24] LLB Solutions — Facturación electrónica 2026 (21/08/2026): https://llbsolutions.com/es/facturacion-electronica-argentina-2026/
- [S26] TG-CQ — RG 5809/2026 domicilio fiscal (RUT → Domicilios → Modificar): https://www.tg-cq.com/post/arca-rg-5809-2026-domicilio-fiscal-cambios-y-domicilios-especiales
- [S27] Yo Facturo — Alta de PdV (usar con cuidado; tiene datos inexactos como el rango 1–9998): https://yo-facturo.com/blog/como-dar-de-alta-un-punto-de-venta-en-arca/

**Capturas descargadas para referencia del diseñador** (scratchpad, no versionar):
`research/img/small/*.png` (tutoriales Afip SDK: punto de venta, certificados, autorizaciones, WSASS) y
`research/img/miscomp-*.png` (Mis Comprobantes, jun-2025). PDFs oficiales y textos extraídos en `research/src/`.
