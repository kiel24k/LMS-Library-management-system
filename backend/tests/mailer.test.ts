import { afterEach, describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { senderFor } from "../src/lib/mailer.js";

// `env` is read once at start-up; these tests swap the mail settings in place and put them back afterwards.
const mutableEnv = env as { -readonly [K in keyof typeof env]: (typeof env)[K] };
const original = { mailFrom: env.mailFrom, smtp: env.smtp };

afterEach(() => {
  mutableEnv.mailFrom = original.mailFrom;
  mutableEnv.smtp = original.smtp;
});

const smtp = (user?: string) => ({ host: "smtp.example.org", port: 587, secure: false, user, pass: "x" });

describe("email sender", () => {
  it("defaults to the company name at no-reply@localhost", () => {
    mutableEnv.mailFrom = undefined;
    mutableEnv.smtp = undefined;
    expect(senderFor("St. Luke Library")).toEqual({ name: "St. Luke Library", address: "no-reply@localhost" });
  });

  it("uses MAIL_FROM as is when it holds an address", () => {
    mutableEnv.mailFrom = '"Parish Library" <library@example.org>';
    mutableEnv.smtp = smtp("account@example.org");
    expect(senderFor("St. Luke Library")).toBe('"Parish Library" <library@example.org>');
  });

  it("sends a name-only MAIL_FROM from the SMTP account", () => {
    mutableEnv.mailFrom = "Library Management";
    mutableEnv.smtp = smtp("account@example.org");
    expect(senderFor("St. Luke Library")).toEqual({ name: "Library Management", address: "account@example.org" });
  });

  it("sends from the SMTP account under the company name when MAIL_FROM is unset", () => {
    mutableEnv.mailFrom = undefined;
    mutableEnv.smtp = smtp("account@example.org");
    expect(senderFor("St. Luke Library")).toEqual({ name: "St. Luke Library", address: "account@example.org" });
  });

  it("ignores an SMTP login that is not an email address", () => {
    mutableEnv.mailFrom = "Library Management";
    mutableEnv.smtp = smtp("apikey");
    expect(senderFor("St. Luke Library")).toEqual({ name: "Library Management", address: "no-reply@localhost" });
  });
});
