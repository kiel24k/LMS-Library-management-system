import { useCallback, useMemo, useState, type ReactNode } from "react"

import { useLibraries } from "@/features/libraries/api"
import { LIBRARY_STORAGE_KEY, LibraryScopeContext, type LibraryScope } from "@/lib/library-scope"
import { readStorage, writeStorage } from "@/lib/storage"

export function LibraryScopeProvider({ children }: { children: ReactNode }) {
  const libraries = useLibraries()
  const [storedId, setStoredId] = useState<string | null>(() => readStorage(LIBRARY_STORAGE_KEY))

  const setLibraryId = useCallback((id: string | null) => {
    setStoredId(id)
    writeStorage(LIBRARY_STORAGE_KEY, id)
  }, [])

  const value = useMemo<LibraryScope>(() => {
    const list = libraries.data ?? []
    // Fall back to "All libraries" when the remembered library no longer exists.
    const library = storedId ? (list.find((l) => l.id === storedId) ?? null) : null
    return {
      libraryId: library?.id ?? null,
      library,
      libraries: list,
      isLoading: libraries.isPending,
      setLibraryId,
    }
  }, [libraries.data, libraries.isPending, storedId, setLibraryId])

  return <LibraryScopeContext.Provider value={value}>{children}</LibraryScopeContext.Provider>
}
