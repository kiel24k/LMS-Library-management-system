import { StarIcon, UserPlusIcon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuth } from "@/features/auth/use-auth"
import { canGrantRole } from "@/features/roles/permission-graph"
import type { RoleDetail } from "@/types/api"

export const DEFAULT_ROLE_HINT = "New accounts get this role, including the ones made when a borrower's request is accepted"

/** Small "Default" badge (role list); hovering it explains what it means. */
export function DefaultRoleBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="secondary"
            className={cn("h-4 bg-primary/10 px-1.5 text-[0.65rem] text-primary dark:bg-primary/20", className)}
          />
        }
      >
        <StarIcon data-icon="inline-start" className="fill-current" />
        Default
      </TooltipTrigger>
      <TooltipContent>{DEFAULT_ROLE_HINT}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Top of the "Roles & permissions" tab: which role new accounts get. A picker with roles.update (roles holding
 * permissions the signed-in user lacks are listed but disabled), plain text otherwise.
 */
export function DefaultRoleCard({
  roles,
  defaultRole,
  onChange,
  pending,
}: {
  roles: RoleDetail[]
  defaultRole: RoleDetail | null
  /** Asks for confirmation (see useMakeDefaultRole). */
  onChange: (role: RoleDetail) => void
  pending?: boolean
}) {
  const { can } = useAuth()
  const editable = can("roles.update")
  const items = roles.map((r) => ({ value: r.id, label: r.name }))

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-primary/20">
            <UserPlusIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p id="default-role-label" className="text-sm font-medium">
              Default role for new accounts
            </p>
            <p className="text-sm text-muted-foreground">
              {defaultRole
                ? "Added accounts get this role unless another one is picked, and so do the accounts made when a borrower's request is accepted."
                : "No default role is set, so a role has to be picked for every new account, and accepting a borrower's request creates no account."}
            </p>
          </div>
        </div>
        {editable ? (
          <Select
            items={items}
            value={defaultRole?.id ?? null}
            onValueChange={(v) => {
              const role = roles.find((r) => r.id === v)
              if (role && role.id !== defaultRole?.id) onChange(role)
            }}
            disabled={pending}
          >
            <SelectTrigger aria-labelledby="default-role-label" className="w-full sm:w-64">
              <SelectValue placeholder="Choose a default role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => {
                const grantable = canGrantRole(r, can)
                return (
                  <SelectItem key={r.id} value={r.id} disabled={!grantable && r.id !== defaultRole?.id}>
                    <span className="flex min-w-0 flex-col">
                      <span>{r.name}</span>
                      {!grantable && (
                        <span className="text-xs text-muted-foreground">Has permissions you don't have</span>
                      )}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        ) : defaultRole ? (
          <Badge variant="secondary" className="h-7 self-start px-3 text-sm sm:self-auto">
            <StarIcon data-icon="inline-start" className="fill-current text-primary" />
            {defaultRole.name}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">None set</span>
        )}
      </CardContent>
    </Card>
  )
}
