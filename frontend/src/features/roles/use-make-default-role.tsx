import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { useUpdateRole } from "@/features/roles/api"
import { errorMessage } from "@/lib/api"
import type { RoleDetail } from "@/types/api"

/**
 * "Make <role> the default role?" confirmation + the PATCH { isDefault: true } behind it. Render `dialog` once and
 * call `request(role)` from any button / picker.
 */
export function useMakeDefaultRole() {
  const update = useUpdateRole()
  const [target, setTarget] = useState<RoleDetail | null>(null)
  const [open, setOpen] = useState(false)

  const request = (role: RoleDetail) => {
    setTarget(role)
    setOpen(true)
  }

  const confirm = () => {
    if (!target) return
    update.mutate(
      { id: target.id, isDefault: true },
      {
        onSuccess: (role) => {
          toast.success(`"${role.name}" is now the default role for new accounts.`)
          setOpen(false)
        },
        onError: (e) => {
          setOpen(false)
          toast.error(errorMessage(e))
        },
      },
    )
  }

  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      // `target` stays set while the dialog closes, so the text doesn't change during the closing animation.
      title={`Make "${target?.name ?? ""}" the default role?`}
      description="New accounts will get it. A different role can still be picked when adding an account."
      confirmLabel="Make default"
      pending={update.isPending}
      onConfirm={confirm}
    />
  )

  return { request, dialog, pending: update.isPending }
}
