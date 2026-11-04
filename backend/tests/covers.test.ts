import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { app, createBook, createLibrary, loginAs } from "./helpers.js";

// Tiny real pictures (1×1 pixel).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
// Only the first bytes are checked, so a JPEG header followed by filler is enough here.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF test bytes")]);

const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;
const coverPattern = (id: string) => new RegExp(`^/api/books/${id}/cover\\?v=\\d+$`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("book pictures", () => {
  it("sets, replaces and removes a picture; coverUrl follows in list and detail", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id, { title: "Noli" });
    expect((await agent.get(`/api/books/${book.id}`)).body.coverUrl).toBeNull();

    const set = await agent.put(`/api/books/${book.id}/cover`).send({ image: dataUrl("image/png", PNG) });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ id: book.id, title: "Noli", coverUrl: expect.stringMatching(coverPattern(book.id)) });
    const firstUrl: string = set.body.coverUrl;

    const img = await agent.get(firstUrl).responseType("blob");
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);

    expect((await agent.get(`/api/books/${book.id}`)).body.coverUrl).toBe(firstUrl);
    const list = await agent.get(`/api/books?libraryId=${lib.id}`);
    expect(list.body.data[0].coverUrl).toBe(firstUrl);

    // Replacing gives a new ?v= (so browsers fetch the new picture) and the new type.
    await wait(5);
    const replaced = await agent.put(`/api/books/${book.id}/cover`).send({ image: dataUrl("image/jpeg", JPEG) });
    expect(replaced.status).toBe(200);
    expect(replaced.body.coverUrl).toMatch(coverPattern(book.id));
    expect(replaced.body.coverUrl).not.toBe(firstUrl);
    const jpg = await agent.get(replaced.body.coverUrl).responseType("blob");
    expect(jpg.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.compare(jpg.body as Buffer, JPEG)).toBe(0);
    expect(await prisma.bookCover.count()).toBe(1);

    const webp = await agent.put(`/api/books/${book.id}/cover`).send({ image: dataUrl("image/webp", WEBP) });
    expect(webp.status).toBe(200);
    expect((await agent.get(`/api/books/${book.id}/cover`)).headers["content-type"]).toBe("image/webp");

    // Archived books keep their picture.
    const archived = await agent.patch(`/api/books/${book.id}`).send({ archived: true });
    expect(archived.body.coverUrl).toMatch(coverPattern(book.id));

    const removed = await agent.delete(`/api/books/${book.id}/cover`).send({});
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ id: book.id, coverUrl: null });
    const gone = await agent.get(`/api/books/${book.id}/cover`);
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe("NOT_FOUND");
    // Removing when there is no picture is fine.
    const again = await agent.delete(`/api/books/${book.id}/cover`).send({});
    expect(again.status).toBe(200);
    expect(again.body.coverUrl).toBeNull();
  });

  it("404s for an unknown book and requires login", async () => {
    const { agent } = await loginAs("staff");
    const put = await agent.put("/api/books/nope/cover").send({ image: dataUrl("image/png", PNG) });
    expect(put.status).toBe(404);
    expect(put.body.error.code).toBe("NOT_FOUND");
    expect((await agent.get("/api/books/nope/cover")).status).toBe(404);
    expect((await agent.delete("/api/books/nope/cover").send({})).status).toBe(404);

    const lib = await createLibrary();
    const book = await createBook(lib.id);
    await agent.put(`/api/books/${book.id}/cover`).send({ image: dataUrl("image/png", PNG) });
    expect((await request(app).get(`/api/books/${book.id}/cover`)).status).toBe(401);
  });

  it("rejects other types, bad base64 and bytes that do not match the type with INVALID_IMAGE", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id);
    const put = (image: unknown) => agent.put(`/api/books/${book.id}/cover`).send({ image });

    const bad = [
      dataUrl("image/gif", Buffer.from("GIF89a")),
      dataUrl("image/svg+xml", Buffer.from("<svg/>")),
      dataUrl("image/jpeg", PNG), // stated type does not match the first bytes
      dataUrl("image/png", JPEG),
      dataUrl("image/webp", Buffer.from("RIFF0000WAVEfmt ")),
      "data:image/png;base64,iVBORw0KGgo$AAAA", // not base64
      "data:image/png;base64,iVBORw0KGgoAAA", // length not a multiple of 4
      "data:image/png;base64,QR==", // non-canonical padding bits
      "data:image/png;base64,", // empty
      `data:image/png,${PNG.toString("base64")}`, // not base64-encoded
      PNG.toString("base64"), // not a data URL
    ];
    for (const image of bad) {
      const res = await put(image);
      expect(res.status, image.slice(0, 40)).toBe(400);
      expect(res.body.error.code).toBe("INVALID_IMAGE");
    }
    const missing = await agent.put(`/api/books/${book.id}/cover`).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("VALIDATION_ERROR");
    expect(missing.body.error.details.issues[0].path).toEqual(["image"]);
    expect((await put(123)).body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.bookCover.count()).toBe(0);
  });

  it("accepts up to 1 MB; larger → 413 IMAGE_TOO_LARGE; over 2mb of body → 413 PAYLOAD_TOO_LARGE", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id);
    const pngOf = (size: number) => Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(size - 8, 7)]);

    const max = await agent.put(`/api/books/${book.id}/cover`).send({ image: dataUrl("image/png", pngOf(1024 * 1024)) });
    expect(max.status).toBe(200);
    const big = await agent.put(`/api/books/${book.id}/cover`).send({ image: dataUrl("image/png", pngOf(1024 * 1024 + 1)) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("IMAGE_TOO_LARGE");
    const huge = await agent.put(`/api/books/${book.id}/cover`).send({ image: dataUrl("image/png", pngOf(1600 * 1024)) });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    // The 2mb limit is only for this route: other book requests keep 100kb.
    const notes = await agent.patch(`/api/books/${book.id}`).send({ notes: "y".repeat(110 * 1024) });
    expect(notes.status).toBe(413);
    expect(notes.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("requires a JSON body (415)", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id);
    const res = await agent.put(`/api/books/${book.id}/cover`).set("Content-Type", "image/png").send(PNG);
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect((await agent.delete(`/api/books/${book.id}/cover`)).status).toBe(415);
  });

  it("deleting the book deletes its picture", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id);
    await agent.put(`/api/books/${book.id}/cover`).send({ image: dataUrl("image/png", PNG) });
    expect(await prisma.bookCover.count()).toBe(1);
    expect((await agent.delete(`/api/books/${book.id}`).send({})).status).toBe(204);
    expect(await prisma.bookCover.count()).toBe(0);
  });

  it("public catalog shows pictures only through its own cover route", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary({ slug: "parish", publicFormEnabled: true });
    const book = await createBook(lib.id, { title: "Bible" });
    await agent.put(`/api/books/${book.id}/cover`).send({ image: dataUrl("image/png", PNG) });
    const res = await request(app).get("/api/public/libraries/parish/books");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(["author", "available", "callNumber", "category", "coverUrl", "id", "title"]);
    // Never the staff URL (which needs books.view) and never the bytes.
    expect(res.body.data[0].coverUrl).toMatch(new RegExp(`^/api/public/libraries/parish/books/${book.id}/cover\\?v=\\d+$`));
    expect(JSON.stringify(res.body)).not.toContain("/api/books/");
  });
});
