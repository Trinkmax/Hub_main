'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { emailSchema, passwordSchema } from '@/lib/auth/schemas'
import { sendEmail } from '@/lib/email/send'
import { renderCredentialsEmail } from '@/lib/email/templates/credentials'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  canManageAccountant,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { TENANT_ROLES, type TenantRole } from '@/lib/tenant/types'

const idSchema = z.object({ id: z.string().uuid() })
const updateRoleSchema = idSchema.extend({
  role: z.enum(TENANT_ROLES as [TenantRole, ...TenantRole[]]),
})
const createMemberSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(TENANT_ROLES as [TenantRole, ...TenantRole[]]),
  full_name: z
    .string()
    .trim()
    .max(80)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export type CreateMemberState =
  | {
      ok: true
      created: 'new' | 'existing'
      email: string
      role: TenantRole
      emailSent?: boolean
    }
  | { ok: false; message: string; field?: 'email' | 'password' | 'role' | 'full_name' }

export type ActionState = { ok: true; message?: string } | { ok: false; message: string }

// Guardias de Administración (spec B.5.4). La base tiene sus triggers
// (accountant_requires_acc_admin, protected_accounting_member), pero el cliente
// de servicio (alta con contraseña, cambio de contraseña) los saltea: por eso
// se chequea acá ANTES de tocar nada con él.
const ACCOUNTANT_ADMIN_ONLY =
  'Solo quien administra los accesos de Administración puede sumar o cambiar a la contadora.'
const PROTECTED_MEMBER =
  'Esta persona tiene acceso a Administración: solo quien administra los accesos puede cambiarle el rol o sacarla del equipo.'
const PROTECTED_PASSWORD =
  'Esta persona tiene acceso a Administración: solo quien administra los accesos puede cambiarle la contraseña.'

/** Errores de los triggers de gobierno de Administración → texto para el dueño. */
function accountingGuardMessage(error: { message?: string } | null): string | null {
  const message = error?.message ?? ''
  if (message.includes('accountant_requires_acc_admin')) return ACCOUNTANT_ADMIN_ONLY
  if (message.includes('protected_accounting_member')) return PROTECTED_MEMBER
  return null
}

async function authorizeOwner(slug: string): Promise<TenantAccess | null> {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])
    return access
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

