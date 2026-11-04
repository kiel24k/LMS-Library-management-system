import { useEffect } from "react"

import { useCompany } from "@/features/company/api"

/**
 * Sets the browser tab title to "<page> · <company name>" (or just the company name). Effects run child
 * first, so call it once per screen: in the layout, or in the page when the layout doesn't.
 */
export function useDocumentTitle(page?: string | null) {
  const { name } = useCompany()
  useEffect(() => {
    document.title = page ? `${page} · ${name}` : name
  }, [page, name])
}
