import { useState } from "react"
import { useNavigate } from "react-router"
import { ArchiveIcon, ArchiveRestoreIcon, EyeIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDeleteBook, useUpdateBook } from "@/features/books/api"
import { ApiError, errorMessage } from "@/lib/api"
import type { Book } from "@/types/api"

/** Row / page menu: view, edit, archive or restore, delete (with "archive instead" fallback). */
export function BookActionsMenu({
  book,
  onEdit,
  showView = true,
  afterDelete,
}: {
  book: Book
  onEdit: () => void
  showView?: boolean
  afterDelete?: () => void
}) {
  const navigate = useNavigate()
  const update = useUpdateBook()
  const del = useDeleteBook()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const setArchived = (archived: boolean) =>
    update.mutate(
      { id: book.id, archived },
      {
        onSuccess: () => toast.success(archived ? `“${book.title}” archived.` : `“${book.title}” restored.`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${book.title}`} />}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {showView && (
            <DropdownMenuItem onClick={() => void navigate(`/books/${book.id}`)}>
              <EyeIcon />
              View details
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onEdit}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          {book.archived ? (
            <DropdownMenuItem onClick={() => setArchived(false)} disabled={update.isPending}>
              <ArchiveRestoreIcon />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setArchived(true)} disabled={update.isPending}>
              <ArchiveIcon />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${book.title}”?`}
        description="This can't be undone."
        confirmLabel="Delete book"
        destructive
        pending={del.isPending}
        onConfirm={() =>
          del.mutate(book.id, {
            onSuccess: () => {
              setConfirmDelete(false)
              toast.success(`“${book.title}” deleted.`)
              afterDelete?.()
            },
            onError: (e) => {
              setConfirmDelete(false)
              if (e instanceof ApiError && e.code === "BOOK_HAS_LOANS") {
                toast.error("This book was borrowed before. It can't be deleted.", {
                  action: book.archived ? undefined : { label: "Archive instead", onClick: () => setArchived(true) },
                })
              } else toast.error(errorMessage(e))
            },
          })
        }
      />
    </>
  )
}
