export class TenantAccessError extends Error {
  readonly code = 'tenant_access_denied'
  constructor(message = 'No tenés acceso a este bar.') {
    super(message)
    this.name = 'TenantAccessError'
  }
}

export class TenantNotFoundError extends Error {
  readonly code = 'tenant_not_found'
  constructor(message = 'Bar no encontrado.') {
    super(message)
    this.name = 'TenantNotFoundError'
  }
}

export class RoleRequiredError extends Error {
  readonly code = 'role_required'
  constructor(message = 'Tu rol no permite esta acción.') {
    super(message)
    this.name = 'RoleRequiredError'
  }
}

export class UnauthenticatedError extends Error {
  readonly code = 'unauthenticated'
  constructor(message = 'Necesitás iniciar sesión.') {
    super(message)
    this.name = 'UnauthenticatedError'
  }
}
