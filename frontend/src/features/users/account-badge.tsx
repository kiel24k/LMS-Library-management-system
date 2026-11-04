import { Badge } from "@/components/ui/badge"

/** The account is still on the default password (it is asked to change it when it signs in). */
export function MustChangePasswordBadge() {
  return (
    <Badge
      className="bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
      title="Still on the default password; asked to change it at the next sign-in."
    >
      Must change password
    </Badge>
  )
}
