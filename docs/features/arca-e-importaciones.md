# Administración — ARCA e importaciones

> Para que el bar cargue lo menos posible a mano. La plataforma se conecta con ARCA (la ex AFIP)
> para traer los datos de cada CUIT y emitir facturas con CAE, e importa lo que se baja de ARCA,
> de Mercado Pago y del banco. Una persona revisa y confirma: **nada se contabiliza solo**.
> Dos guías in-app explican cómo conectar todo y qué sigue a mano.

## Qué hay

| Ruta (bajo `/[slug]/administracion`) | Qué es |
|---|---|
| `/ajustes?tab=arca` | Estado de la conexión (sin empezar, a medio camino, conectado o con error), «Probar conexión», renovar, desconectar, prender la emisión. Plegado: «Pruebas (homologación)», con `#homologacion`. |
| `/ajustes/arca` | Guía «Conectar ARCA», pasos 0 a 10 con maquetas del portal (`#paso-0` … `#paso-10`, `#renovar`). |
| `/importar` | Las tres fuentes, el historial y lo que sigue a mano. |
| `/importar/arca` · `/importar/mercado-pago` · `/importar/banco` | Subir el archivo: se lee en el navegador y se sube en tandas. |
| `/importar/[batchId]` | Revisión: proveedores nuevos, lo que falta, cargar de a 15. Filtros con `?ver=` y `?falta=`. |
| `/guias` · `/guias/como-arrancar` | Índice de guías y «Cómo arrancar»: qué cargar el día 1, a diario, por semana y por mes, dónde y cómo. |
| `/print/factura/[slug]/[id]` (fuera del panel) | La factura con CAE para imprimir o guardar en PDF (QR de ARCA). Las de prueba dicen PRUEBA. |

También:

- **«Completar con ARCA»** al dar de alta un proveedor o un cliente: en Compras, en Ventas, en los saldos iniciales y en la ficha del proveedor, que muestra «Verificado en ARCA el …».
- **Emisión con CAE** en Ventas › Factura de venta, cuando la conexión de producción está probada y la emisión prendida.
- **Avisos** en el Resumen: certificado por vencer, facturas para verificar y lotes para revisar.
- **⌘K:** «Importar…», «Conectar ARCA», «Cómo arrancar» y «Guías de Administración».

**Quién puede hacer qué.** Cargar, conectar y emitir es solo para dueños con acceso de escritura a
Administración. La contadora (rol `accountant`) ve estados, historial y revisiones, sin botones.

## Puesta en marcha

1. **Migraciones.** Son 14, a partir de `20261008120000_acc_arca_core.sql`, y se aplican en orden con
   el «sí» explícito del dueño, porque el Supabase remoto es producción.
   - La #1 ya está aplicada.
   - Mientras falten las demás, las pantallas no se rompen: las acciones dicen «Esta función todavía
     no está disponible…» y las lecturas ofrecen «Reintentar».
   - Después de aplicarlas, regenerá `types/database.ts` por MCP.
2. **La clave del servidor: `META_TOKEN_KEY`.** ARCA reusa la misma clave que los tokens de Meta.
   - Cifra la clave privada del certificado y el ticket de acceso.
   - Tiene que tener 16 caracteres o más.
   - Tiene que ser **idéntica en local, en las previews y en producción**. Con otra clave, lo guardado
     no se puede leer (`secret_unreadable`): hay que desconectar y repetir los pasos 5 a 9 de la guía.
   - Guardala también en un gestor de contraseñas.
3. **Datos de la SAS.** Sin la CUIT de la SAS (Ajustes › Datos de la SAS), no se puede generar el
   pedido del certificado ni importar compras de ARCA.
4. **Homologación primero.** En «Pruebas (homologación)», quien programa hace:
   1. genera el pedido con su CUIT personal;
   2. crea el certificado en WSASS y lo autoriza a `wsfe` y `ws_sr_constancia_inscripcion`, con la
      CUIT de la SAS como representada;
   3. lo sube;
   4. guarda un punto de venta;
   5. corre «Probar conexión» **desde una preview de Vercel**;
   6. emite una factura de prueba (B a consumidor final por $ 121; nunca va a los libros).

   Recién con eso andando se pasa a producción.
