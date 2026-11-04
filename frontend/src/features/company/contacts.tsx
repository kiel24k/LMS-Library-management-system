import type { ReactNode } from "react"
import { MailIcon, MapPinIcon, PhoneIcon } from "lucide-react"

import type { CompanyProfile } from "@/types/api"

export type ContactItem = {
  key: "address" | "phone" | "email"
  icon: ReactNode
  text: string
  /** tel: / mailto: link, when it has one. */
  href?: string
}

/** The company's address, phone and email that are set, in that order, ready to list. */
export function companyContacts(company: Pick<CompanyProfile, "address" | "contactPhone" | "contactEmail">): ContactItem[] {
  const items: ContactItem[] = []
  if (company.address) items.push({ key: "address", icon: <MapPinIcon aria-hidden />, text: company.address })
  if (company.contactPhone) {
    const tel = company.contactPhone.replace(/[^\d+]/g, "")
    items.push({ key: "phone", icon: <PhoneIcon aria-hidden />, text: company.contactPhone, href: tel ? `tel:${tel}` : undefined })
  }
  if (company.contactEmail) {
    items.push({ key: "email", icon: <MailIcon aria-hidden />, text: company.contactEmail, href: `mailto:${company.contactEmail}` })
  }
  return items
}
