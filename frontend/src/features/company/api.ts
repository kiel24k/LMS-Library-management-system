import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { readStorage, writeStorage } from "@/lib/storage"
import type { CompanyLogoInput, CompanyProfile, CompanyProfileInput } from "@/types/api"

export const companyKeys = { profile: ["public", "company"] as const }

/** Shown until the profile has loaded for the first time (and if it can't be loaded at all). */
export const DEFAULT_COMPANY: CompanyProfile = {
  name: "Library System",
  tagline: null,
  address: null,
  contactEmail: null,
  contactPhone: null,
  logoUrl: null,
}

// The last profile seen in this browser: shown right away on the next visit instead of a flash of the
// default name. index.html reads the same key for the tab title before the app loads.
const STORAGE_KEY = "lms-company"

function readCachedProfile(): CompanyProfile | undefined {
  const raw = readStorage(STORAGE_KEY)
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw) as Partial<CompanyProfile> | null
    if (!v || typeof v.name !== "string" || !v.name) return undefined
    return { ...DEFAULT_COMPANY, ...v }
  } catch {
    return undefined
  }
}

function cacheProfile(profile: CompanyProfile) {
  writeStorage(STORAGE_KEY, JSON.stringify(profile))
}

/**
 * The company name, logo and contact details (GET /public/company, no login needed). Used on every page,
 * so it is cached for a while; edits on the Company Profile page update the cache directly.
 */
export function useCompanyProfile() {
  return useQuery({
    queryKey: companyKeys.profile,
    queryFn: async ({ signal }) => {
      const profile = await api.get<CompanyProfile>("/public/company", undefined, signal)
      cacheProfile(profile)
      return profile
    },
    placeholderData: readCachedProfile,
    staleTime: 5 * 60_000,
  })
}

/** The company profile to show: the loaded one, the last one seen, or the default while neither is known. */
export function useCompany(): CompanyProfile {
  return useCompanyProfile().data ?? DEFAULT_COMPANY
}

function useStoreProfile() {
  const qc = useQueryClient()
  return (profile: CompanyProfile) => {
    cacheProfile(profile)
    qc.setQueryData(companyKeys.profile, profile)
  }
}

export function useUpdateCompanyProfile() {
  const store = useStoreProfile()
  return useMutation({
    mutationFn: (body: CompanyProfileInput) => api.put<CompanyProfile>("/company", body),
    meta: { skipErrorToast: true },
    onSuccess: store,
  })
}

/** Sets the logo; `data` is the base64 of a PNG / JPEG / WebP picture (see logo-image.ts). */
export function useSetCompanyLogo() {
  const store = useStoreProfile()
  return useMutation({
    mutationFn: (body: CompanyLogoInput) => api.put<CompanyProfile>("/company/logo", body),
    meta: { skipErrorToast: true },
    onSuccess: store,
  })
}

export function useRemoveCompanyLogo() {
  const store = useStoreProfile()
  return useMutation({
    mutationFn: () => api.delete<CompanyProfile>("/company/logo"),
    meta: { skipErrorToast: true },
    onSuccess: store,
  })
}
