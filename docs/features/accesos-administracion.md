# Accesos a Administración: quién entra y con qué nivel

> Pedido de los socios de HUB (22/11/2026): «dentro de administración, los empleados solo deberían poder
> ver compra y pagos», «todos los socios deben poder dar accesos (está solo Tomás)» y «prioriza el acceso
> a la información de los empleados».

Administración es privada: no alcanza con tener rol de dueño en el bar. Cada persona entra con un
**acceso** propio (`acc_access`), que le da alguien que ya «da accesos». La contadora entra aparte, con
su rol, en solo lectura.

Se maneja en **Administración › Ajustes › Accesos** (`/{slug}/administracion/ajustes?tab=accesos`).

## Los dos niveles

Cada acceso tiene un nivel (`acc_access.scope`):

| Nivel | Para quién | Qué ve y qué hace |
|---|---|---|
| **Completo** (`full`) | Los socios | Todo: ventas, cierres, sueldos, gastos fijos, cajas con sus saldos, resumen, libros y ajustes. Carga, anula y cierra meses. |
| **Solo compras y pagos** (`purchases`) | Los empleados que cargan compras | Carga compras, gastos y pagos a proveedores, y ve los proveedores con lo que se le debe a cada uno. **No ve** ventas, cierres, sueldos, gastos fijos, saldos de las cajas, resumen ni libros, y **no anula** comprobantes. |

- Los accesos que ya existían quedaron en **Completo**: a nadie le cambió nada.
- **«Da accesos»** es aparte del nivel y solo se puede prender con el nivel Completo: quien habilita a
  otros ve todo Administración. Conviene que lo tengan todos los socios (en HUB lo tenía una sola persona).
- Siempre tiene que quedar al menos una persona que dé accesos. A la única que los da no se le puede
  apagar «da accesos», bajar de nivel ni sacar el acceso: primero hay que marcar a otra.

Qué ve cada nivel lo decide **la base**, no la pantalla: «leer todo» y «cargar todo»
(`acc_reader_tenant_ids`, `acc_writer_tenant_ids`) piden el nivel completo, y a «solo compras y pagos» se
le abre a mano lo de compras (migración `acc_accesos_por_nivel`). La app solo decide qué se dibuja, con lo
que le contesta `acc_my_access`: `read` / `write` (nivel completo), `buy_read` / `buy_write` (compras y
pagos, con cualquiera de los dos niveles) y `scope`. En el código: `AccountingAccess` (`lib/tenant/types.ts`),
`accountingAllows` e `isPurchasesOnly` (`lib/accounting/access.ts`).

## La pantalla

Arriba, las llaves. El titular cuenta **personas** («5 personas entran»), no socios: con los niveles
también entran empleados. Abajo, lo que haga falta aclarar: el reparto si hay alguien en el nivel acotado
y cuántos dueños del bar faltan («3 ven todo · 2 solo compras y pagos · 1 todavía no entra»), y quiénes
dan accesos. En el dibujo, un punto por persona: relleno = entra; con aro dorado = además da accesos;
**medio punto** = entra solo a compras y pagos; hueco punteado = todavía no entra. La fila de Accesos en
la portada de Ajustes dice la misma cuenta («5 personas entran a Administración · 3 ven todo.»).

**Entran.** Arriba de la lista, los dos niveles con una línea de qué ve cada uno. Por persona:

- **El nivel**, en dos fichas con la elegida rellena: «Solo compras y pagos» · «Completo». Se cambia con
  un toque.
  - *Subir* a Completo es inmediato.
  - *Bajar* a «Solo compras y pagos» pregunta antes, diciendo qué deja de ver (y que deja de dar accesos,
    si los daba).
- **«También da accesos»**: un interruptor. Con «Solo compras y pagos» está apagado y no se puede
  prender (abajo de la lista dice por qué).
- **«Sacar acceso»**: confirma y pide un motivo opcional; queda en el historial.

La lista va con quienes ven todo primero y, adentro de cada grupo, por nombre. Prender «da accesos» no
mueve a nadie de lugar (se puede marcar a varios socios seguidos sin que salten las filas).

