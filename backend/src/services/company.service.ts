/**
 * The company profile: the organisation's name, logo and contact details, shown on every page (sign-in, sidebar,
 * public pages) and in emails. One row (id 1); when it is missing, the defaults are used and saving recreates it.
 */
import { prisma, type Db } from "../lib/prisma.js";
import { notFound } from "../lib/http-error.js";
import { decodeImage, type ImageMimeType } from "../lib/images.js";

export const DEFAULT_COMPANY_NAME = "Library System";
export const MAX_LOGO_BYTES = 512 * 1024; // 512 KB decoded
const ID = 1;

/** Every column except the logo bytes (`logoMimeType` tells whether there is a logo). */
const profileSelect = {
  name: true,
  tagline: true,
  address: true,
  contactEmail: true,
  contactPhone: true,
  logoMimeType: true,
  updatedAt: true,
} as const;

export type CompanyRow = {
  name: string;
  tagline: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  logoMimeType: string | null;
  updatedAt: Date;
};

const DEFAULTS: CompanyRow = {
  name: DEFAULT_COMPANY_NAME,
  tagline: null,
  address: null,
  contactEmail: null,
  contactPhone: null,
  logoMimeType: null,
  updatedAt: new Date(0),
};

/** `CompanyProfile` response. The logo URL carries ?v=<updatedAt ms>, so each URL's bytes never change. */
export const serializeCompany = (c: CompanyRow) => ({
  name: c.name,
  tagline: c.tagline,
  address: c.address,
  contactEmail: c.contactEmail,
  contactPhone: c.contactPhone,
  logoUrl: c.logoMimeType ? `/api/public/company/logo?v=${c.updatedAt.getTime()}` : null,
});
export type CompanyDto = ReturnType<typeof serializeCompany>;

/** The stored profile (without logo bytes), or the defaults when the row is missing. */
export async function getCompanyRow(db: Db = prisma): Promise<CompanyRow> {
  return (await db.companyProfile.findUnique({ where: { id: ID }, select: profileSelect })) ?? DEFAULTS;
}

export async function getCompanyProfile() {
  return serializeCompany(await getCompanyRow());
}

export type CompanyInput = {
  name: string;
  tagline?: string | null;
  address?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

/** Saves the details (omitted optional fields stay unchanged; null clears). */
export async function updateCompanyProfile(input: CompanyInput) {
  const data = {
    name: input.name,
    tagline: input.tagline,
    address: input.address,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
  };
  const row = await prisma.companyProfile.upsert({
    where: { id: ID },
    create: { id: ID, ...data },
    update: data,
    select: profileSelect,
  });
  return serializeCompany(row);
}

/** Sets or replaces the logo (base64 bytes of the stated type; at most 512 KB, first bytes checked). */
export async function setCompanyLogo(mimeType: ImageMimeType, base64: string) {
  const image = decodeImage(mimeType, base64, MAX_LOGO_BYTES);
  const logo = { logoMimeType: image.mimeType, logoData: new Uint8Array(image.data) };
  const row = await prisma.companyProfile.upsert({
    where: { id: ID },
    create: { id: ID, ...logo },
    update: logo,
    select: profileSelect,
  });
  return serializeCompany(row);
}

/** Removes the logo (fine when there is none). */
export async function removeCompanyLogo() {
  const row = await prisma.companyProfile.upsert({
    where: { id: ID },
    create: { id: ID },
    update: { logoMimeType: null, logoData: null },
    select: profileSelect,
  });
  return serializeCompany(row);
}

export async function getCompanyLogo() {
  const row = await prisma.companyProfile.findUnique({ where: { id: ID }, select: { logoMimeType: true, logoData: true } });
  if (!row?.logoMimeType || !row.logoData) throw notFound("Logo");
  return { mimeType: row.logoMimeType, data: row.logoData };
}
