import { useCallback, useMemo, useState, type ReactNode } from "react"

import { useAuth } from "@/features/auth/use-auth"
import { useLibraries } from "@/features/libraries/api"
import { LIBRARY_STORAGE_KEY, LibraryScopeContext, type LibraryScope } from "@/lib/library-scope"
import { readStorage, writeStorage } from "@/lib/storage"

export function LibraryScopeProvider({ children }: { children: ReactNode }) {
  // An account that must still change its password can only open /account: the API refuses everything else
  // (403 PASSWORD_CHANGE_REQUIRED), so the libraries are loaded once the password is changed.
  const held = !!useAuth().user?.mustChangePassword
  const libraries = useLibraries({ enabled: !held })
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
      isLoading: libraries.isPending && !held,
      setLibraryId,
    }
  }, [libraries.data, libraries.isPending, held, storedId, setLibraryId])

  return <LibraryScopeContext.Provider value={value}>{children}</LibraryScopeContext.Provider>
}
