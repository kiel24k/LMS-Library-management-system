import { ShieldCheckIcon, UsersIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/features/auth/use-auth"
import { RolesTab } from "@/features/roles/roles-tab"
import { AccountsTab } from "@/features/users/accounts-tab"
import { useUrlParam } from "@/hooks/use-url-search"
import type { Permission } from "@/lib/permissions"

const TABS: { value: "accounts" | "roles"; label: string; icon: typeof UsersIcon; perm: Permission }[] = [
  { value: "accounts", label: "Accounts", icon: UsersIcon, perm: "users.view" },
  { value: "roles", label: "Roles & permissions", icon: ShieldCheckIcon, perm: "roles.view" },
]

/**
 * /users — "Accounts" (users.view) and "Roles & permissions" (roles.view); ?tab=accounts|roles. Every sign-in
 * account is listed under Accounts, including the ones made when a borrower's request was accepted. The page itself
 * needs users.view or roles.view (router).
 */
export function UsersPage() {
  const { can } = useAuth()
  const tabs = TABS.filter((t) => can(t.perm))
  const [tabParam, setTab] = useUrlParam("tab")
  const tab = tabs.find((t) => t.value === tabParam)?.value ?? tabs[0]?.value

  return (
    <>
      <PageHeader title="Users" description="Who can sign in, and what each role is allowed to see and do." />
      {tabs.length > 1 && (
        <Tabs value={tab} onValueChange={(v) => setTab(v === tabs[0]?.value ? null : String(v), { resetPage: false })}>
          <TabsList>
            {tabs.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="px-2.5">
                <Icon />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {tab === "accounts" ? <AccountsTab /> : tab === "roles" ? <RolesTab /> : null}
    </>
  )
}