**Todavía no entran.** Los dueños del bar sin acceso. «Dar acceso» abre «¿Qué va a ver {nombre}?» con
los dos niveles como tarjetas (cada una con su línea y «Para empleados» / «Para socios»). Viene marcado
**«Solo compras y pagos»**: es lo prudente; a un socio se le marca «Completo» (y ahí aparece «También da
accesos»).

Lo que se toca se ve al instante. Si el guardado falla, la pantalla vuelve sola a como estaba, avisa por
qué y vuelve a leer la lista (casi siempre falló porque otra persona la cambió recién: «Esa persona ya no
tiene acceso»). Sin conexión avisa «no se guardó, volvé a tocarlo» y no relee (pedir la pantalla sin red
la reemplazaría por el error del navegador). El aviso de «listo» dice lo que cambió («Luciano ahora
también da accesos», «Eze ahora ve solo compras y pagos»).

**Quien no da accesos** (otro socio, la contadora) ve lo mismo en solo lectura: el nivel de cada uno como
una etiqueta, quién da accesos, y la oración «Los accesos los da …». Ningún control.

## Cómo dejar a HUB como pidieron los socios

1. Quien hoy da accesos entra a Ajustes › Accesos.
2. A cada socio le prende **«También da accesos»** (un toque por persona).
3. A cada empleado que ya tenía acceso lo pasa a **«Solo compras y pagos»** (confirma).
4. A un empleado que todavía no entra: «Dar acceso» → queda en «Solo compras y pagos» con dos toques.

## Socio = dueño con acceso completo

El mismo dato decide quién ve la plata del salón: la caja a ciegas, el mail del cierre de caja y las
pantallas que son de los socios usan `seesSalonNumbers` y `pickPartners` (`lib/pos/cash/blind.ts`,
`lib/pos/cash/partners.ts`; ver `pos.md` › «La caja a ciegas»). **Un dueño con «solo compras y pagos» no
es socio**: en la caja opera a ciegas y no recibe el cierre. En un bar sin Administración, socios son
todos los dueños.

Por eso este panel es el único lugar donde se decide quién ve qué: no hay otra lista que mantener.

## Dónde vive

- Pantalla: `app/(manager)/[tenantSlug]/administracion/ajustes/_components/access-panel.tsx` (el dibujo
  de las llaves, `key-dots.tsx`).
- Palabras: `ajustes/_lib/access-copy.ts` (`LEVEL_COPY`, `downgradeCopy`, `savedLine`, `levelBreakdown`).
- Lo que se ve mientras se guarda: `ajustes/_lib/access-changes.ts` (`applyAccessChange`, con
  `useOptimistic`).
- Niveles (puro): `lib/accounting/access-levels.ts` (`scopeOf`, `compareAccessRows`, `canGrantOthers`,
  `DEFAULT_GRANT_SCOPE`).
- Lectura: `lib/accounting/queries/access.ts` › `getAccessOverview`. Pide todas las columnas de
  `acc_access` a propósito: si la app sale un rato antes que la base, `scope` no viene y todos se leen
  como Completo (que es lo que eran).
- Acciones: `lib/accounting/actions/access.ts` › `setAccountingAccess` (dar o cambiar),
  `revokeAccountingAccess`, `claimAccountingAdmin`. Las tres piden ser quien da accesos
  (`authorizeAccounting(slug, 'admin')`), salvo «pasar a darlos yo», que pide acceso completo.
- Esquema: `setAccessSchema` (`lib/accounting/schemas.ts`): el nivel es obligatorio y «da accesos» pide
  el completo.

### En la base

- `acc_access.scope text not null default 'full'`, con `check (scope in ('full', 'purchases'))` y
  `check (not is_admin or scope = 'full')`.
- `acc_set_access(p_tenant_id, p_user_id, p_scope, p_is_admin, p_display_name)`: da el acceso o cambia
  nivel, «da accesos» y nombre. Solo quien da accesos. Audita `acc_access.granted` con el nivel de antes y
  el de después. Errores: `scope_invalid`, `admin_needs_full`, `target_not_owner` (solo dueños del bar),
  `display_name_invalid`, `last_admin`. Todos tienen su mensaje en `lib/accounting/errors.ts`.