5. **Producción.** Lo hace quien tiene la clave fiscal nivel 3 de la SAS, siguiendo la guía
   `/ajustes/arca`. Pasos:
   - punto de venta propio de la plataforma, distinto del que usa el sistema de caja de hoy;
   - certificado y autorizaciones;
   - «Probar conexión»;
   - recién ahí, prender la emisión, que pide confirmación.
6. **Importadores.** No piden configuración extra.
   - Mercado Pago necesita la billetera de Mercado Pago, con su CVU, en Ajustes › Cajas.
   - El banco necesita la cuenta, y la primera vez se le dice qué es cada columna.

Variables opcionales:

- `ARCA_RELAY_URL` / `ARCA_RELAY_SECRET`: un relay en Argentina, solo si ARCA bloquea las IP de
  Vercel. Hoy no hay ninguno.
- `ARCA_FAKE_TIMEOUT=1`: solo en local, para simular que se pierde la respuesta del CAE. En
  producción se ignora.

## Límites conocidos

- **Tiempo.**
  - Las páginas de Administración tienen `maxDuration = 60`.
  - «Probar conexión» y la emisión se cortan solas a los 50 s, y «Completar con ARCA» a los 40 s.
  - Un login al WSAA solo se empieza si quedan 20 s o más.
  - Next corre las server actions de a una por pestaña, así que mientras ARCA contesta las otras
    acciones de esa pestaña esperan.
- **Topes por minuto, por bar.** Se cuentan en memoria de cada instancia.
  - 10 pruebas de conexión por ambiente.
  - 30 consultas al padrón. Un lote de hasta 250 CUIT cuenta como una.
  - 10 emisiones.
  - 6 facturas de prueba.
- **Permiso de ARCA (ticket).** Si ARCA ya le dio un permiso a ese certificado y la respuesta se
  perdió, contesta «ya posee un TA válido». La plataforma espera de 2 a 10 minutos y avisa; en el
  peor caso hay que esperar a que ese permiso venza (12 h). El permiso que ARCA rechaza se descarta
  solo; para eso hace falta la migración 14.
- **Emisión.**
  - Letras A y B, notas de crédito y de débito.
  - No sale: la A «sujeta a retención» (código 51), la de CBU informada ni la FCE.
  - Una factura con CAE nunca se reemite: si falla el asiento, queda «Cargarla ahora».
  - Anularla en los libros está bloqueado en la pantalla (también desde el cobro del mismo envío),
    pero todavía no en la base.
  - La base del QR (`arca.gob.ar`) y el tope de la B anónima están a confirmar.
- **Importaciones.**
  - Archivos de hasta 20 MB.
  - Se suben en tandas de 500 filas o 1 MB y se cargan de a 15 comprobantes.
  - Mis Comprobantes se baja a mano: por la Disposición AFIP 74/2022 no se automatiza el portal.
  - Mercado Pago, por ahora solo con el CSV de Liquidaciones (la API es de la fase 4).
  - «Emitidos» todavía no se importa.
  - Hace falta `DecompressionStream` (Safari 16.4 o más nuevo).
- **Tests.** Los de RLS (`tests/rls`, en CI) no cubren todavía las RPC de emisión. Lo real se prueba
  con el smoke de homologación.

Lo que quedó pendiente está en la sección «Administración» de `BACKLOG.md`.

## Documentos de trabajo

Están en `docs/features/arca-e-importaciones/`:

- `diseno.md`: el diseño completo (conexión, guías, emisión, importadores, base y plan por fases).
- `fase1-estado.md`, `fase2-estado.md` y `fase3-estado.md`: qué se hizo en cada fase, los contratos con la base
  y lo que se verificó.
- `fase3-datos.md`: la pasada de punta a punta con datos en el bar demo y qué datos quedaron ahí.
- `investigacion/`: los pasos en ARCA (textos exactos de cada pantalla), el detalle técnico de WSAA, WSFE y
  padrón, Mis Comprobantes, Mercado Pago y Banco Nación.

Las rutas a `scratchpad/` que aparecen adentro son de la sesión de trabajo y ya no existen.
