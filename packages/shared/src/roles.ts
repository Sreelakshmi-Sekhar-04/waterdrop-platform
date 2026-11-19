/** Roles a user can hold within one supplier (tenant). */
export const ROLES = ['customer', 'staff', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

/** Roles allowed to use the admin portal. `owner` can do everything `admin` can. */
export const ADMIN_ROLES: readonly Role[] = ['admin', 'owner'];

export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}
