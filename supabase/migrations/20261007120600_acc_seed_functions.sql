-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #7
-- Funciones de siembra y de períodos (spec §C.1 internas, §C.2, §D)
-- ============================================================
-- Todas internas (esquema private, sin EXECUTE para nadie): las llaman las RPC
-- SECURITY DEFINER de las migraciones siguientes (acc_bootstrap, acc_post_bundle,
-- cierres), siempre bajo el advisory lock del bar.
--
--   · private.acc_seed_chart(tenant) → integer: el plan de cuentas estándar de §D
--     (164 cuentas: 48 grupos y 116 imputables, 88 con system_key) en orden de
--     nivel; el trigger acc_accounts_biu calcula nivel y camino y hereda el tipo.
--     Idempotente (on conflict (tenant_id, code) do nothing). Sin ids fijos.
--     El bloque entre los marcadores @acc-seed-chart lo parsea el test
--     accounting-system-keys.test.ts: una fila por línea, columnas
--     (code, name, type, normal_side, postable, system_key, requires_party,
--      purchase_selectable, description). Es exactamente STANDARD_CHART de
--     lib/accounting/chart.ts.
--   · private.acc_seed_defaults(tenant, payload) → jsonb: partícipes de sistema,
--     bancos como partícipes, medios de cobro (orden de Thinkeon) y puntos de
--     venta de §C.2. Idempotente por system_key / número de PV.
--   · private.acc_ensure_fiscal_year(tenant, fecha) → uuid: el ejercicio que
--     contiene la fecha, creándolo (con sus meses y períodos especiales) si hace
--     falta; nunca más allá de hoy + 31 días.
--   · private.acc_period_for(tenant, fecha, kind) → acc_periods.
--   · private.acc_next_doc_seq(tenant) → bigint: referencia interna correlativa.
-- ============================================================

