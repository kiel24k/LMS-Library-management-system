// Types mirroring docs/SPEC.md → "Response shapes" (copied verbatim), plus request bodies
// and error details used by the frontend.

import type { Permission } from "@/lib/permissions"

export type ISODateTime = string // "2026-11-03T02:15:00.000Z"
export type DateOnly = string // "2026-11-10"
export type Ref = { id: string; name: string }
export type LoanStatus =
  | "PENDING"
  | "BORROWED"
  | "PARTIALLY_RETURNED"
  | "RETURNED"
  | "REJECTED"
  | "CANCELLED"

export type User = {
  id: string
  email: string
  name: string
  role: Ref // the account's role: { id, name }
  active: boolean
  /** Still on the default password (accounts created when a request was accepted); asked to change it on sign-in. */
  mustChangePassword: boolean
  /** The borrower this account belongs to (its "My Books" page shows their borrow records), or null. */
  borrower: Ref | null
  createdAt: ISODateTime
}

/** The signed-in user (POST /auth/login, GET /auth/me): the account plus everything its role allows. */
export type Me = User & { permissions: Permission[] }

export type RoleDetail = {
  id: string
  name: string
  description: string | null
  permissions: Permission[] // normalized: catalog order, every "requires" included
  userCount: number // accounts with this role, active or not
  isDefault: boolean // new accounts get this role when none is chosen; at most one role
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/** One module of the permission catalog (GET /permissions), in display order. */
export type PermissionModule = {
  key: string
  label: string
  permissions: {
    key: Permission
    label: string
    description: string | null
    requires: Permission[] // granted together with this one
  }[]
}

export type Library = {
  id: string
  name: string
  slug: string
  description: string | null
  location: string | null
  publicFormEnabled: boolean
  defaultLoanDays: number
  createdAt: ISODateTime
  updatedAt: ISODateTime
  counts: {
    books: number // non-archived books
    copies: number // sum totalCopies of non-archived books
    available: number // sum availableCopies of non-archived books
    activeLoans: number // open loans (BORROWED + PARTIALLY_RETURNED)
    pendingRequests: number // PENDING loans
    categories: number
  }
}

export type Category = {
  id: string
  libraryId: string
  name: string
  description: string | null
  bookCount: number // non-archived
}

export type Book = {
  id: string
  libraryId: string
  library: Ref
  categoryId: string | null
  category: Ref | null
  title: string
  author: string | null
  isbn: string | null
  publisher: string | null
  publicationYear: number | null
  callNumber: string | null
  totalCopies: number
  availableCopies: number
  onLoan: number
  notes: string | null
  archived: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
  // "/api/books/<id>/cover?v=…" when the book has a picture, else null. ?v= changes with every new picture.
  coverUrl: string | null
}

export type BookDetail = Book & {
  currentLoans: {
    // open loans that still have this book outstanding, oldest dueDate first
    loanId: string
    loanNumber: string
    status: LoanStatus
    borrower: Ref
    quantity: number
    outstanding: number
    dueDate: DateOnly
    isOverdue: boolean
  }[]
} // full loan history: GET /loans?bookId=…

export type Borrower = {
  id: string
  name: string
  email: string | null
  /** Has a linked account (can sign in and see their books under "My Books"). */
  hasAccount: boolean
  /** The linked account is still on the default password. */
  mustChangePassword: boolean
  /** The linked account (a normal account with a role), or null. */
  account: { id: string; email: string; role: Ref; active: boolean } | null
  idNumber: string | null
  contact: string | null
  affiliation: string | null
  createdAt: ISODateTime
  updatedAt: ISODateTime
  activeLoans: number // open loans
  outstandingCopies: number // sum of outstanding over open loans
}
export type BorrowerDetail = Borrower & { loans: Loan[] } // all loans, newest first

export type LoanItem = {
  id: string
  bookId: string
  book: {
    id: string
    title: string
    author: string | null
    callNumber: string | null
    archived: boolean
    /** The book's current stock in its library. */
    totalCopies: number
    availableCopies: number
  }
  quantity: number
  returnedGood: number
  returnedDamaged: number
  lost: number
  outstanding: number
}

export type Loan = {
  // list item (GET /loans, dashboard, borrower detail)
  id: string
  number: number
  loanNumber: string // 123, "LN-000123"
  libraryId: string
  library: Ref
  borrower: {
    id: string
    name: string
    email: string | null
    idNumber: string | null
    contact: string | null
    affiliation: string | null
  }
  source: "STAFF" | "PUBLIC_FORM"
  status: LoanStatus
  requestedAt: ISODateTime
  borrowedAt: ISODateTime | null
  dueDate: DateOnly | null
  closedAt: ISODateTime | null
  notes: string | null
  staffNotes: string | null
  submittedName: string | null
  /** Accept/reject email result (public requests). */
  notification: LoanNotification | null
  items: LoanItem[]
  totalQuantity: number // sum of item quantities
  outstandingTotal: number // sum of item outstanding
  isOverdue: boolean
  daysOverdue: number
}

export type LoanDetail = Loan & {
  createdBy: Ref | null
  approvedBy: Ref | null
  closedBy: Ref | null
  returns: ReturnRecord[] // oldest first
}

export type ReturnRecord = {
  id: string
  receivedAt: ISODateTime
  receivedBy: Ref
  returnedByName: string | null
  notes: string | null
  items: {
    id: string
    loanItemId: string
    bookId: string
    bookTitle: string
    good: number
    damaged: number
    lost: number
  }[]
}

export type ActivityType =
  | "REQUESTED"
  | "BORROWED"
  | "RETURNED"
  | "REJECTED"
  | "CANCELLED"

export type Dashboard = {
  totals: { books: number; copies: number; available: number; borrowedOut: number }
  loans: { pending: number; active: number; overdue: number; returnedThisMonth: number }
  overdueLoans: Loan[] // top 10, oldest dueDate first
  pendingLoans: Loan[] // top 10, oldest requestedAt first (waiting longest)
  recentActivity: {
    // latest 15, newest first
    type: ActivityType
    loanId: string
    loanNumber: string
    borrowerName: string
    libraryName: string
    at: ISODateTime
    byName: string | null // staff name; null for REQUESTED
  }[]
}

// ---- Public endpoints ----

export type PublicLibraryInfo = {
  library: {
    name: string
    slug: string
    description: string | null
    location: string | null
    defaultLoanDays: number
  }
  categories: { id: string; name: string }[]
}

export type PublicBook = {
  id: string
  title: string
  author: string | null
  callNumber: string | null
  category: { id: string; name: string } | null
  available: boolean
  /** "/api/public/libraries/<slug>/books/<id>/cover?v=…" or null. */
  coverUrl: string | null
}

export type PublicRequestResult = { loanNumber: string; status: "PENDING" }
/** POST /me/requests — a signed-in account's request for its linked borrower (no details form). */
export type MyRequestInput = { slug: string; items: LoanItemInput[]; notes?: string }
export type MyRequestResult = PublicRequestResult & { email: string | null }

export type PublicRequestStatus = {
  loanNumber: string
  status: LoanStatus
  requestedAt: ISODateTime
  dueDate: DateOnly | null
}

// ---- List wrappers ----

export type Paginated<T> = { data: T[]; total: number; page: number; pageSize: number }
export type ListResponse<T> = { data: T[] }

// ---- Request bodies ----

export type LibraryInput = {
  name: string
  slug?: string
  description?: string | null
  location?: string | null
  publicFormEnabled?: boolean
  defaultLoanDays?: number
}

export type CategoryInput = { name: string; description?: string | null }

export type BookInput = {
  title: string
  author?: string | null
  isbn?: string | null
  publisher?: string | null
  publicationYear?: number | null
  callNumber?: string | null
  totalCopies?: number
  categoryId?: string | null
  categoryName?: string
  notes?: string | null
}

export type BookCreateInput = BookInput & { libraryId: string }
export type BookPatchInput = Partial<BookInput> & { archived?: boolean }
export type BulkBooksInput = { libraryId: string; books: BookInput[] }
export type BulkBooksResult = { created: number; categoriesCreated: string[] }

export type BorrowerInput = {
  name: string
  email?: string | null
  idNumber?: string | null
  contact?: string | null
  affiliation?: string | null
}

export type LoanItemInput = { bookId: string; quantity: number }

export type LoanCreateInput = {
  libraryId: string
  borrowerId?: string
  borrower?: BorrowerInput
  items: LoanItemInput[]
  dueDate?: DateOnly
  notes?: string
}

export type LoanPatchInput = {
  items?: LoanItemInput[]
  notes?: string | null
  dueDate?: DateOnly
}

export type ReturnInput = {
  items: { loanItemId: string; good: number; damaged: number; lost: number }[]
  returnedByName?: string
  notes?: string
}

export type PublicRequestInput = {
  borrower: { name: string; email: string; idNumber?: string; contact?: string; affiliation?: string }
  items: LoanItemInput[]
  notes?: string
  website?: string
}

/** `roleId` left out → the default role (400 on roleId when there is none). */
export type UserCreateInput = { email: string; name: string; password: string; roleId?: string }
export type UserPatchInput = { name?: string; roleId?: string; active?: boolean; password?: string }

/** `isDefault: true` makes the role the default for new accounts (only `true`: pick another role to move it). */
export type RoleInput = { name: string; description?: string | null; permissions: Permission[]; isDefault?: true }
export type RolePatchInput = Partial<RoleInput>

// ---- Error details ----

export type ValidationIssue = { path: (string | number)[]; message: string }
export type ValidationErrorDetails = { issues: ValidationIssue[] }
export type InvalidBooksDetails = { bookIds: string[] }
export type InsufficientCopiesDetails = {
  books: { bookId: string; title: string; requested: number; available: number }[]
}
export type ReturnExceedsDetails = { loanItemIds: string[] }
export type InvalidStatusDetails = { status: LoanStatus }

// ---------------------------------------------------------------- Company profile / catalog / My Books

export type CompanyProfile = {
  name: string
  tagline: string | null
  address: string | null
  contactEmail: string | null
  contactPhone: string | null
  /** "/api/public/company/logo?v=…" or null when there is no logo. */
  logoUrl: string | null
}
export type CompanyProfileInput = {
  name: string
  tagline?: string | null
  address?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
}
export type CompanyLogoInput = { mimeType: "image/png" | "image/jpeg" | "image/webp"; data: string } // base64

export type PublicLibrarySummary = {
  name: string
  slug: string
  description: string | null
  location: string | null
  defaultLoanDays: number
}

/** One borrow record as its borrower sees it (My Books, GET /me/loans): no staff-only fields. */
export type PortalLoan = {
  id: string
  loanNumber: string
  status: LoanStatus
  library: { name: string; slug: string }
  requestedAt: ISODateTime
  borrowedAt: ISODateTime | null
  dueDate: DateOnly | null
  closedAt: ISODateTime | null
  isOverdue: boolean
  daysOverdue: number
  /** The staff's reason, only for REJECTED requests. */
  staffNotes: string | null
  items: { bookId: string; title: string; author: string | null; quantity: number; outstanding: number }[]
}

/** GET /me/loans: the borrow records of the borrower linked to the signed-in account (borrower null → not linked). */
export type MyLoansResponse = { borrower: Ref | null; data: PortalLoan[] }

/** Result of the accept/reject email of a public request (null when none was attempted). */
export type LoanNotification = { sentAt: ISODateTime | null; error: string | null }
