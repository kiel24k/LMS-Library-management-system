import { Link, useNavigate } from "react-router"
import { BuildingIcon } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/use-auth"
import { BorrowForm } from "@/features/loans/borrow-form"
import { useLibraryScope } from "@/lib/library-scope"

export function LoanNewPage() {
  const { libraries, libraryId } = useLibraryScope()
  const navigate = useNavigate()
  const { can } = useAuth()

  return (
    <>
      <PageHeader
        back={{ to: "/borrow-records", label: "Borrow Records" }}
        title="Borrow Books"
      />
      {libraries.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon />}
          title="No libraries yet"
          description={can("libraries.create") ? undefined : "Ask someone who manages libraries to add one."}
          action={
            can("libraries.view") ? (
              <Button size="sm" nativeButton={false} render={<Link to="/libraries" />}>
                Go to libraries
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="max-w-3xl">
          <BorrowForm
            mode="staff"
            libraries={libraries}
            initialLibraryId={libraryId}
            canSearchBorrowers={can("borrowers.view")}
            canAddBorrowers={can("borrowers.create")}
            onCreated={(loan) => {
              toast.success(`Books borrowed. Due ${loan.dueDate}.`)
              void navigate(`/borrow-records/${loan.id}`)
            }}
          />
        </div>
      )}
    </>
  )
}
