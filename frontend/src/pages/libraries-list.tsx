import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { BuildingIcon, GlobeIcon, LockIcon, MapPinIcon, PlusIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/features/auth/use-auth"
import { useLibraries } from "@/features/libraries/api"
import { LibraryFormDialog } from "@/features/libraries/library-form-dialog"

export function LibrariesListPage() {
  const { can } = useAuth()
  const libraries = useLibraries()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="Libraries"
        actions={
          can("libraries.create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              New library
            </Button>
          )
        }
      />
      {libraries.isPending ? (
        <PageSkeleton />
      ) : libraries.isError ? (
        <ErrorState error={libraries.error} onRetry={() => void libraries.refetch()} />
      ) : libraries.data.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon />}
          title="No libraries yet"
          description={can("libraries.create") ? undefined : "Ask someone who manages libraries to add one."}
          action={
            can("libraries.create") && (
              <Button size="sm" onClick={() => setCreating(true)}>
                New library
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {libraries.data.map((lib) => (
            <Link key={lib.id} to={`/libraries/${lib.id}`} className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle className="flex items-start justify-between gap-2">
                    <span>{lib.name}</span>
                    {lib.publicFormEnabled ? (
                      <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">
                        <GlobeIcon data-icon="inline-start" />
                        Public form
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <LockIcon data-icon="inline-start" />
                        Staff only
                      </Badge>
                    )}
                  </CardTitle>
                  {lib.location && (
                    <CardDescription className="flex items-center gap-1">
                      <MapPinIcon className="size-3.5" />
                      {lib.location}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Books</dt>
                      <dd className="font-medium tabular-nums">{lib.counts.books}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Available</dt>
                      <dd className="font-medium tabular-nums">
                        {lib.counts.available}/{lib.counts.copies}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Categories</dt>
                      <dd className="font-medium tabular-nums">{lib.counts.categories}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Currently borrowed</dt>
                      <dd className="font-medium tabular-nums">{lib.counts.activeLoans}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Pending</dt>
                      <dd className={`font-medium tabular-nums ${lib.counts.pendingRequests > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                        {lib.counts.pendingRequests}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Borrowing days</dt>
                      <dd className="font-medium tabular-nums">{lib.defaultLoanDays}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {creating && (
        <LibraryFormDialog open onOpenChange={setCreating} onCreated={(lib) => void navigate(`/libraries/${lib.id}`)} />
      )}
    </>
  )
}