- `acc_grant_access` (la de antes) sigue existiendo para la app vieja; la app nueva no la usa.
- `acc_revoke_access` no cambió: nunca borra, marca `revoked_at`.

### Por soporte

Cuando el dueño de la plataforma pide «dale acceso a X» y el bar ya tiene quien dé accesos, se hace por
SQL como hasta ahora (fila en `acc_access` con `source = 'platform'` y auditoría `via: 'soporte'`),
agregando el nivel: `scope = 'purchases'` para un empleado, `'full'` para un socio.

## Qué ve cada nivel en la app

La base es la que manda (RLS y el permiso de cada función; migración `acc_accesos_por_nivel`). La app
decide tres cosas para el nivel «solo compras y pagos»: a dónde lo deja entrar, qué no pide (porque la
base se lo rechazaría) y qué no le dibuja (porque no lo puede usar). Todo sale de dos datos de
`get_tenant_access`: `buyRead` / `buyWrite` (entra y carga en Compras) y `read` / `write` (todo lo
demás). `isPurchasesOnly(accounting)` es `buyRead && !read`.

| | Completo | Solo compras y pagos |
|---|---|---|
| Menú lateral «Administración» | Resumen | va a Compras (el Resumen redirige, con la hoja que traía el link) |
| Barra de la sección | las seis palabras + engranaje, y las solapas en una segunda fila | una sola fila: el título «Compras y pagos», sus solapas Proveedores y Comprobantes al lado y «Cargar» (sin «Plan de la semana» ni engranaje) |
| «＋ Cargar» | todas las puertas + «contale a Tex» | Compra · Compra y pago · Pago («A un proveedor») |
| Hojas `?accion=` | las seis | `gasto` y `pagar`; cualquier otra no abre nada |
| ⌘K | todo Administración | Compra, Compra y pago, Pago, Proveedores, Comprobantes |
| Proveedores | lista, ficha, cuenta corriente | lo mismo, sin «Agregar de una lista», sin exportar, sin desactivar ni eliminar, sin el filtro «Impuestos y sueldos» (le vendría vacío); en vez del «⋯», «Clasificar · N» solo si hay alguno sin categoría |
| Comprobantes y Pagos | lista + exportes | lista, sin «Exportar» |
| Ficha de un comprobante | completa | corta: qué pasó con la plata, el papel y la foto (puede sumarla, no quitarla); sin el mapa de uniones, reimputar, anular ni el asiento. Solo compras, notas, gastos y pagos: otro tipo da 404 |
| Cargar una compra / gasto / pago | con saldos de cajas, gastos fijos, ARCA, impuesto al cheque | sin saldos («queda…», «no alcanza»), sin gastos fijos, sin ARCA, sin impuesto al cheque automático, sin «Deshacer» |
| Soltar un archivo | comprobantes y planillas | la foto o el PDF de un comprobante; una planilla avisa que es del nivel completo |
| Gastos fijos, Sueldos, Semana, Ventas, Caja, Contabilidad, Ajustes, Importar, Guía | sí | el 404 de la sección le dice qué ve con su acceso («Esto no está en Compras y pagos») y «Volver a Compras» |
| Exportar (`/api/administracion/export`) | sí | sin botones, y la ruta le contesta que no tiene acceso (sigue pidiendo `read`) |
| Tex | con Administración | sin el área de Administración ni adjuntar; no le sugiere lo de Administración y, si pregunta por compras o pagos, lo manda a la pantalla (no le dice que le falta acceso) |

### Dónde está cada regla

- **Puertas de página.** `requireComprasAccess(slug, returnTo, { level })` (`compras/_lib/page-access.ts`):
  el valor por defecto es el estricto (`'full'`, lo usan Gastos fijos, Sueldos y la Semana); las tres
  pantallas de compras (`compras`, `compras/nueva`, `compras/proveedores/[id]`) lo piden con
  `level: 'purchases'`. `requireBooksAccess` (`libros/_lib/page-access.ts`) igual: solo la ficha del
  comprobante usa `level: 'purchases'`. El resto de las páginas sigue pidiendo `read` y le da 404.
