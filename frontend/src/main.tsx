import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router/dom"

import "./index.css"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { authKeys } from "@/features/auth/api"
import { setUnauthenticatedHandler } from "@/lib/api"
import { queryClient } from "@/lib/query-client"
import { initTheme } from "@/lib/theme"
import { router } from "@/router"

// Light/dark mode (top-bar profile menu or Profile settings) and main color (Profile settings) (index.html applies them before first paint).
initTheme()

// Any 401 UNAUTHENTICATED clears the cached user; <RequireAuth> then redirects to /login?next=…
setUnauthenticatedHandler(() => {
  if (queryClient.getQueryData(authKeys.me)) queryClient.setQueryData(authKeys.me, null)
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster position="top-center" closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