// ──────────────────────────────────────────────────────────
// Crear miembro con contraseña directa
//   - Si el email ya tiene cuenta: reusa y solo crea la membership
//     (no le toca la contraseña existente).
//   - Si no existe: crea cuenta confirmada y agrega membership.
// ──────────────────────────────────────────────────────────
export async function createMemberWithPassword(
  slug: string,
  _prev: CreateMemberState | { ok: false; message: '' } | null,
  formData: FormData,
): Promise<CreateMemberState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const tenant = access.tenant

  const parsed = createMemberSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
    full_name: formData.get('full_name'),
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path[0] as CreateMemberState extends { field?: infer F } ? F : never
    return { ok: false, message: issue?.message ?? 'Datos inválidos', field }
  }

  // La contadora solo la suma quien administra los accesos (B.5.4): el alta usa
  // el cliente de servicio, que el trigger de la base no frena.
  if (parsed.data.role === 'accountant' && !canManageAccountant(access.accounting)) {
    return { ok: false, field: 'role', message: ACCOUNTANT_ADMIN_ONLY }
  }

  const service = createServiceClient()

  // 1. Buscar usuario por email (security definer).
  const { data: existingId, error: findErr } = await service.rpc('find_user_id_by_email', {
    p_email: parsed.data.email,
  })
  if (findErr) {
    console.error('[equipo.create] find_user_id_by_email', findErr)
    return { ok: false, message: 'No pudimos verificar el email. Probá de nuevo.' }
  }

  let userId: string
  let createdNew = false

  if (existingId) {
    userId = existingId
  } else {
    // 2a. Crear el usuario con email confirmado y password.
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: parsed.data.full_name ? { full_name: parsed.data.full_name } : {},
    })
    if (createErr || !created.user) {
      const msg = createErr?.message ?? ''
      if (/already.*registered|exists/i.test(msg)) {
        // Carrera: alguien lo creó entre el find y el createUser.
        const { data: refoundId } = await service.rpc('find_user_id_by_email', {
          p_email: parsed.data.email,
        })
        if (!refoundId) {
          return { ok: false, message: 'El email ya estaba en uso.', field: 'email' }
        }
        userId = refoundId
      } else {
        console.error('[equipo.create] admin.createUser', createErr)
        return { ok: false, message: 'No pudimos crear la cuenta. Probá de nuevo.' }
      }
    } else {
      userId = created.user.id
      createdNew = true
    }
  }

  // 3. Insertar membership. Nunca upsert: si la persona ya es parte del equipo
  //    no se le pisa el rol en silencio (y con el cliente de servicio ningún
  //    trigger frenaría bajar de rol a quien tiene acceso a Administración).
  const { error: memErr } = await service
    .from('memberships')
    .insert({ tenant_id: tenant.id, user_id: userId, role: parsed.data.role })
  if (memErr?.code === '23505') {
    return {
      ok: false,
      field: 'email',
      message: 'Esa persona ya es parte del equipo. Cambiale el rol desde la lista.',
    }
  }
  if (memErr) {
    console.error('[equipo.create] memberships insert', memErr.code, memErr.message)
    return { ok: false, message: 'No pudimos asignar el rol al miembro.' }
  }

  // 4. Mandar credenciales por email solo si la cuenta es nueva. Si ya existía
  //    no pisamos su contraseña, así que no tiene sentido mandarle credenciales.
  let emailSent = false
  if (createdNew) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const { subject, html, text } = await renderCredentialsEmail({
      tenantName: tenant.name,
      fullName: parsed.data.full_name ?? null,
      email: parsed.data.email,
      password: parsed.data.password,
      role: parsed.data.role,
      loginUrl: `${appUrl}/login`,
    })
    const emailResult = await sendEmail({
      to: parsed.data.email,
      subject,
      html,
      text,
      tag: 'team_credentials',
    })
    emailSent = emailResult.ok
    if (!emailResult.ok) {
      console.warn('[equipo.create] email no enviado:', emailResult.reason, emailResult.error)
    }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: access.user.id,
    action: createdNew ? 'membership.created_with_password' : 'membership.granted_existing_user',
    entity: 'membership',
    payload: {
      target_user_id: userId,
      role: parsed.data.role,
      email_sent: emailSent,
    },
  })

  revalidatePath(`/${slug}/configuracion/equipo`)
  return {
    ok: true,
    created: createdNew ? 'new' : 'existing',
    email: parsed.data.email,
    role: parsed.data.role,
    emailSent,
  }
}

// ──────────────────────────────────────────────────────────
// Actualizar rol de un miembro (sin permitir dejar al bar sin owners)
// ──────────────────────────────────────────────────────────
export async function updateMemberRole(
  slug: string,
  membershipId: string,
  role: TenantRole,
): Promise<ActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const tenant = access.tenant

  const parsed = updateRoleSchema.safeParse({ id: membershipId, role })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()

  const { data: target } = await supabase
    .from('memberships')
    .select('user_id, role')
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!target) return { ok: false, message: 'No existe.' }

  // Contabilidad: pasar a alguien a ese rol exige el módulo prendido y ser
  // administrador; sacarlo de ese rol, ser administrador (gobierno, B.5.3).
  if (parsed.data.role === 'accountant' && !canManageAccountant(access.accounting)) {
    return { ok: false, message: ACCOUNTANT_ADMIN_ONLY }
  }
  if (target.role === 'accountant' && !access.accounting.admin) {
    return { ok: false, message: ACCOUNTANT_ADMIN_ONLY }
  }

  if (parsed.data.role !== 'owner' && target.role === 'owner') {
    const { count } = await supabase
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('role', 'owner')
    if ((count ?? 0) <= 1) {
      return { ok: false, message: 'No podés dejar al bar sin owners.' }
    }
  }

  const { error } = await supabase
    .from('memberships')
    .update({ role: parsed.data.role })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)

  if (error) {
    const guard = accountingGuardMessage(error)
    if (guard) return { ok: false, message: guard }
    return { ok: false, message: 'No pudimos actualizar.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: access.user.id,
    action: 'membership.role_updated',
    entity: 'membership',
    entityId: parsed.data.id,
    payload: { role: parsed.data.role, target_user_id: target.user_id },
  })

  revalidatePath(`/${slug}/configuracion/equipo`)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// Remover miembro del bar (solo borra membership, no borra la cuenta auth)