- **Layout.** `getAccountingState` suma `buyRead`, `buyWrite` y `purchasesOnly`; el layout deja pasar con
  `buyRead` y arma la barra con `audience="buyer"` (`buildAdmNav`: una sección, sin engranaje).
- **Navegación.** `AccountingGate` (`components/shell/nav-config.ts`) suma `buy` (la pestaña de Compras)
  y `buy_or_setup` (la entrada del menú). ⌘K usa `buy_read` / `buy_write` en las cinco entradas de compras.
- **Contexto de la sección.** `AccountingProvider` da `purchasesOnly`, `canOpen(accion)` y `readOnly`
  (que para este nivel es `false`: carga lo suyo). `canOpenAction` y `PURCHASE_ACTIONS` están en
  `acciones/types.ts`; `launcherItemsFor` en `nav/launcher-items.ts`.
- **Acciones del servidor.** Pasaron de `write` a `buy_write` (y de `read` a `buy_read`) solo las de este
  recorrido: `compras/_lib/sheet-actions.ts`, `runPostDocument` y `runPreviewDocument` para los cuatro
  formularios de compras (`accessNeedOfForm`, `PURCHASE_FORMS`), imputar (`allocateItems`), cuotas,
  adjuntos (preparar, registrar, abrir), el link de foto por QR, guardar proveedor y leer la foto con
  IA. Anular, deshacer, desimputar, reimputar, cambiar de sucursal, exportar, el plan de la semana, ARCA,
  el alta masiva y borrar un proveedor siguen en `write` / `read`. `authorizeAccounting` devuelve además
  `purchasesOnly`.
- **El contexto del motor.** Para este nivel, `purchasesOnlyContext` (`lib/accounting/context.ts`) deja
  las cajas en 0 y «sin tope» (el motor no inventa «la caja quedaría en negativo» con un saldo que no
  conoce) y apaga el impuesto al cheque automático (la base no le deja guardar un gasto bancario). Se
  aplica igual en `loadSheetData` (lo que arma la vista previa) y en `runPostDocument` (lo que guarda):
  el mismo bundle, el mismo hash. El aviso de caja en negativo que sí manda la base le llega sin
  importe y sale con su texto sin número.
- **Los saldos en pantalla.** Las cajas de las hojas llevan `balanceKnown: false`
  (`SheetTreasury`): `TreasurySelect` y las fichas de «¿Con qué pagaste?» muestran solo el nombre, y
  `treasuryAfter` no arma ningún «antes → después».
- **Lo que no se pide.** `getDocument(…, { provisionalNumber: false })` no busca el número provisorio
  del asiento (sale de `acc_report_journal`, del nivel completo): lo usan la ficha corta, el comprobante
  interno impreso y la nota de crédito. Con ese nivel tampoco se piden el origen de importación de la
  ficha ni la consulta guardada de ARCA del proveedor (la base se los daría vacíos).
- **Tex.** `whoIsTalking(…, purchasesOnly)` (`lib/tex/system-prompt.ts`) le cuenta a Tex que esa persona
  carga compras y pagos en la pantalla; `texSuggestions(…, { accounting })` no le ofrece lo de
  Administración a quien Tex no se la puede mostrar. El área de Administración de Tex sigue pidiendo
  `read`: no se abrió nada.

### Lo que hay que saber

- **El link de foto por QR** queda prendido para este nivel, probado el 23/11/2026: el celular (sin
  sesión) sube por la URL firmada que pidió la compu, el archivo queda a nombre de esa persona
  (`owner_id`) y la compu lo baja con su sesión. La política del bucket le deja leer y borrar solo lo
  que subió ella o lo ya adjunto a un comprobante que ve.
- **El aviso de caja en negativo** lo manda la base (sin importe) y «Guardar igual» anda: lo va a ver
  cuando pague de una caja que de verdad no alcanza, aunque en pantalla no vea saldos.