-- ─── 1. Plan de cuentas estándar (§D) ───────────────────────────────────────
create function private.acc_seed_chart(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level int;
  v_n int;
  v_total int := 0;
begin
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Por nivel: cada hija encuentra a su madre ya insertada (código sin el último segmento).
  for v_level in 1..4 loop
    insert into public.acc_accounts (tenant_id, code, name, type, normal_side, parent_id, postable, system_key,
                                     requires_party, purchase_selectable, manual_selectable, description)
    select p_tenant, c.code, c.name, c.type::public.acc_account_type, c.normal_side::public.acc_side,
           case when v_level = 1 then null
                else (select pa.id from public.acc_accounts pa
                       where pa.tenant_id = p_tenant and pa.code = regexp_replace(c.code, '\.[0-9]+$', '')) end,
           c.postable, c.system_key, c.requires_party, c.purchase_selectable, true, c.description
      from (values
        -- @acc-seed-chart:begin (code, name, type, normal_side, postable, system_key, requires_party, purchase_selectable, description)
        ('1', 'ACTIVO', 'asset', 'debit', false, null, false, false, null),
        ('1.1', 'Activo corriente', 'asset', 'debit', false, null, false, false, null),
        ('1.1.01', 'Caja y bancos', 'asset', 'debit', false, null, false, false, 'Cada caja, cuenta bancaria y billetera tiene acá su cuenta'),
        ('1.1.02', 'Créditos por ventas', 'asset', 'debit', false, null, false, false, null),
        ('1.1.02.01', 'Deudores por ventas', 'asset', 'debit', true, 'receivable_customers', true, false, 'Lo que te deben empresas y clientes con cuenta corriente'),
        ('1.1.02.02', 'Tarjetas de débito a cobrar', 'asset', 'debit', true, 'receivable_debit_cards', true, false, 'Ventas con débito que el procesador todavía no acreditó'),
        ('1.1.02.03', 'Tarjetas de crédito a cobrar', 'asset', 'debit', true, 'receivable_credit_cards', true, false, 'Ventas con crédito que el procesador todavía no acreditó'),
        ('1.1.02.04', 'Mercado Pago a acreditar', 'asset', 'debit', true, 'receivable_wallets', true, false, 'QR y transferencias vendidos que todavía no registraste como acreditados («Ajustar saldo» de Mercado Pago)'),
        ('1.1.02.05', 'Plataformas de delivery a cobrar', 'asset', 'debit', true, 'receivable_platforms', true, false, 'Lo que te deben PedidosYa, Rappi y las demás; si una liquidación da negativo, acá queda lo que les debés'),
        ('1.1.02.09', 'Previsión para deudores incobrables (regularizadora)', 'asset', 'credit', true, 'bad_debt_allowance', false, false, 'Ajuste de la contadora por cobros dudosos'),
        ('1.1.03', 'Créditos fiscales', 'asset', 'debit', false, null, false, false, null),
        ('1.1.03.01', 'IVA crédito fiscal', 'asset', 'debit', true, 'vat_credit', false, false, 'El IVA de las facturas A que te hacen los responsables inscriptos: se descuenta del IVA que cobrás'),
        ('1.1.03.02', 'IVA crédito fiscal a documentar', 'asset', 'debit', true, 'vat_credit_pending', true, false, 'IVA de comisiones ya descontadas (Mercado Pago, plataformas) cuya factura mensual todavía no llegó'),
        ('1.1.03.03', 'IVA saldo técnico a favor', 'asset', 'debit', true, 'vat_technical_balance', false, false, 'Cuando en un mes compraste más IVA del que vendiste; se usa en los meses siguientes'),
        ('1.1.03.04', 'IVA saldo de libre disponibilidad', 'asset', 'debit', true, 'vat_free_balance', false, false, 'Percepciones y retenciones de IVA que sobraron; sirven para pagar IVA u otros impuestos'),
        ('1.1.03.05', 'Percepciones de IVA sufridas', 'asset', 'debit', true, 'vat_perceptions', false, false, 'IVA extra que te cobró un proveedor en la factura; se descuenta en la liquidación del mes'),
        ('1.1.03.06', 'Retenciones de IVA sufridas', 'asset', 'debit', true, 'vat_withholdings', false, false, 'IVA que te retuvo un cliente o un procesador al pagarte, con certificado'),
        ('1.1.03.07', 'Percepciones de IIBB sufridas', 'asset', 'debit', true, 'iibb_perceptions', false, false, 'Ingresos Brutos que te cobró un proveedor en la factura'),
        ('1.1.03.08', 'Retenciones de IIBB sufridas (tarjetas y plataformas)', 'asset', 'debit', true, 'iibb_withholdings', false, false, 'Ingresos Brutos que te retienen al acreditar tarjetas, plataformas o clientes'),
        ('1.1.03.09', 'Recaudaciones IIBB SIRCREB (bancos)', 'asset', 'debit', true, 'iibb_sircreb', false, false, 'Lo que el banco descuenta de Ingresos Brutos sobre los créditos de la cuenta'),
        ('1.1.03.10', 'Recaudaciones IIBB SIRCUPA (billeteras)', 'asset', 'debit', true, 'iibb_sircupa', false, false, 'Lo que Mercado Pago descuenta de Ingresos Brutos sobre lo que entra'),
        ('1.1.03.11', 'IIBB saldo a favor', 'asset', 'debit', true, 'iibb_balance', false, false, 'Lo que sobró de la declaración de Ingresos Brutos'),
        ('1.1.03.12', 'Retenciones de Ganancias sufridas', 'asset', 'debit', true, 'income_tax_withholdings', false, false, 'Ganancias que te retienen al cobrar, con certificado'),
        ('1.1.03.13', 'Percepciones de Ganancias sufridas', 'asset', 'debit', true, 'income_tax_perceptions', false, false, 'Ganancias que te cobra un proveedor en la factura'),
        ('1.1.03.14', 'Anticipos de Ganancias', 'asset', 'debit', true, 'income_tax_advances', false, false, 'Anticipos de Ganancias pagados'),
        ('1.1.03.15', 'Impuesto ley 25.413 computable en Ganancias', 'asset', 'debit', true, 'bank_tax_credit', false, false, 'La parte del impuesto al cheque que se descuenta de Ganancias (33 % por defecto)'),
        ('1.1.04', 'Otros créditos', 'asset', 'debit', false, null, false, false, null),
        ('1.1.04.01', 'Anticipos a proveedores', 'asset', 'debit', true, 'supplier_advances', false, false, 'La contadora reclasifica acá los pagos a cuenta al cierre del ejercicio'),
        ('1.1.04.02', 'Gastos pagados por adelantado', 'asset', 'debit', true, 'prepaid_expenses', false, true, 'Seguros o alquileres pagados por varios meses'),
        ('1.1.04.03', 'Fondos a rendir', 'asset', 'debit', true, null, false, false, 'Plata entregada a alguien que después rinde con comprobantes'),
        ('1.1.04.04', 'Préstamos al personal', 'asset', 'debit', true, null, false, false, 'Adelantos o préstamos a empleados'),
        ('1.1.04.05', 'Diferencias de cobro a conciliar', 'asset', 'debit', true, 'reconciliation_differences', false, false, 'Lo que no se explica al ajustar el saldo de Mercado Pago o de un banco; la contadora lo reclasifica'),
        ('1.1.05', 'Bienes de cambio', 'asset', 'debit', false, null, false, false, null),
        ('1.1.05.01', 'Mercaderías (existencia)', 'asset', 'debit', true, 'inventory', false, false, 'Existencia al cierre (la carga la contadora hasta el Sprint de Stock)'),
        ('1.2', 'Activo no corriente', 'asset', 'debit', false, null, false, false, null),
        ('1.2.01', 'Bienes de uso', 'asset', 'debit', false, null, false, false, null),
        ('1.2.01.01', 'Instalaciones', 'asset', 'debit', true, null, false, true, 'Obras e instalaciones del local'),
        ('1.2.01.02', 'Muebles y útiles', 'asset', 'debit', true, null, false, true, 'Mesas, sillas, vajilla que dura años'),
        ('1.2.01.03', 'Equipamiento de cocina y barra', 'asset', 'debit', true, null, false, true, 'Hornos, heladeras, cafeteras'),
        ('1.2.01.04', 'Equipos de computación', 'asset', 'debit', true, null, false, true, 'Computadoras, tablets, impresoras'),
        ('1.2.01.05', 'Rodados', 'asset', 'debit', true, null, false, true, 'Vehículos'),
        ('1.2.01.06', 'Mejoras en inmuebles de terceros', 'asset', 'debit', true, null, false, true, 'Reformas en el local alquilado'),
        ('1.2.01.09', 'Amortización acumulada de bienes de uso (regularizadora)', 'asset', 'credit', true, 'accumulated_depreciation', false, false, 'La carga la contadora al cierre'),
        ('1.2.02', 'Activos intangibles', 'asset', 'debit', false, null, false, false, null),
        ('1.2.02.01', 'Software y licencias', 'asset', 'debit', true, null, false, true, 'Licencias que duran más de un año'),
        ('1.2.02.02', 'Gastos de organización', 'asset', 'debit', true, null, false, true, 'Gastos de constitución de la SAS'),
        ('1.2.02.09', 'Amortización acumulada de intangibles (regularizadora)', 'asset', 'credit', true, null, false, false, 'La carga la contadora al cierre'),
        ('1.2.03', 'Otros activos no corrientes', 'asset', 'debit', false, null, false, false, null),
        ('1.2.03.01', 'Depósitos en garantía', 'asset', 'debit', true, null, false, false, 'Depósito del alquiler'),
        ('2', 'PASIVO', 'liability', 'credit', false, null, false, false, null),
        ('2.1', 'Pasivo corriente', 'liability', 'credit', false, null, false, false, null),
        ('2.1.01', 'Deudas comerciales', 'liability', 'credit', false, null, false, false, null),
        ('2.1.01.01', 'Proveedores', 'liability', 'credit', true, 'payable_suppliers', true, false, 'Lo que les debés a los proveedores, factura por factura'),
        ('2.1.02', 'Deudas fiscales', 'liability', 'credit', false, null, false, false, null),
        ('2.1.02.01', 'IVA débito fiscal', 'liability', 'credit', true, 'vat_debit', false, false, 'El IVA de lo que facturaste'),
        ('2.1.02.02', 'IVA a pagar', 'liability', 'credit', true, 'vat_payable', true, false, 'Lo que da la liquidación mensual del IVA, hasta que se paga'),
        ('2.1.02.03', 'IIBB a pagar', 'liability', 'credit', true, 'iibb_payable', true, false, 'La declaración de Ingresos Brutos del mes, hasta que se paga'),
        ('2.1.02.04', 'Tasa municipal a pagar', 'liability', 'credit', true, 'municipal_payable', true, false, 'Tasa de comercio e industria'),
        ('2.1.02.05', 'Ganancias a pagar', 'liability', 'credit', true, 'income_tax_payable', true, false, 'Declaración y anticipos de Ganancias'),
        ('2.1.02.06', 'Otros impuestos a pagar', 'liability', 'credit', true, 'other_taxes_payable', true, false, 'Planes de pago y otros tributos'),
        ('2.1.03', 'Deudas sociales', 'liability', 'credit', false, null, false, false, null),
        ('2.1.03.01', 'Sueldos a pagar', 'liability', 'credit', true, 'payroll_payable', true, false, 'Sueldos netos liquidados que todavía no se pagaron'),
        ('2.1.03.02', 'Cargas sociales a pagar (F.931)', 'liability', 'credit', true, 'social_security_payable', true, false, 'Aportes y contribuciones del F.931'),
        ('2.1.03.03', 'Sindicato y obra social a pagar', 'liability', 'credit', true, 'union_payable', true, false, 'Cuotas sindicales y de obra social retenidas'),
        ('2.1.03.04', 'Provisión SAC y vacaciones', 'liability', 'credit', true, 'payroll_provisions', false, false, 'La carga la contadora'),
        ('2.1.04', 'Otras deudas', 'liability', 'credit', false, null, false, false, null),
        ('2.1.04.01', 'Anticipos de clientes (señas)', 'liability', 'credit', true, 'customer_deposits', true, false, 'Señas y anticipos cobrados antes de la venta'),
        ('2.1.04.02', 'Cuentas particulares de socios', 'liability', 'credit', true, 'partners_current', true, false, 'Retiros y aportes de cada socio'),
        ('2.1.04.03', 'Acreedores varios', 'liability', 'credit', true, 'other_payables', true, false, 'Otras deudas con un acreedor identificado'),
        ('2.1.05', 'Deudas financieras', 'liability', 'credit', false, null, false, false, null),
        ('2.1.05.01', 'Préstamos bancarios', 'liability', 'credit', true, 'bank_loans', false, false, 'Préstamos del banco a menos de un año'),
        ('2.1.05.02', 'Préstamos de socios', 'liability', 'credit', true, 'partner_loans', true, false, 'Plata que un socio le prestó a la SAS'),
        ('2.2', 'Pasivo no corriente', 'liability', 'credit', false, null, false, false, null),
        ('2.2.01', 'Deudas financieras a largo plazo', 'liability', 'credit', false, null, false, false, null),
        ('2.2.01.01', 'Préstamos bancarios a largo plazo', 'liability', 'credit', true, null, false, false, 'Cuotas a más de un año'),
        ('3', 'PATRIMONIO NETO', 'equity', 'credit', false, null, false, false, null),
        ('3.1', 'Aportes de los socios', 'equity', 'credit', false, null, false, false, null),
        ('3.1.01', 'Capital', 'equity', 'credit', false, null, false, false, null),
        ('3.1.01.01', 'Capital social', 'equity', 'credit', true, 'share_capital', false, false, 'El capital del estatuto'),
        ('3.1.01.02', 'Socios: capital a integrar (regularizadora)', 'equity', 'debit', true, 'capital_receivable', false, false, 'Capital suscripto que los socios todavía no pusieron'),
        ('3.1.01.03', 'Aportes irrevocables', 'equity', 'credit', true, 'irrevocable_contributions', false, false, 'Aportes a cuenta de futuras suscripciones'),
        ('3.2', 'Resultados', 'equity', 'credit', false, null, false, false, null),
        ('3.2.01', 'Resultados acumulados', 'equity', 'credit', false, null, false, false, null),
        ('3.2.01.01', 'Resultados no asignados', 'equity', 'credit', true, 'retained_earnings', false, false, 'Ganancias o pérdidas de ejercicios anteriores'),
        ('3.2.01.02', 'Resultado del ejercicio', 'equity', 'credit', true, 'current_year_result', false, false, 'Lo deja la refundición al cerrar el ejercicio'),
        ('3.2.01.03', 'Reserva legal', 'equity', 'credit', true, 'legal_reserve', false, false, 'La define la asamblea'),
        ('3.2.01.04', 'Saldo de apertura a asignar', 'equity', 'credit', true, 'opening_equity', false, false, 'La diferencia del asiento de apertura; la contadora la pasa a capital o resultados'),
        ('4', 'INGRESOS', 'income', 'credit', false, null, false, false, null),
        ('4.1', 'Ventas', 'income', 'credit', false, null, false, false, null),
        ('4.1.01', 'Ventas del salón', 'income', 'credit', false, null, false, false, null),
        ('4.1.01.01', 'Ventas salón: facturadas', 'income', 'credit', true, 'sales_salon_invoiced', false, false, 'Neto de lo facturado en el salón (concilia con el Libro IVA ventas)'),
        ('4.1.01.02', 'Ventas salón: sin factura', 'income', 'credit', true, 'sales_salon_uninvoiced', false, false, 'Lo vendido en el salón que no se facturó (sin IVA débito)'),
        ('4.1.02', 'Ventas de delivery', 'income', 'credit', false, null, false, false, null),
        ('4.1.02.01', 'Ventas delivery: facturadas', 'income', 'credit', true, 'sales_delivery_invoiced', false, false, 'Neto de lo facturado por delivery'),
        ('4.1.02.02', 'Ventas delivery: sin factura', 'income', 'credit', true, 'sales_delivery_uninvoiced', false, false, 'Lo vendido por delivery que no se facturó'),
        ('4.1.03', 'Ventas de eventos y empresas', 'income', 'credit', false, null, false, false, null),
        ('4.1.03.01', 'Ventas eventos: facturadas', 'income', 'credit', true, 'sales_events_invoiced', false, false, 'Eventos y empresas facturados'),
        ('4.1.03.02', 'Ventas eventos: sin factura', 'income', 'credit', true, 'sales_events_uninvoiced', false, false, 'Eventos que no se facturaron'),
        ('4.2', 'Otros ingresos', 'income', 'credit', false, null, false, false, null),
        ('4.2.01', 'Otros ingresos', 'income', 'credit', false, null, false, false, null),
        ('4.2.01.01', 'Sobrantes de caja', 'income', 'credit', true, 'cash_over', false, false, 'Cuando al contar la caja hay más de lo que dice el sistema'),
        ('4.2.01.02', 'Intereses y rendimientos', 'income', 'credit', true, 'interest_income', false, false, 'Rendimientos de Mercado Pago, plazos fijos'),
        ('4.2.01.03', 'Descuentos obtenidos', 'income', 'credit', true, 'discounts_obtained', false, false, 'Bonificaciones y diferencias chicas a favor al pagar'),
        ('4.2.01.04', 'Ingresos varios', 'income', 'credit', true, 'other_income', false, false, 'Ingresos que no son ventas'),
        ('5', 'EGRESOS', 'expense', 'debit', false, null, false, false, null),
        ('5.1', 'Costo de ventas', 'expense', 'debit', false, null, false, false, null),
        ('5.1.01', 'Compras de mercadería', 'expense', 'debit', false, null, false, false, null),
        ('5.1.01.01', 'Compras: alimentos', 'expense', 'debit', true, 'purchases_food', false, true, 'Carne, verdura, almacén'),
        ('5.1.01.02', 'Compras: bebidas sin alcohol', 'expense', 'debit', true, 'purchases_soft_drinks', false, true, 'Gaseosas, aguas, jugos'),
        ('5.1.01.03', 'Compras: bebidas con alcohol', 'expense', 'debit', true, 'purchases_alcohol', false, true, 'Cervezas, vinos, bebidas blancas'),
        ('5.1.01.04', 'Compras: café e infusiones', 'expense', 'debit', true, 'purchases_coffee', false, true, 'Café, té, yerba'),
        ('5.1.01.05', 'Compras: panadería y pastelería', 'expense', 'debit', true, 'purchases_bakery', false, true, 'Panes, facturas, tortas compradas'),
        ('5.1.01.06', 'Compras: descartables y packaging', 'expense', 'debit', true, 'purchases_packaging', false, true, 'Vasos, envases, bolsas de delivery'),
        ('5.1.01.07', 'Compras: otros insumos', 'expense', 'debit', true, 'purchases_other', false, true, 'Hielo y otros insumos de cocina y barra'),
        ('5.1.01.09', 'Variación de existencias', 'expense', 'debit', true, 'inventory_variation', false, false, 'La carga la contadora al cierre'),
        ('5.2', 'Gastos de comercialización', 'expense', 'debit', false, null, false, false, null),
        ('5.2.01', 'Comisiones y costos de cobro', 'expense', 'debit', false, null, false, false, null),
        ('5.2.01.01', 'Comisiones de tarjetas', 'expense', 'debit', true, 'fees_cards', false, false, 'Aranceles de débito y crédito'),
        ('5.2.01.02', 'Comisiones de Mercado Pago', 'expense', 'debit', true, 'fees_wallets', false, false, 'Comisión de QR y otras de Mercado Pago'),
        ('5.2.01.03', 'Comisiones de plataformas de delivery', 'expense', 'debit', true, 'fees_platforms', false, false, 'Comisión de PedidosYa, Rappi y las demás'),
        ('5.2.01.04', 'Costo financiero y otros cargos de cobro', 'expense', 'debit', true, 'fees_other', false, true, 'Cargos de cobro que no son comisión'),
        ('5.2.02', 'Publicidad', 'expense', 'debit', false, null, false, false, null),
        ('5.2.02.01', 'Publicidad en redes (Meta, Google)', 'expense', 'debit', true, 'advertising_online', false, true, 'Pauta en redes, en pesos'),
        ('5.2.02.02', 'Otra publicidad y promociones', 'expense', 'debit', true, 'advertising_other', false, true, 'Volantes, cartelería, promociones'),
        ('5.2.03', 'Impuestos sobre las ventas', 'expense', 'debit', false, null, false, false, null),
        ('5.2.03.01', 'Impuesto sobre los Ingresos Brutos', 'expense', 'debit', true, 'iibb_expense', false, true, 'La declaración mensual de IIBB'),
        ('5.2.03.02', 'Tasa de comercio e industria', 'expense', 'debit', true, 'municipal_tax_expense', false, true, 'La tasa municipal'),
        ('5.3', 'Gastos de administración y operación', 'expense', 'debit', false, null, false, false, null),
        ('5.3.01', 'Personal', 'expense', 'debit', false, null, false, false, null),
        ('5.3.01.01', 'Sueldos y jornales', 'expense', 'debit', true, 'salaries', false, false, 'Sueldos brutos (asiento mensual de la contadora)'),
        ('5.3.01.02', 'Contribuciones patronales', 'expense', 'debit', true, 'employer_contributions', false, false, 'Las cargas a cargo de la SAS'),
        ('5.3.01.03', 'ART y seguro de vida obligatorio', 'expense', 'debit', true, null, false, true, 'Seguro de riesgos del trabajo'),
        ('5.3.01.04', 'Personal eventual y extras', 'expense', 'debit', true, null, false, true, 'Extras de eventos, changas'),
        ('5.3.02', 'Local y servicios', 'expense', 'debit', false, null, false, false, null),
        ('5.3.02.01', 'Alquiler', 'expense', 'debit', true, null, false, true, 'El alquiler del local'),
        ('5.3.02.02', 'Expensas', 'expense', 'debit', true, null, false, true, 'Expensas del local'),
        ('5.3.02.03', 'Energía eléctrica', 'expense', 'debit', true, null, false, true, 'Luz (EPEC)'),
        ('5.3.02.04', 'Gas', 'expense', 'debit', true, null, false, true, 'Gas natural o envasado'),
        ('5.3.02.05', 'Agua', 'expense', 'debit', true, null, false, true, 'Agua'),
        ('5.3.02.06', 'Internet y telefonía', 'expense', 'debit', true, null, false, true, 'Internet, celulares'),
        ('5.3.02.07', 'Mantenimiento y reparaciones', 'expense', 'debit', true, 'maintenance', false, true, 'Plomero, electricista, arreglos'),
        ('5.3.02.08', 'Limpieza e higiene', 'expense', 'debit', true, 'cleaning', false, true, 'Artículos de limpieza, fumigación'),
        ('5.3.02.09', 'Seguros', 'expense', 'debit', true, null, false, true, 'Seguro del local'),
        ('5.3.02.10', 'Seguridad y monitoreo', 'expense', 'debit', true, null, false, true, 'Alarma, vigilancia'),
        ('5.3.02.11', 'Música y derechos (SADAIC, AADI-CAPIF)', 'expense', 'debit', true, null, false, true, 'Derechos de música'),
        ('5.3.03', 'Administración', 'expense', 'debit', false, null, false, false, null),
        ('5.3.03.01', 'Honorarios profesionales', 'expense', 'debit', true, null, false, true, 'Contadora, abogados, diseño'),
        ('5.3.03.02', 'Software y suscripciones', 'expense', 'debit', true, null, false, true, 'Thinkeon, HUB, apps'),
        ('5.3.03.03', 'Librería y papelería', 'expense', 'debit', true, null, false, true, 'Papel, rollos de ticketera'),
        ('5.3.03.04', 'Gastos bancarios', 'expense', 'debit', true, 'bank_fees', false, true, 'Mantenimiento de cuenta y comisiones del banco'),
        ('5.3.03.05', 'Faltantes de caja', 'expense', 'debit', true, 'cash_short', false, false, 'Cuando al contar la caja hay menos de lo que dice el sistema'),
        ('5.3.03.06', 'Movilidad, fletes y envíos', 'expense', 'debit', true, null, false, true, 'Taxis, fletes, cadetería'),
        ('5.3.03.07', 'Amortizaciones', 'expense', 'debit', true, 'depreciation', false, false, 'La carga la contadora al cierre'),
        ('5.3.03.08', 'Gastos varios', 'expense', 'debit', true, 'misc_expenses', false, true, 'Lo que no entra en otra cuenta'),
        ('5.3.04', 'Impuestos y tasas', 'expense', 'debit', false, null, false, false, null),
        ('5.3.04.01', 'Impuesto sobre débitos y créditos bancarios', 'expense', 'debit', true, 'bank_tax_expense', false, false, 'La parte del impuesto al cheque que no se computa en Ganancias'),
        ('5.3.04.02', 'Otros impuestos y tasas', 'expense', 'debit', true, 'other_taxes_expense', false, true, 'Percepciones municipales y otros tributos'),
        ('5.3.04.03', 'Intereses y multas fiscales', 'expense', 'debit', true, 'tax_penalties', false, true, 'Recargos por pagar tarde'),
        ('5.4', 'Resultados financieros', 'expense', 'debit', false, null, false, false, null),
        ('5.4.01', 'Gastos financieros', 'expense', 'debit', false, null, false, false, null),
        ('5.4.01.01', 'Intereses pagados', 'expense', 'debit', true, 'interest_expense', false, true, 'Intereses de préstamos y tarjetas'),
        ('5.5', 'Impuesto a las ganancias', 'expense', 'debit', false, null, false, false, null),
        ('5.5.01', 'Impuesto a las ganancias', 'expense', 'debit', false, null, false, false, null),
        ('5.5.01.01', 'Impuesto a las ganancias', 'expense', 'debit', true, 'income_tax_expense', false, false, 'El impuesto del ejercicio (lo carga la contadora)')
        -- @acc-seed-chart:end
      ) as c(code, name, type, normal_side, postable, system_key, requires_party, purchase_selectable, description)
     where array_length(string_to_array(c.code, '.'), 1) = v_level
     order by c.code
    on conflict (tenant_id, code) do nothing;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

comment on function private.acc_seed_chart(uuid) is
  'Siembra el plan de cuentas estándar (§D) en orden de nivel. Idempotente por (tenant_id, code). Devuelve cuántas cuentas insertó.';

-- ─── 2. Partícipes, medios de cobro y puntos de venta (§C.2) ────────────────
-- p_payload = {
--   "actor_id": uuid|null,                       -- created_by/updated_by
--   "treasuries": [ {"key", "id", "create_bank_party"?, "bank_name"?}, … ],   -- cajas YA creadas, en el orden del asistente
--   "sales": { "transfer_destination", "transfer_deducts_iibb", "enabled_methods", "enabled_platforms",
--              "rates": {<system_key del partícipe>: {commission_bp, iibb_withholding_bp, vat_withholding_bp,
--                                                     income_tax_withholding_bp, sircupa_bp}},
--              "sales_points": [ {"number", "label", "default_channel"} ] } }
-- Requiere el plan sembrado (resuelve las cuentas por system_key).
create function private.acc_seed_defaults(p_tenant uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_sales jsonb := coalesce(p_payload -> 'sales', '{}'::jsonb);
  v_rates jsonb := coalesce(p_payload -> 'sales' -> 'rates', '{}'::jsonb);
  v_actor uuid := nullif(p_payload ->> 'actor_id', '')::uuid;
  v_methods text[];
  v_platforms text[];
  v_acc jsonb;
  v_party jsonb;
  v_missing text;
  v_tr record;
  v_cash uuid;
  v_wallet uuid;
  v_bank uuid;
  v_transfer uuid;
  v_transfer_kind text;
  v_transfer_method text;
  v_qr uuid;
  v_bank_party uuid;
  v_n_bank int := 0;
  v_n_parties int;
  v_n_methods int;
  v_n_points int;
begin
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_methods := case when jsonb_typeof(v_sales -> 'enabled_methods') = 'array'
                    then array(select jsonb_array_elements_text(v_sales -> 'enabled_methods'))
                    else array['cash', 'transfer', 'qr_mp', 'debit', 'credit', 'customer_account'] end;
  v_platforms := case when jsonb_typeof(v_sales -> 'enabled_platforms') = 'array'
                      then array(select jsonb_array_elements_text(v_sales -> 'enabled_platforms'))
                      else array[]::text[] end;

  -- Cuentas de control por system_key (el plan tiene que estar sembrado).
  select jsonb_object_agg(a.system_key, a.id) into v_acc
    from public.acc_accounts a
   where a.tenant_id = p_tenant
     and a.system_key in ('payable_suppliers', 'receivable_customers', 'receivable_wallets', 'receivable_debit_cards',
                          'receivable_credit_cards', 'receivable_platforms', 'vat_payable', 'social_security_payable',
                          'iibb_payable', 'municipal_payable', 'payroll_payable', 'union_payable', 'customer_deposits');
  select k into v_missing
    from unnest(array['payable_suppliers', 'receivable_customers', 'receivable_wallets', 'receivable_debit_cards',
                      'receivable_credit_cards', 'receivable_platforms', 'vat_payable', 'social_security_payable',
                      'iibb_payable', 'municipal_payable', 'payroll_payable', 'union_payable', 'customer_deposits']) as k
   where not (coalesce(v_acc, '{}'::jsonb) ? k)
   limit 1;
  if v_missing is not null then
    raise exception 'account_not_found' using errcode = 'P0001', detail = v_missing;
  end if;

  -- 2.1 Partícipes de sistema (sin CUIT: la pantalla lo pide antes de que entren a un libro IVA).
  insert into public.acc_parties (tenant_id, kind, name, payable_account_id, receivable_account_id, commission_vat_mode,
                                  commission_bp, iibb_withholding_bp, vat_withholding_bp, income_tax_withholding_bp,
                                  sircupa_bp, active, system_key, created_by, updated_by)
  select p_tenant, x.kind, x.name, (v_acc ->> x.payable_key)::uuid, (v_acc ->> x.receivable_key)::uuid, x.vat_mode,
         ((v_rates -> x.key ->> 'commission_bp')::numeric)::int,
         ((v_rates -> x.key ->> 'iibb_withholding_bp')::numeric)::int,
         ((v_rates -> x.key ->> 'vat_withholding_bp')::numeric)::int,
         ((v_rates -> x.key ->> 'income_tax_withholding_bp')::numeric)::int,
         ((v_rates -> x.key ->> 'sircupa_bp')::numeric)::int,
         case when x.kind = 'delivery_platform' then (x.key = any (v_platforms) or x.key = any (v_methods))
              else x.active end,
         x.key, v_actor, v_actor
    from (values
      ('varios',        'supplier',          'Proveedores varios',               'payable_suppliers',       'receivable_customers',    'none',            true),
      ('mercado_pago',  'payment_wallet',    'Mercado Pago',                     'payable_suppliers',       'receivable_wallets',      'monthly_invoice', true),
      ('posnet_debito', 'card_processor',    'Tarjetas de débito (Posnet)',      'payable_suppliers',       'receivable_debit_cards',  'per_settlement',  true),
      ('posnet_credito','card_processor',    'Tarjetas de crédito (Posnet)',     'payable_suppliers',       'receivable_credit_cards', 'per_settlement',  true),
      ('pedidosya',     'delivery_platform', 'PedidosYa',                        'payable_suppliers',       'receivable_platforms',    'monthly_invoice', false),
      ('rappi',         'delivery_platform', 'Rappi',                            'payable_suppliers',       'receivable_platforms',    'monthly_invoice', false),
      ('uber_eats',     'delivery_platform', 'Uber Eats',                        'payable_suppliers',       'receivable_platforms',    'monthly_invoice', false),
      ('mp_delivery',   'delivery_platform', 'Mercado Pago Delivery',            'payable_suppliers',       'receivable_platforms',    'monthly_invoice', false),
      ('pedix',         'delivery_platform', 'Pedix',                            'payable_suppliers',       'receivable_platforms',    'monthly_invoice', false),
      ('arca',          'tax_agency',        'ARCA (ex AFIP)',                   'vat_payable',             'receivable_customers',    'none',            true),
      ('arca_ss',       'tax_agency',        'ARCA · seguridad social (F.931)',  'social_security_payable', 'receivable_customers',    'none',            true),
      ('rentas',        'tax_agency',        'Rentas de Córdoba (IIBB)',         'iibb_payable',            'receivable_customers',    'none',            true),
      ('municipalidad', 'tax_agency',        'Municipalidad (tasa de comercio)', 'municipal_payable',       'receivable_customers',    'none',            true),
      ('personal',      'payroll',           'Personal (sueldos)',               'payroll_payable',         'receivable_customers',    'none',            true),
      ('sindicato',     'other',             'Sindicato y obra social',          'union_payable',           'receivable_customers',    'none',            true),
      ('senas',         'customer',          'Señas de clientes',                'customer_deposits',       'customer_deposits',       'none',            false)
    ) as x(key, kind, name, payable_key, receivable_key, vat_mode, active)
  on conflict (tenant_id, system_key) where system_key is not null do nothing;

  select jsonb_object_agg(p.system_key, p.id) into v_party
    from public.acc_parties p
   where p.tenant_id = p_tenant and p.system_key is not null;

  -- 2.2 Cajas que ya creó el asistente: destinos de los medios y bancos como partícipes.
  for v_tr in
    select e.value as item, e.ordinality as ord, t.id, t.kind, t.name, t.bank_name, t.bank_party_id
      from jsonb_array_elements(coalesce(v_payload -> 'treasuries', '[]'::jsonb)) with ordinality as e(value, ordinality)
      left join public.acc_treasury_accounts t
        on t.id = nullif(e.value ->> 'id', '')::uuid and t.tenant_id = p_tenant
     order by e.ordinality
  loop
    if v_tr.id is null then
      raise exception 'invalid_method_targets' using errcode = 'P0001',
        detail = coalesce(v_tr.item ->> 'key', 'treasury');
    end if;
    if v_tr.kind = 'cash' and v_cash is null then v_cash := v_tr.id; end if;
    if v_tr.kind = 'wallet' and v_wallet is null then v_wallet := v_tr.id; end if;
    if v_tr.kind = 'bank' and v_bank is null then v_bank := v_tr.id; end if;
    if (v_tr.item ->> 'key') is not null and (v_tr.item ->> 'key') = (v_sales ->> 'transfer_destination') then
      v_transfer := v_tr.id;
      v_transfer_kind := v_tr.kind;
    end if;
    -- Uno por banco con create_bank_party (IVA de comisiones y acreditaciones del banco).
    if coalesce((v_tr.item ->> 'create_bank_party')::boolean, false) and v_tr.bank_party_id is null then
      insert into public.acc_parties (tenant_id, kind, name, payable_account_id, receivable_account_id,
                                      commission_vat_mode, active, created_by, updated_by)
      values (p_tenant, 'bank',
              left(coalesce(nullif(btrim(v_tr.item ->> 'bank_name'), ''), nullif(btrim(v_tr.bank_name), ''), v_tr.name), 120),
              (v_acc ->> 'payable_suppliers')::uuid, (v_acc ->> 'receivable_customers')::uuid,
              'per_settlement', true, v_actor, v_actor)
      returning id into v_bank_party;
      update public.acc_treasury_accounts set bank_party_id = v_bank_party where id = v_tr.id;
      v_n_bank := v_n_bank + 1;
    end if;
  end loop;

  -- Transferencias: al destino elegido (si no, la primera billetera; si no, el primer banco). Quedan
  -- «a acreditar» (settled_now) si van a una billetera que descuenta IIBB; si no, entran enteras.
  if v_transfer is null then
    if v_wallet is not null then
      v_transfer := v_wallet; v_transfer_kind := 'wallet';
    elsif v_bank is not null then
      v_transfer := v_bank; v_transfer_kind := 'bank';
    end if;
  end if;
  v_transfer_method := case when v_transfer_kind = 'wallet'
                                 and coalesce((v_sales ->> 'transfer_deducts_iibb')::boolean, true)
                            then 'settled_now' else 'treasury' end;
  -- QR de Mercado Pago: la billetera de las transferencias o, si no, la primera billetera.
  v_qr := case when v_transfer_kind = 'wallet' then v_transfer else v_wallet end;

  if 'cash' = any (v_methods) and v_cash is null then
    raise exception 'cash_required' using errcode = 'P0001';
  end if;
  if 'transfer' = any (v_methods) and v_transfer is null then
    raise exception 'invalid_method_targets' using errcode = 'P0001', detail = 'transfer';
  end if;
  if 'qr_mp' = any (v_methods) and v_qr is null then
    raise exception 'invalid_method_targets' using errcode = 'P0001', detail = 'qr_mp';
  end if;

  -- La billetera que recibe QR y transferencias tiene a Mercado Pago como partícipe (comisiones y acreditaciones).
  update public.acc_treasury_accounts t
     set bank_party_id = (v_party ->> 'mercado_pago')::uuid
   where t.tenant_id = p_tenant and t.kind = 'wallet' and t.bank_party_id is null
     and t.id in (v_qr, case when v_transfer_method = 'settled_now' then v_transfer end);

  -- 2.3 Medios de cobro, en el orden del cierre de Thinkeon (se reordenan arrastrando). Se crean todos los
  -- que tienen destino; activos los elegidos en el asistente (la seña aplicada nace apagada: decisión 5).
  with defs (key, name, channel, days, sort) as (
    values
      ('cash',             'Efectivo',              'salon',    0,  10),
      ('transfer',         'Transferencia',         'salon',    0,  20),
      ('qr_mp',            'QR Mercado Pago',       'salon',    0,  30),
      ('debit',            'Débito',                'salon',    1,  40),
      ('credit',           'Crédito',               'salon',    10, 50),
      ('pedidosya',        'PedidosYa',             'delivery', 14, 60),
      ('rappi',            'Rappi',                 'delivery', 14, 70),
      ('uber_eats',        'Uber Eats',             'delivery', 14, 80),
      ('mp_delivery',      'Mercado Pago Delivery', 'delivery', 14, 90),
      ('pedix',            'Pedix',                 'delivery', 14, 100),
      ('customer_account', 'Cuenta corriente',      'events',   0,  110),
      ('deposit_applied',  'Seña aplicada',         'salon',    0,  120)
  ),
  mrows as (
    select d.key, d.name, d.channel, d.days, d.sort,
           case d.key
             when 'cash' then 'treasury'
             when 'transfer' then v_transfer_method
             when 'qr_mp' then 'settled_now'
             when 'customer_account' then 'customer_account'
             when 'deposit_applied' then 'advance'
             else 'receivable' end as kind,
           case d.key when 'cash' then v_cash when 'transfer' then v_transfer when 'qr_mp' then v_qr end as treasury_id,
           case d.key
             when 'cash' then null::uuid
             when 'customer_account' then null::uuid
             when 'transfer' then case when v_transfer_method = 'settled_now' then (v_party ->> 'mercado_pago')::uuid end
             when 'qr_mp' then (v_party ->> 'mercado_pago')::uuid
             when 'debit' then (v_party ->> 'posnet_debito')::uuid
             when 'credit' then (v_party ->> 'posnet_credito')::uuid
             when 'deposit_applied' then (v_party ->> 'senas')::uuid
             else (v_party ->> d.key)::uuid end as party_id,
           case when d.key = 'deposit_applied' then false
                when d.channel = 'delivery' then (d.key = any (v_platforms) or d.key = any (v_methods))
                else d.key = any (v_methods) end as active
      from defs d
  )
  insert into public.acc_sales_methods (tenant_id, name, kind, channel, treasury_account_id, party_id, settlement_days,
                                        sort, active, system_key, created_by, updated_by)
  select p_tenant, m.name, m.kind, m.channel, m.treasury_id, m.party_id, m.days, m.sort, m.active, m.key, v_actor, v_actor
    from mrows m
   where (m.kind in ('treasury', 'settled_now') and m.treasury_id is not null)
      or (m.kind in ('receivable', 'advance') and m.party_id is not null)
      or m.kind = 'customer_account'
  on conflict (tenant_id, system_key) where system_key is not null do nothing;

  -- 2.4 Puntos de venta.
  if exists (select 1 from jsonb_array_elements(coalesce(v_sales -> 'sales_points', '[]'::jsonb)) e
              group by (e.value ->> 'number') having count(*) > 1) then
    raise exception 'sales_point_taken' using errcode = 'P0001';
  end if;
  insert into public.acc_sales_points (tenant_id, number, label, default_channel)
  select p_tenant, (e.value ->> 'number')::int,
         left(coalesce(nullif(btrim(e.value ->> 'label'), ''), 'Punto de venta ' || (e.value ->> 'number')), 60),
         coalesce(nullif(e.value ->> 'default_channel', ''), 'salon')
    from jsonb_array_elements(coalesce(v_sales -> 'sales_points', '[]'::jsonb)) e
  on conflict (tenant_id, number) do nothing;

  select count(*) into v_n_parties from public.acc_parties p where p.tenant_id = p_tenant;
  select count(*) into v_n_methods from public.acc_sales_methods m where m.tenant_id = p_tenant;
  select count(*) into v_n_points from public.acc_sales_points s where s.tenant_id = p_tenant;
  return jsonb_build_object('parties', v_n_parties, 'sales_methods', v_n_methods, 'sales_points', v_n_points,
                            'bank_parties_created', v_n_bank);
end;
$$;

comment on function private.acc_seed_defaults(uuid, jsonb) is
  'Siembra partícipes de sistema, bancos como partícipes, medios de cobro y puntos de venta (§C.2). Idempotente. Requiere el plan de cuentas.';

-- ─── 3. Ejercicios y períodos ───────────────────────────────────────────────
-- El ejercicio que contiene la fecha; si no existe, crea el que corresponde (el primero: de
-- books_start_date al último día del fiscal_year_end_month siguiente o igual; los demás contiguos,
-- de 12 meses) con sus meses (starts_on = greatest(month, start_date)), su período fy_adjustments
-- (fecha = end_date) y, desde el segundo, su período fy_opening (fecha = start_date). Nunca crea
-- ejercicios para fechas más allá de hoy + 31 días (period_not_found).
create function private.acc_ensure_fiscal_year(p_tenant uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.acc_settings;
  v_fy public.acc_fiscal_years;
  v_last public.acc_fiscal_years;
  v_start date;
  v_end date;
  v_month date;
  v_guard int := 0;
begin
  if p_date is null then
    raise exception 'period_not_found' using errcode = 'P0001';
  end if;
  select * into v_set from public.acc_settings s where s.tenant_id = p_tenant;
  if not found then
    raise exception 'not_set_up' using errcode = 'P0001';
  end if;

  select * into v_fy from public.acc_fiscal_years f
   where f.tenant_id = p_tenant and p_date between f.start_date and f.end_date;
  if found then
    return v_fy.id;
  end if;

  if p_date < v_set.books_start_date then
    raise exception 'date_before_start' using errcode = 'P0001', detail = v_set.books_start_date::text;
  end if;
  if p_date > public.acc_today(p_tenant) + 31 then
    raise exception 'period_not_found' using errcode = 'P0001', detail = p_date::text;
  end if;

  loop
    v_guard := v_guard + 1;
    if v_guard > 24 then
      raise exception 'period_not_found' using errcode = 'P0001', detail = p_date::text;
    end if;
    select * into v_last from public.acc_fiscal_years f
     where f.tenant_id = p_tenant order by f.end_date desc limit 1;
    if not found then
      v_start := v_set.books_start_date;
      v_end := (make_date(extract(year from v_start)::int
                            + case when extract(month from v_start)::int > v_set.fiscal_year_end_month then 1 else 0 end,
                          v_set.fiscal_year_end_month, 1)
                + interval '1 month' - interval '1 day')::date;
    else
      if p_date < v_last.start_date then
        -- Antes del primer ejercicio pero después del inicio de los libros: no corresponde a ninguno.
        raise exception 'period_not_found' using errcode = 'P0001', detail = p_date::text;
      end if;
      v_start := v_last.end_date + 1;
      v_end := (v_start + interval '12 months' - interval '1 day')::date;
    end if;

    insert into public.acc_fiscal_years (tenant_id, start_date, end_date)
    values (p_tenant, v_start, v_end)
    returning * into v_fy;

    v_month := v_start - (extract(day from v_start)::int - 1);
    while v_month <= v_end loop
      insert into public.acc_periods (tenant_id, fiscal_year_id, kind, month, starts_on, ends_on)
      values (p_tenant, v_fy.id, 'month', v_month, greatest(v_month, v_start),
              (v_month + interval '1 month' - interval '1 day')::date);
      v_month := (v_month + interval '1 month')::date;
    end loop;
    insert into public.acc_periods (tenant_id, fiscal_year_id, kind, month, starts_on, ends_on)
    values (p_tenant, v_fy.id, 'fy_adjustments', v_end - (extract(day from v_end)::int - 1), v_end, v_end);
    if v_last.id is not null then
      insert into public.acc_periods (tenant_id, fiscal_year_id, kind, month, starts_on, ends_on)
      values (p_tenant, v_fy.id, 'fy_opening', v_start - (extract(day from v_start)::int - 1), v_start, v_start);
    end if;

    if p_date between v_fy.start_date and v_fy.end_date then
      return v_fy.id;
    end if;
  end loop;
end;
$$;

comment on function private.acc_ensure_fiscal_year(uuid, date) is
  'Devuelve el ejercicio que contiene la fecha, creándolo con sus meses y períodos especiales si hace falta (nunca para fechas > hoy + 31 días).';

-- El período que corresponde: el mes que contiene la fecha (kind = month) o el especial
-- (fy_adjustments / fy_opening) del ejercicio que la contiene. No crea nada (period_not_found).
create function private.acc_period_for(p_tenant uuid, p_date date, p_kind text default 'month')
returns public.acc_periods
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.acc_periods;
begin
  if p_kind = 'month' then
    select * into v from public.acc_periods p
     where p.tenant_id = p_tenant and p.kind = 'month' and p_date between p.starts_on and p.ends_on;
  elsif p_kind in ('fy_adjustments', 'fy_opening') then
    select p.* into v from public.acc_periods p
      join public.acc_fiscal_years f on f.id = p.fiscal_year_id and f.tenant_id = p.tenant_id
     where p.tenant_id = p_tenant and p.kind = p_kind and p_date between f.start_date and f.end_date;
  end if;
  if v.id is null then
    raise exception 'period_not_found' using errcode = 'P0001', detail = coalesce(p_date::text, '');
  end if;
  return v;
end;
$$;

comment on function private.acc_period_for(uuid, date, text) is
  'Resuelve el período de una fecha: el mes, o el período especial (fy_adjustments / fy_opening) de su ejercicio. period_not_found si no existe.';

-- Referencia interna correlativa (#124). Bajo el lock del bar; sin huecos porque se deshace con la transacción.
create function private.acc_next_doc_seq(p_tenant uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  update public.acc_settings s set doc_seq = s.doc_seq + 1
   where s.tenant_id = p_tenant
   returning s.doc_seq into v;
  if v is null then
    raise exception 'not_set_up' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

comment on function private.acc_next_doc_seq(uuid) is
  'Siguiente referencia interna de comprobante (acc_settings.doc_seq + 1). Llamar bajo el advisory lock del bar.';

-- ─── 4. Grants ───────────────────────────────────────────────────────────────
revoke all on function private.acc_seed_chart(uuid) from public, anon, authenticated;
revoke all on function private.acc_seed_defaults(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.acc_ensure_fiscal_year(uuid, date) from public, anon, authenticated;
revoke all on function private.acc_period_for(uuid, date, text) from public, anon, authenticated;
revoke all on function private.acc_next_doc_seq(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
