import type { ComponentType } from "react"
import { createBrowserRouter, redirect, type LoaderFunctionArgs } from "react-router"

import { AppLayout } from "@/components/app-layout"
import { RequireAdmin, RequireAuth } from "@/components/require-auth"
import { FullScreenSpinner } from "@/components/states"
import { NotFoundPage, RouteErrorPage } from "@/pages/not-found"

/** Lazy-load a page module's named component (keeps the public form bundle small). */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return async () => ({ Component: (await load())[name] as ComponentType })
}

/**
 * Old staff URLs (/loans, /loans/new, /loans/:id) were renamed to /borrow-records/…;
 * bookmarks and shared links keep working, query string and hash included.
 */
function legacyBorrowRecordsRedirect({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const rest = params["*"] ? `/${params["*"]}` : ""
  return redirect(`/borrow-records${rest}${url.search}${url.hash}`)
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    HydrateFallback: FullScreenSpinner,
    children: [
      // Public
      { path: "/login", lazy: page(() => import("@/pages/login"), "LoginPage") },
      { path: "/borrow/:slug", lazy: page(() => import("@/pages/public-borrow"), "PublicBorrowPage") },
      { path: "/borrow/:slug/status", lazy: page(() => import("@/pages/public-status"), "PublicStatusPage") },
      // Mistyped / cut-short public links get the public "not available" page, never the staff login.
      { path: "/borrow/*", lazy: page(() => import("@/pages/public-borrow"), "NotAvailable") },

      // Old staff paths → new ones.
      { path: "/loans", loader: legacyBorrowRecordsRedirect },
      { path: "/loans/*", loader: legacyBorrowRecordsRedirect },

      // Staff
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            errorElement: <RouteErrorPage />,
            children: [
              { index: true, lazy: page(() => import("@/pages/dashboard"), "DashboardPage") },
              { path: "borrow-records", lazy: page(() => import("@/pages/loans-list"), "LoansListPage") },
              { path: "borrow-records/new", lazy: page(() => import("@/pages/loan-new"), "LoanNewPage") },
              { path: "borrow-records/:id", lazy: page(() => import("@/pages/loan-detail"), "LoanDetailPage") },
              { path: "books", lazy: page(() => import("@/pages/books-list"), "BooksListPage") },
              { path: "books/add-many", lazy: page(() => import("@/pages/books-add-many"), "BooksAddManyPage") },
              { path: "books/:id", lazy: page(() => import("@/pages/book-detail"), "BookDetailPage") },
              { path: "borrowers", lazy: page(() => import("@/pages/borrowers-list"), "BorrowersListPage") },
              { path: "borrowers/:id", lazy: page(() => import("@/pages/borrower-detail"), "BorrowerDetailPage") },
              { path: "libraries", lazy: page(() => import("@/pages/libraries-list"), "LibrariesListPage") },
              { path: "libraries/:id", lazy: page(() => import("@/pages/library-detail"), "LibraryDetailPage") },
              { path: "account", lazy: page(() => import("@/pages/account"), "AccountPage") },
              {
                element: <RequireAdmin />,
                children: [{ path: "users", lazy: page(() => import("@/pages/users"), "UsersPage") }],
              },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
])