- **Un comprobante que no es suyo.** La base le deja leer la fila de un saldo inicial o de un asiento
  que mueve la cuenta de un proveedor (hace falta para que su cuenta corriente cierre); la ficha no se
  la abre.
- **El comprobante interno** de un gasto sin factura lo puede imprimir (`/print/comprobante-interno`).

### Recorrido en pantalla (23/11/2026, bar de ejemplo)

Con `qa.encargado+demoadm@studios-hub.test` («solo compras y pagos»), con guardados reales: un gasto
suelto con foto, una «Compra y pago» con la foto leída por IA, dos pagos a un proveedor con deuda (uno
de Mercado Pago, uno del banco sin impuesto al cheque), la foto por QR de punta a punta y un retiro de la
caja del salón cargado como compra, con un proveedor nuevo creado desde el formulario y «Guardar igual»
ante el aviso de caja en negativo. Abrió sus comprobantes y la cuenta corriente del proveedor; los saldos
de proveedores que ve son los mismos que ve el socio. Las pantallas cerradas, las hojas ajenas
(`?accion=`), ⌘K, el lanzador y Tex no le ofrecen nada fuera de Compras. Ninguna lectura de esas
pantallas le pega a una función que la base le rechaza. Subido a «Completo» por el socio ve todo;
bajado otra vez, vuelve a Compras.

## Pruebas

- `tests/lib/administracion-accesos-niveles.test.ts`: los niveles, el orden, lo que se ve mientras se
  guarda y las palabras.
- `tests/lib/administracion-puerta-render.test.tsx` › «Accesos por nivel»: qué se dibuja para quien da
  accesos y para quien no.
- `tests/lib/accounting-schemas.test.ts` › accesos: el esquema de la acción.
- `tests/rls/acc-levels.test.ts`: lo que la base deja ver y hacer a cada nivel (corre en el job `rls`).
- `tests/lib/accounting-levels.test.ts`: las puertas, las hojas, el menú, ⌘K, los saldos que no se
  muestran y el contexto recortado del motor para el nivel «solo compras y pagos».
- `tests/lib/accounting-document-actions.test.ts` › «quién guarda qué»: la puerta de cada formulario y
  que ese nivel guarda con el mismo contexto con que armó la vista previa.
- `tests/lib/administracion-nav.test.tsx` › «el nivel solo compras y pagos»: la barra de una sola fila,
  las solapas y «Cargar».
- `tests/lib/accounting-levels.test.ts` › «Tex con solo compras y pagos»: las sugerencias y lo que Tex
  sabe de esa persona.
- `tests/lib/administracion-resumen-render.test.tsx`: el Resumen manda a ese nivel a Compras.

## Recorrido a mano

Hecho el 23/11/2026 en el bar de ejemplo, con guardados reales (pasos 1 a 5, las vistas de solo lectura,
un guardado sin conexión y uno con la lista vieja). El paso 6 **no se vio en pantalla**: el bar de ejemplo
tiene tres personas que dan accesos y una es una cuenta real, que no se toca; ese estado lo cubren las
pruebas de render («al único que da accesos no se le puede…») y el mensaje de `last_admin` del catálogo.

Con un dueño que da accesos, en un bar con al menos un dueño sin acceso:

1. Ajustes › Accesos → «Dar acceso» a alguien → viene marcado «Solo compras y pagos» → «Dar acceso».
   Pasa a «Entran» con ese nivel; arriba aparece «… solo compras y pagos» y un medio punto.
2. En su fila, «También da accesos» está apagado. Tocar «Completo»: sube sin preguntar.
3. Prender «También da accesos»: el aviso dice «ahora también da accesos».
4. Tocar «Solo compras y pagos»: pregunta, y dice que también deja de dar accesos. Confirmar.
5. Entrar con esa persona: de Administración ve solo Compras y pagos.
6. Con un solo «da accesos» en el bar: su interruptor, su ficha «Solo compras y pagos» y su «Sacar
   acceso» están apagados, con la explicación abajo.
