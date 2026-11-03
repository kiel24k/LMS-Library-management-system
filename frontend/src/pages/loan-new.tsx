import { Link, useNavigate } from "react-router"
import { BuildingIcon } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { BorrowForm } from "@/features/loans/borrow-form"
import { useLibraryScope } from "@/lib/library-scope"

export function LoanNewPage() {
  const { libraries, libraryId } = useLibraryScope()
  const navigate = useNavigate()

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
          action={
            <Button size="sm" nativeButton={false} render={<Link to="/libraries" />}>
              Go to libraries
            </Button>
          }
        />
      ) : (
        <div className="max-w-3xl">
          <BorrowForm
            mode="staff"
            libraries={libraries}
            initialLibraryId={libraryId}
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
