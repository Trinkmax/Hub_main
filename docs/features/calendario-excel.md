# Cargar las fechas del calendario con un Excel (`/[bar]/eventos/programados/importar`)

Pedido de Nacho Badra (30/10/2026): cargar las fechas del mes subiendo un Excel en vez de una
por una. Sus palabras: «le mando el Excel, actualiza, se fija: si el lunes 14 era Coraline,
queda igual; si está cambiado, va otro».

## Qué hace

1. **Se sube el Excel** (`.xlsx` o CSV) desde Calendario → «Cargar con Excel». Lo abre
   `openTable` (`lib/imports/detect.ts`, el mismo lector de los importadores de
   Administración): Excel, CSV en cualquier codificación y con `;` o `,`.
2. **Se lee** (`readImportRows`, `lib/salon/calendar-import.ts`, puro y testeado):
   - las columnas se buscan por título en las primeras filas (Fecha, Película o Evento,
     Hora, Cupo; en cualquier orden, con o sin tildes). Sin fila de títulos, se adivinan
     por lo que tienen;
   - las fechas, como las escribe la gente: celda de fecha de Excel, «15/11»,
     «15/11/2026», «15 nov», «domingo 15 de noviembre», y varias en una celda separadas
     con `;`. Sin año: el de hoy, o el siguiente si el mes ya pasó;
   - **si dice el día de la semana y no coincide, no se adivina**: «Domingo 30 de
     noviembre» (de 2026, un lunes) queda como problema, con el porqué;
   - la película, por el nombre del formato del calendario **o** por su título en
     Entradas («Coraline» es el formato «Caroline»). Un nombre que no está se avisa y, si
     se parece a uno, se sugiere (nunca se elige solo);
   - sin hora o cupo, los de la última fecha de esa película (o el cupo del formato). Si
     no hay de dónde copiarlos, se pide que se escriban.
3. **Se compara** con el calendario (`planImport`): el Excel manda **en los meses que trae
   y solo para las películas que nombra**, de hoy en adelante. Lo que coincide queda
   igual; lo nuevo se agrega; si cambia la hora o el cupo, se cambia; lo que está en el
   calendario y no en el Excel se quita, salvo que tenga reservas activas (queda, y se
   avisa). El resto del calendario (otros formatos, otros meses) no se toca.
4. **Vista previa** antes de guardar: se agregan, cambian de película (un mismo día que
   pasa de una película a otra), cambian hora o cupo, se quitan, quedan por reservas,
   quedan igual y con problemas (con su fila). Un interruptor apaga el «quitar».
5. **Guardar** vuelve a leer el mismo archivo y arma el plan contra el calendario de ese
   momento (nunca aplica un plan viejo). Las nuevas entran todas juntas o ninguna; cada
   cambio queda en `audit_log` con `source: 'excel'`, el archivo y quién lo subió.

Subir el mismo Excel dos veces no cambia nada la segunda vez.

## Reglas

- Owner y anfitrión (`TEMPLATE_EDIT_ROLES`): los que arman la agenda. Escribe con la sesión
  de quien sube (RLS), igual que el calendario.
- Quitar sigue la regla de borrar una fecha a mano: no se quita una con reservas activas
  (ni una con pauta cargada en «Cómo nos fue»). La hora de una fecha con reservas tampoco
  se cambia desde el Excel: se mueve desde el calendario.
- Las fechas que ya pasaron no se cargan ni se quitan.
- Tope: archivos de hasta 2 MB y 2.000 filas.
- La plantilla («Bajar la plantilla») es un CSV para Excel (`;`, BOM) con ejemplos de las
  películas del bar; está testeado que se vuelve a subir tal cual.

## Probar

`tests/lib/salon-calendar-import.test.ts` cubre fechas, horas, cupos, nombres, columnas,
el plan y la plantilla. Smoke del 01/11/2026 en el bar de prueba (`demo-administracion`,
usuario `qa.owner+demoadm@studios-hub.test`) con un `.xlsx` real: 3 nuevas, 1 cambio de
película, 1 cambio de cupo, 1 igual y 2 problemas («Coralin» → «¿Quisiste decir
"Caroline"?» y «Domingo 8 de marzo», que es lunes); al guardar quedaron exactamente esas
fechas y la segunda subida dijo «No hay cambios para guardar».