// ──────────────────────────────────────────────────────────
export async function removeMember(slug: string, membershipId: string): Promise<ActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const tenant = access.tenant

  const parsed = idSchema.safeParse({ id: membershipId })
  if (!parsed.success) return { ok: false, message: 'Inválido.' }

  const supabase = await createClient()

  const { data: target } = await supabase
    .from('memberships')
    .select('user_id, role')
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!target) return { ok: false, message: 'No existe.' }
  if (target.user_id === access.user.id) {
    return { ok: false, message: 'No te podés remover a vos mismo.' }
  }
  if (target.role === 'owner') {
    const { count } = await supabase
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('role', 'owner')
    if ((count ?? 0) <= 1) {
      return { ok: false, message: 'No podés dejar al bar sin owners.' }
    }
  }

  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)

  if (error) {
    const guard = accountingGuardMessage(error)
    if (guard) return { ok: false, message: guard }
    return { ok: false, message: 'No pudimos remover.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: access.user.id,
    action: 'membership.removed',
    entity: 'membership',
    entityId: parsed.data.id,
    payload: { target_user_id: target.user_id },
  })

  revalidatePath(`/${slug}/configuracion/equipo`)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// Resetear contraseña de un miembro (genera link efímero)
//   El owner lo copia y se lo pasa al miembro por WhatsApp / SMS.
// ──────────────────────────────────────────────────────────
export async function setMemberPassword(
  slug: string,
  membershipId: string,
  newPassword: string,
): Promise<ActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const tenant = access.tenant

  const parsedId = idSchema.safeParse({ id: membershipId })
  if (!parsedId.success) return { ok: false, message: 'Inválido.' }
  const parsedPwd = passwordSchema.safeParse(newPassword)
  if (!parsedPwd.success) {
    return { ok: false, message: parsedPwd.error.issues[0]?.message ?? 'Contraseña inválida' }
  }

  const supabase = await createClient()
  const { data: target } = await supabase
    .from('memberships')
    .select('user_id')
    .eq('id', parsedId.data.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!target) return { ok: false, message: 'No existe.' }

  // Cambiarle la contraseña a alguien es poder entrar como esa persona: a quien
  // tiene acceso a Administración (o es la contadora) solo se la cambia un
  // administrador. Se pregunta con el cliente DEL USUARIO (la función exige que
  // quien llama sea dueño del bar) y, si no se puede saber, no se cambia.
  const { data: isProtected, error: protectedErr } = await supabase.rpc('acc_member_is_protected', {
    p_tenant_id: tenant.id,
    p_user_id: target.user_id,
  })
  if (protectedErr) {
    console.error('[equipo.setPassword] acc_member_is_protected', protectedErr.code)
    return { ok: false, message: 'No pudimos verificar los permisos. Probá de nuevo.' }
  }
  if (isProtected === true && !access.accounting.admin && target.user_id !== access.user.id) {
    return { ok: false, message: PROTECTED_PASSWORD }
  }

  const service = createServiceClient()
  const { error } = await service.auth.admin.updateUserById(target.user_id, {
    password: parsedPwd.data,
  })
  if (error) {
    console.error('[equipo.setPassword]', error.code ?? error.status, error.message)
    return { ok: false, message: 'No pudimos actualizar la contraseña.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: access.user.id,
    action: 'membership.password_reset',
    entity: 'membership',
    entityId: parsedId.data.id,
    payload: { target_user_id: target.user_id },
  })

  revalidatePath(`/${slug}/configuracion/equipo`)
  return { ok: true, message: 'Contraseña actualizada.' }
}
