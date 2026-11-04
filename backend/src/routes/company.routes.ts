import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { optEmail, optStr, reqStr } from "../lib/validation.js";
import { IMAGE_MIME_TYPES, imageHeaders, toBuffer } from "../lib/images.js";
import * as company from "../services/company.service.js";

// The name goes into email subjects and page titles: one line only.
const NO_LINE_BREAKS = /^[^\r\n]*$/;
const singleLine = <S extends z.ZodType<string | null | undefined>>(schema: S) =>
  schema.refine((v) => v == null || NO_LINE_BREAKS.test(v), "Must be a single line.");

const companyInput = z.object({
  name: singleLine(reqStr(1, 120)),
  tagline: singleLine(optStr(200)),
  address: optStr(300),
  contactEmail: optEmail(),
  contactPhone: singleLine(optStr(60)),
});

// 512 KB decoded is ~700 KB of base64; the JSON body limit for this route is 1mb (see app.ts). Larger pictures that
// still fit the body get 413 IMAGE_TOO_LARGE from the service.
const logoBody = z
  .object({
    mimeType: z.enum(IMAGE_MIME_TYPES, { error: "Choose a PNG, JPEG or WebP picture." }),
    data: z.string({ error: "Required." }).min(1, "Required.").max(1024 * 1024, "This picture is too big."),
  })
  // A data URL of the same type is accepted too (its prefix is dropped).
  .transform((v) => ({ ...v, data: v.data.startsWith(`data:${v.mimeType};base64,`) ? v.data.slice(`data:${v.mimeType};base64,`.length) : v.data }));

/** Staff: edit the company profile (company.update). */
export function companyRouter() {
  const r = Router();
  r.put("/", requirePermission("company.update"), validateBody(companyInput), async (req, res) => {
    res.json(await company.updateCompanyProfile(req.body as z.output<typeof companyInput>));
  });
  r.put("/logo", requirePermission("company.update"), validateBody(logoBody), async (req, res) => {
    const { mimeType, data } = req.body as z.output<typeof logoBody>;
    res.json(await company.setCompanyLogo(mimeType, data));
  });
  r.delete("/logo", requirePermission("company.update"), async (_req, res) => {
    res.json(await company.removeCompanyLogo());
  });
  return r;
}

/** Public (no login): the profile and logo shown on the sign-in and public pages. */
export function publicCompanyRouter() {
  const r = Router();
  r.get("/", async (_req, res) => {
    res.json(await company.getCompanyProfile());
  });
  r.get("/logo", async (req, res) => {
    const logo = await company.getCompanyLogo();
    res.set(imageHeaders(logo.mimeType, req.query.v !== undefined, "public"));
    // Public and harmless: other origins (e.g. a frontend served from another host) may show it.
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(toBuffer(logo.data));
  });
  return r;
}
