import { useMemo } from "react"
import { useSearchParams } from "react-router"
import { PlusIcon, ShieldIcon, ShieldPlusIcon, UsersIcon } from "lucide-react"
import { cn } from "cn"

import { Can } from "@/components/can"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/features/auth/use-auth"
import { usePermissionCatalog, useRoles } from "@/features/roles/api"
import { DefaultRoleBadge, DefaultRoleCard } from "@/features/roles/default-role"
import { buildCatalogIndex } from "@/features/roles/permission-graph"
import { LEAVE_WITHOUT_ASKING, RoleEditor } from "@/features/roles/role-editor"
import { useMakeDefaultRole } from "@/features/roles/use-make-default-role"

const NEW = "new"

/**
 * "Roles & permissions" tab of the Users page (roles.view): the default role for new accounts on top, then the role
 * list on the left and the editor on the right.
 */
export function RolesTab() {
  const { can, user: me } = useAuth()
  const roles = useRoles({ enabled: can("roles.view") })
  const catalog = usePermissionCatalog()
  const index = useMemo(() => (catalog.data ? buildCatalogIndex(catalog.data) : null), [catalog.data])
  const makeDefault = useMakeDefaultRole()
  // ?role=<id> (or ?role=new) keeps the selection on reload and makes Back work.
  const [searchParams, setSearchParams] = useSearchParams()
  const roleParam = searchParams.get("role")
  /** `afterSave`: our own navigation after create / delete — replaces the entry and skips the unsaved-changes question. */
  const select = (id: string | null, afterSave = false) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set("role", id)
        else next.delete("role")
        return next
      },
      { replace: afterSave, state: afterSave ? { [LEAVE_WITHOUT_ASKING]: true } : undefined },
    )

  if (roles.isPending || catalog.isPending) return <PageSkeleton />
  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
  if (catalog.isError || !index) return <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />

  const creating = roleParam === NEW && can("roles.create")
  const selected = creating ? null : (roles.data.find((r) => r.id === roleParam) ?? roles.data[0] ?? null)
  const defaultRole = roles.data.find((r) => r.isDefault) ?? null

  return (
    <>
      <DefaultRoleCard
        roles={roles.data}
        defaultRole={defaultRole}
        onChange={makeDefault.request}
        pending={makeDefault.pending}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card size="sm" className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <Can perm="roles.create">
              <CardAction>
                <Button size="sm" variant="outline" onClick={() => select(NEW)} disabled={creating}>
                  <PlusIcon data-icon="inline-start" />
                  New role
                </Button>
              </CardAction>
            </Can>
          </CardHeader>
          <CardContent className="px-2">
            <nav aria-label="Roles">
              <ul className="flex flex-col gap-0.5">
                {creating && (
                  <li>
                    <div
                      aria-current="true"
                      className="flex items-center gap-2.5 rounded-lg bg-primary/10 px-2.5 py-2 text-sm font-medium text-primary"
                    >
                      <ShieldPlusIcon className="size-4 shrink-0" />
                      New role
                    </div>
                  </li>
                )}
                {roles.data.map((r) => {
                  const active = !creating && r.id === selected?.id
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        // Re-clicking the role already open (also the implicit first one, without ?role=) does nothing:
                        // it would only change the URL and ask about unsaved changes without discarding them.
                        onClick={() => !active && select(r.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                          active && "bg-muted",
                        )}
                      >
                        <ShieldIcon className={cn("mt-0.5 size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{r.name}</span>
                            {r.isDefault && <DefaultRoleBadge />}
                            {me?.role.id === r.id && (
                              <Badge variant="outline" className="h-4 px-1.5 text-[0.65rem]">
                                You
                              </Badge>
                            )}
                          </span>
                          <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <UsersIcon className="size-3" />
                              {r.userCount} {r.userCount === 1 ? "account" : "accounts"}
                            </span>
                            <span>
                              {r.permissions.length} {r.permissions.length === 1 ? "permission" : "permissions"}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>
          </CardContent>
        </Card>

        {creating || selected ? (
          <RoleEditor
            key={creating ? NEW : selected!.id}
            role={creating ? null : selected}
            index={index}
            defaultRole={defaultRole}
            onMakeDefault={makeDefault.request}
            makingDefault={makeDefault.pending}
            onCreated={(role) => select(role.id, true)}
            onDeleted={() => select(null, true)}
          />
        ) : (
          <EmptyState icon={<ShieldIcon />} title="No roles yet" description="Create a role to choose what people can see and do." />
        )}
      </div>
      {makeDefault.dialog}
    </>
  )
}
