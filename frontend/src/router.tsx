import type { ComponentType } from "react"
import { createBrowserRouter, redirect, type LoaderFunctionArgs } from "react-router"

import { AppLayout } from "@/components/app-layout"
import { RequireAuth, RequirePermission } from "@/components/require-auth"
import { FullScreenSpinner } from "@/components/states"
import { NotFoundPage, RouteErrorPage } from "@/pages/not-found"
import { HomeFallback } from "@/pages/welcome"

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
      { path: "/catalog", lazy: page(() => import("@/pages/catalog"), "CatalogPage") },
      { path: "/catalog/status", lazy: page(() => import("@/pages/catalog"), "CheckRequestPage") },
      { path: "/borrow/:slug", lazy: page(() => import("@/pages/public-borrow"), "PublicBorrowPage") },
      { path: "/borrow/:slug/status", lazy: page(() => import("@/pages/public-status"), "PublicStatusPage") },
      // Mistyped / cut-short public links get the public "not available" page, never the staff login.
      { path: "/borrow/*", lazy: page(() => import("@/pages/public-borrow"), "NotAvailable") },

      // Old staff paths → new ones.
      { path: "/loans", loader: legacyBorrowRecordsRedirect },
      { path: "/loans/*", loader: legacyBorrowRecordsRedirect },

      // Signed-in app: one app for every account; the sidebar shows the modules its role allows.
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            errorElement: <RouteErrorPage />,
            children: [
              // Every page is gated by the permission it needs (the API checks the same ones).
              // Home: the dashboard, else My Books, else a welcome page listing what the user can open.
              {
                element: <RequirePermission perm="dashboard.view" fallback={<HomeFallback />} />,
                children: [{ index: true, lazy: page(() => import("@/pages/dashboard"), "DashboardPage") }],
              },
              {
                element: <RequirePermission perm="my_books.view" />,
                children: [{ path: "my-books", lazy: page(() => import("@/pages/my-books"), "MyBooksPage") }],
              },
              {
                element: <RequirePermission perm="loans.view" />,
                children: [
                  { path: "borrow-records", lazy: page(() => import("@/pages/loans-list"), "LoansListPage") },
                  { path: "borrow-records/:id", lazy: page(() => import("@/pages/loan-detail"), "LoanDetailPage") },
                ],
              },
              {
                element: <RequirePermission perm="loans.create" />,
                children: [{ path: "borrow-records/new", lazy: page(() => import("@/pages/loan-new"), "LoanNewPage") }],
              },
              {
                element: <RequirePermission perm="books.view" />,
                children: [
                  { path: "books", lazy: page(() => import("@/pages/books-list"), "BooksListPage") },
                  { path: "books/:id", lazy: page(() => import("@/pages/book-detail"), "BookDetailPage") },
                ],
              },
              {
                element: <RequirePermission perm="books.create" />,
                children: [{ path: "books/add-many", lazy: page(() => import("@/pages/books-add-many"), "BooksAddManyPage") }],
              },
              {
                element: <RequirePermission perm="borrowers.view" />,
                children: [
                  { path: "borrowers", lazy: page(() => import("@/pages/borrowers-list"), "BorrowersListPage") },
                  { path: "borrowers/:id", lazy: page(() => import("@/pages/borrower-detail"), "BorrowerDetailPage") },
                ],
              },
              {
                element: <RequirePermission perm="libraries.view" />,
                children: [
                  { path: "libraries", lazy: page(() => import("@/pages/libraries-list"), "LibrariesListPage") },
                  { path: "libraries/:id", lazy: page(() => import("@/pages/library-detail"), "LibraryDetailPage") },
                ],
              },
              {
                element: <RequirePermission any={["users.view", "roles.view"]} />,
                children: [{ path: "users", lazy: page(() => import("@/pages/users"), "UsersPage") }],
              },
              {
                element: <RequirePermission perm="company.update" />,
                children: [
                  { path: "company-profile", lazy: page(() => import("@/pages/company-profile"), "CompanyProfilePage") },
                ],
              },
              // Any signed-in user (also the only page open while the account must change its default password).
              { path: "account", lazy: page(() => import("@/pages/account"), "AccountPage") },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
])
