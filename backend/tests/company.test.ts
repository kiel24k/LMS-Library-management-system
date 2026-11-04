import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { app, loginAs } from "./helpers.js";

// Tiny real pictures (1×1 pixel); only the first bytes are checked, so a JPEG header plus filler is enough.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF test bytes")]);

const DEFAULT_PROFILE = {
  name: "Library System",
  tagline: null,
  address: null,
  contactEmail: null,
  contactPhone: null,
  logoUrl: null,
};
const logoPattern = /^\/api\/public\/company\/logo\?v=\d+$/;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("company profile", () => {
  it("GET /public/company needs no login and starts with the default name", async () => {
    const res = await request(app).get("/api/public/company");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_PROFILE);
  });

  it("falls back to the defaults when the row is missing, and saving recreates it", async () => {
    await prisma.companyProfile.deleteMany();
    expect((await request(app).get("/api/public/company")).body).toEqual(DEFAULT_PROFILE);
    expect((await request(app).get("/api/public/company/logo")).status).toBe(404);
    const { agent } = await loginAs(["company.update"]);
    const res = await agent.put("/api/company").send({ name: "St. Luke Parish Library" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("St. Luke Parish Library");
    expect(await prisma.companyProfile.count()).toBe(1);
  });

  it("only one row can exist (CHECK id = 1)", async () => {
    await expect(prisma.companyProfile.create({ data: { id: 2 } })).rejects.toThrow();
  });

  it("PUT /company needs company.update; the default Staff role does not have it", async () => {
    const staff = (await loginAs("staff")).agent;
    const denied = await staff.put("/api/company").send({ name: "Hacked" });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    expect((await staff.put("/api/company/logo").send({ mimeType: "image/png", data: PNG.toString("base64") })).status).toBe(403);
    expect((await staff.delete("/api/company/logo").send({})).status).toBe(403);
    expect((await request(app).get("/api/public/company")).body.name).toBe("Library System");
  });

  it("saves name and contact details: trimmed, empty → null, omitted fields unchanged", async () => {
    const { agent } = await loginAs(["company.update"]);
    const res = await agent.put("/api/company").send({
      name: "  St. Luke Parish Library ",
      tagline: "Books for everyone",
      address: "123 Rizal St.\nQuezon City",
      contactEmail: " Library@StLuke.PH ",
      contactPhone: "0917 555 0000",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: "St. Luke Parish Library",
      tagline: "Books for everyone",
      address: "123 Rizal St.\nQuezon City",
      contactEmail: "library@stluke.ph",
      contactPhone: "0917 555 0000",
      logoUrl: null,
    });
    expect((await request(app).get("/api/public/company")).body).toEqual(res.body);

    const partial = await agent.put("/api/company").send({ name: "St. Luke Library", tagline: "", contactPhone: null });
    expect(partial.body).toMatchObject({ name: "St. Luke Library", tagline: null, contactPhone: null, address: "123 Rizal St.\nQuezon City" });
  });

  it("validates the details", async () => {
    const { agent } = await loginAs(["company.update"]);
    const cases: [object, (string | number)[]][] = [
      [{}, ["name"]],
      [{ name: "   " }, ["name"]],
      [{ name: "x".repeat(121) }, ["name"]],
      [{ name: "Two\nlines" }, ["name"]],
      [{ name: "OK", tagline: "x".repeat(201) }, ["tagline"]],
      [{ name: "OK", address: "x".repeat(301) }, ["address"]],
      [{ name: "OK", contactEmail: "not-an-email" }, ["contactEmail"]],
      [{ name: "OK", contactPhone: "x".repeat(61) }, ["contactPhone"]],
    ];
    for (const [body, path] of cases) {
      const res = await agent.put("/api/company").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.issues[0].path).toEqual(path);
    }
  });

  it("uploads, serves (cached per version), replaces and removes the logo", async () => {
    const { agent } = await loginAs(["company.update"]);
    const set = await agent.put("/api/company/logo").send({ mimeType: "image/png", data: PNG.toString("base64") });
    expect(set.status).toBe(200);
    expect(set.body.logoUrl).toMatch(logoPattern);
    expect((await request(app).get("/api/public/company")).body.logoUrl).toBe(set.body.logoUrl);

    // Public, no login. A versioned URL is immutable; the bare URL must be revalidated.
    const img = await request(app).get(set.body.logoUrl).responseType("blob");
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(img.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);
    expect((await request(app).get("/api/public/company/logo")).headers["cache-control"]).toBe("no-cache");

    // Replacing changes ?v=; a data URL of the stated type is accepted too.
    await wait(5);
    const replaced = await agent.put("/api/company/logo").send({ mimeType: "image/jpeg", data: `data:image/jpeg;base64,${JPEG.toString("base64")}` });
    expect(replaced.status).toBe(200);
    expect(replaced.body.logoUrl).not.toBe(set.body.logoUrl);
    const jpeg = await request(app).get(replaced.body.logoUrl).responseType("blob");
    expect(jpeg.headers["content-type"]).toBe("image/jpeg");

    // Editing the details keeps the logo.
    expect((await agent.put("/api/company").send({ name: "Renamed" })).body.logoUrl).toMatch(logoPattern);

    const removed = await agent.delete("/api/company/logo").send({});
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ name: "Renamed", logoUrl: null });
    const gone = await request(app).get("/api/public/company/logo");
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe("NOT_FOUND");
    expect((await agent.delete("/api/company/logo").send({})).status).toBe(200); // no logo is fine
  });

  it("rejects pictures that are not what they claim, other types, bad base64 and pictures over 512 KB", async () => {
    const { agent } = await loginAs(["company.update"]);
    const put = (body: object) => agent.put("/api/company/logo").send(body);

    const mismatch = await put({ mimeType: "image/jpeg", data: PNG.toString("base64") });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe("INVALID_IMAGE");
    const html = await put({ mimeType: "image/png", data: Buffer.from("<script>alert(1)</script>").toString("base64") });
    expect(html.body.error.code).toBe("INVALID_IMAGE");
    expect((await put({ mimeType: "image/png", data: "not base64!" })).body.error.code).toBe("INVALID_IMAGE");
    expect((await put({ mimeType: "image/png", data: "" })).status).toBe(400);
    const svg = await put({ mimeType: "image/svg+xml", data: PNG.toString("base64") });
    expect(svg.status).toBe(400);
    expect(svg.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { issues: [{ path: ["mimeType"] }] } });

    const big = Buffer.concat([PNG, Buffer.alloc(512 * 1024)]);
    const tooBig = await put({ mimeType: "image/png", data: big.toString("base64") });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe("IMAGE_TOO_LARGE");
    // Exactly 512 KB is fine.
    const max = Buffer.concat([PNG, Buffer.alloc(512 * 1024 - PNG.length)]);
    expect((await put({ mimeType: "image/png", data: max.toString("base64") })).status).toBe(200);
    // Bodies over the route's 1mb JSON limit never reach the service.
    const huge = await put({ mimeType: "image/png", data: "A".repeat(1100 * 1024) });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("other routes keep the 100kb body limit", async () => {
    const { agent } = await loginAs(["company.update"]);
    const res = await agent.put("/api/company").send({ name: "OK", address: "x".repeat(150 * 1024) });
    expect(res.status).toBe(413);
  });
});
