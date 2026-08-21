import type { User, UserPermissions } from "@prisma/client";

export type UserWithPerms = User & { permissions: UserPermissions | null };

/**
 * Parents implicitly have every permission.
 * Children default to the permissions record; if absent, deny-by-default for edits and allow-by-default for reads.
 */
export function can(
  user: UserWithPerms,
  key: keyof UserPermissions
): boolean {
  if (user.role === "PARENT") return true;
  if (!user.permissions) {
    // Conservative defaults for kids without a permissions record
    const readKeys: (keyof UserPermissions)[] = [
      "canViewCalendar",
      "canViewTodos",
      "canViewShopping",
      "canViewMenu",
      "canViewRecipes",
      "canViewRewards",
      "canViewPhotos",
      "canViewReminders",
      "canEditReminders",
      "canViewMaintenance",
    ];
    return readKeys.includes(key);
  }
  const v = user.permissions[key];
  return Boolean(v);
}

export function featurePermissionKeys(): (keyof UserPermissions)[] {
  return [
    "canViewCalendar",
    "canEditCalendar",
    "canViewTodos",
    "canEditTodos",
    "canViewShopping",
    "canEditShopping",
    "canManageUsers",
    "canViewMenu",
    "canEditMenu",
    "canViewRecipes",
    "canEditRecipes",
    "canViewRewards",
    "canManageRewards",
    "canViewPhotos",
    "canManagePhotos",
    "canViewReminders",
    "canEditReminders",
    "canViewMaintenance",
    "canManageMaintenance",
    // v4.8.1 — parent's personal opt-in to receive a copy of every event
    // reminder that fires on any child user.
    "notifyOnChildEventReminders",
  ];
}

export const permissionLabels: Record<string, string> = {
  canViewCalendar: "View calendar",
  canEditCalendar: "Add / edit calendar events",
  canViewTodos: "View to-do lists",
  canEditTodos: "Add / edit to-dos",
  canViewShopping: "View shopping list",
  canEditShopping: "Add / edit shopping list",
  canManageUsers: "Manage family members (parents only)",
  canViewMenu: "View menu planner",
  canEditMenu: "Edit menu planner",
  canViewRecipes: "View recipes",
  canEditRecipes: "Edit recipes",
  canViewRewards: "View rewards",
  canManageRewards: "Manage rewards",
  canViewPhotos: "View photo screensaver",
  canManagePhotos: "Upload / remove photos",
  canViewReminders: "See reminders",
  canEditReminders: "Create / edit reminders",
  canViewMaintenance: "View maintenance log",
  canManageMaintenance: "Manage maintenance (parents only)",
  notifyOnChildEventReminders:
    "Also notify me when my children have event reminders",
};
