import { useState } from "react"
import { useNavigate, useParams } from "react-router"
import { ExternalLinkIcon, FolderIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { CopyButton } from "@/components/copy-button"
import { PageHeader } from "@/components/page-header"
import { EmptyState, ErrorState, PageSkeleton, TableSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/features/auth/use-auth"
import { useCategories, useDeleteCategory } from "@/features/categories/api"
import { CategoryDialog } from "@/features/categories/category-dialog"
import { useDeleteLibrary, useLibrary, useUpdateLibrary } from "@/features/libraries/api"
import { LibraryFormDialog } from "@/features/libraries/library-form-dialog"
import { ApiError, errorMessage } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { useLibraryScope } from "@/lib/library-scope"
import type { Category, Library } from "@/types/api"

function PublicFormCard({ library, canEdit }: { library: Library; canEdit: boolean }) {
  const update = useUpdateLibrary(library.id)
  const link = `${window.location.origin}/borrow/${library.slug}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Public borrow form</CardTitle>
        <CardDescription>Anyone with the link can request books.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Label className="gap-3 font-normal">
          <Switch
            checked={library.publicFormEnabled}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(checked) =>
              update.mutate(
                { publicFormEnabled: checked },
                {
                  onSuccess: (l) => toast.success(l.publicFormEnabled ? "Public form on." : "Public form off."),
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
            aria-label="Public borrow form"
          />
          <span className="font-medium">{library.publicFormEnabled ? "On" : "Off"}</span>
        </Label>
        {!canEdit && <p className="text-xs text-muted-foreground">You don't have permission to change this.</p>}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Link</span>
          <code className="rounded-lg border bg-muted/40 px-2 py-1.5 text-xs break-all">{link}</code>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={link} label="Copy link" />
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={link} target="_blank" rel="noreferrer" />}>
              <ExternalLinkIcon data-icon="inline-start" />
              Open form
            </Button>
          </div>
          {!library.publicFormEnabled && (
            <p className="text-xs text-muted-foreground">The link won't work while off.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function CategoriesCard({ library }: { library: Library }) {
  const { can } = useAuth()
  const canUpdate = can("categories.update")
  const canDelete = can("categories.delete")
  const categories = useCategories(library.id)
  const del = useDeleteCategory()
  const [editing, setEditing] = useState<Category | "new" | null>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        {can("categories.create") && (
          <CardAction>
            <Button size="sm" onClick={() => setEditing("new")}>
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {categories.isPending ? (
          <TableSkeleton columns={3} rows={3} />
        ) : categories.isError ? (
          <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
        ) : categories.data.length === 0 ? (
          <EmptyState icon={<FolderIcon />} title="No categories yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Books</TableHead>
                {(canUpdate || canDelete) && (
                  <TableHead className="w-20">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{c.name}</span>
                    {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.bookCount}</TableCell>
                  {(canUpdate || canDelete) && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {canUpdate && (
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                            <PencilIcon />
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>
                            <Trash2Icon />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {editing && (
        <CategoryDialog
          libraryId={library.id}
          category={editing === "new" ? undefined : editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete category “${deleting?.name ?? ""}”?`}
        description="Its books will not be deleted."
        confirmLabel="Delete category"
        destructive
        pending={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`Category “${deleting.name}” deleted.`)
              setDeleting(null)
            },
            onError: (e) => {
              toast.error(errorMessage(e))
              setDeleting(null)
            },
          })
        }
      />
    </Card>
  )
}

export function LibraryDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can, canAny } = useAuth()
  const { setLibraryId } = useLibraryScope()
  const query = useLibrary(id)
  const del = useDeleteLibrary()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (query.isPending) return <PageSkeleton />
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404
    return (
      <ErrorState
        title={notFound ? "Library not found" : "Couldn't load this library"}
        error={query.error}
        onRetry={notFound ? undefined : () => void query.refetch()}
      />
    )
  }
  const lib = query.data

  const facts: [string, React.ReactNode][] = [
    ["Location", lib.location ?? "—"],
    ["Borrowing days", lib.defaultLoanDays],
    ["Books", lib.counts.books],
    ["Available", `${lib.counts.available} / ${lib.counts.copies}`],
    ["Currently borrowed", lib.counts.activeLoans],
    ["Pending requests", lib.counts.pendingRequests],
    ["Created", formatDate(lib.createdAt)],
  ]

  return (
    <>
      <PageHeader
        back={{ to: "/libraries", label: "Libraries" }}
        title={lib.name}
        description={lib.description ?? undefined}
        actions={
          canAny("libraries.update", "libraries.delete") && (
            <>
              {can("libraries.update") && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <PencilIcon data-icon="inline-start" />
                  Edit
                </Button>
              )}
              {can("libraries.delete") && (
                <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2Icon data-icon="inline-start" />
                  Delete
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            {can("books.view") && (
              <CardAction>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Scope the catalog to this library, then open it.
                    setLibraryId(lib.id)
                    void navigate("/books")
                  }}
                >
                  View books
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-1.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <PublicFormCard library={lib} canEdit={can("libraries.update")} />
      </div>

      <CategoriesCard library={lib} />

      {editing && <LibraryFormDialog open onOpenChange={setEditing} library={lib} />}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${lib.name}?`}
        description="Its categories will be deleted too. This can't be undone."
        confirmLabel="Delete library"
        destructive
        pending={del.isPending}
        onConfirm={() =>
          del.mutate(lib.id, {
            onSuccess: () => {
              toast.success(`${lib.name} deleted.`)
              void navigate("/libraries", { replace: true })
            },
            onError: (e) => {
              setConfirmDelete(false)
              if (e instanceof ApiError && e.code === "LIBRARY_NOT_EMPTY") {
                toast.error("Can't delete: it still has books or borrow records.")
              } else toast.error(errorMessage(e))
            },
          })
        }
      />
    </>
  )
}
