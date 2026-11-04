import type { ComponentType } from "react"
import {
  BookMarkedIcon,
  BookOpenIcon,
  Building2Icon,
  BuildingIcon,
  HandHelpingIcon,
  LayoutDashboardIcon,
  UserCogIcon,
  UsersIcon,
} from "lucide-react"

import type { PermissionGate } from "@/features/auth/use-auth"

export type NavItem = {
  to: string
  label: string
  /** One line for the welcome page (shown when the user can't see the dashboard). */
  description: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
  badge?: "pending"
  /** Hidden unless the signed-in user has this (same gate as the route). */
  gate: PermissionGate
}

/** Sidebar menu, in order. Every item is gated by the permission its page needs. */
export const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    label: "Dashboard",
    description: "Today's numbers, overdue books and waiting requests.",
    icon: LayoutDashboardIcon,
    end: true,
    gate: { perm: "dashboard.view" },
  },
  {
    to: "/my-books",
    label: "My Books",
    description: "Books you borrowed and your requests.",
    icon: BookMarkedIcon,
    gate: { perm: "my_books.view" },
  },
  {
    to: "/borrow-records",
    label: "Borrow Records",
    description: "Who borrowed what, returns and requests from the public form.",
    icon: HandHelpingIcon,
    badge: "pending",
    gate: { perm: "loans.view" },
  },
  { to: "/books", label: "Books", description: "The book list, copies and pictures.", icon: BookOpenIcon, gate: { perm: "books.view" } },
  { to: "/borrowers", label: "Borrowers", description: "People who borrow books.", icon: UsersIcon, gate: { perm: "borrowers.view" } },
  {
    to: "/libraries",
    label: "Libraries",
    description: "Library details, groupings and the public borrow form.",
    icon: BuildingIcon,
    gate: { perm: "libraries.view" },
  },
  {
    to: "/users",
    label: "Users",
    description: "Accounts, roles and permissions.",
    icon: UserCogIcon,
    gate: { any: ["users.view", "roles.view"] },
  },
  {
    to: "/company-profile",
    label: "Company Profile",
    description: "Name, logo and contact details.",
    icon: Building2Icon,
    gate: { perm: "company.update" },
  },
]
