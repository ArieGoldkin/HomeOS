import { describe, expect, it, vi } from "vitest";
import { TransientError } from "../../src/core/errors.ts";
import { GmailApiError, httpGmailClient } from "../../src/google/gmail.ts";

// Neutral placeholder — not a real Google access-token shape (ya29.*).
const TOKEN = "tok-123";

// Gmail's wire body uses base64url for part data; encode fixtures the same way the client decodes them.
const b64url = (s: string) => Buffer.from(s, "utf-8").toString("base64url");

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const errJson = (status: number, body: unknown = {}) =>
  ({ ok: false, status, json: async () => body }) as unknown as Response;

// The shape the client passes as fetch's 2nd arg — headers are [name,value] tuples (secret-scanner-safe).
type Init = { method: string; headers: Array<[string, string]> };
const authOf = (init: Init) => new Headers(init.headers).get("Authorization");

const GMAIL_MESSAGES = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

describe("httpGmailClient.list", () => {
  it("GETs the messages endpoint with q + maxResults + Bearer, and maps messages[] → refs", async () => {
    const fetchImpl = vi.fn((_url: string, _init: Init) =>
      Promise.resolve(
        okJson({
          messages: [
            { id: "a1", threadId: "t1" },
            { id: "a2", threadId: "t2" },
          ],
          resultSizeEstimate: 2,
        }),
      ),
    );
    const refs = await httpGmailClient(fetchImpl as unknown as typeof fetch).list(
      TOKEN,
      "newer_than:7d",
      10,
    );

    const [url, init] = fetchImpl.mock.calls[0]!;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(GMAIL_MESSAGES);
    expect(u.searchParams.get("q")).toBe("newer_than:7d");
    expect(u.searchParams.get("maxResults")).toBe("10");
    expect(init.method).toBe("GET");
    expect(authOf(init)).toBe("Bearer tok-123");
    expect(refs).toEqual([
      { id: "a1", threadId: "t1" },
      { id: "a2", threadId: "t2" },
    ]);
  });

  it("returns [] when the inbox has no matching messages (no `messages` key)", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okJson({ resultSizeEstimate: 0 })));
    const refs = await httpGmailClient(fetchImpl as unknown as typeof fetch).list(TOKEN, "q", 10);
    expect(refs).toEqual([]);
  });

  it("classifies 429 as transient (retryable, row stays pending)", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(errJson(429)));
    await expect(
      httpGmailClient(fetchImpl as unknown as typeof fetch).list(TOKEN, "q", 10),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("classifies 5xx as transient", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(errJson(503)));
    await expect(
      httpGmailClient(fetchImpl as unknown as typeof fetch).list(TOKEN, "q", 10),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("classifies a network-level throw as transient (a blip must replay, not look permanent)", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("ECONNRESET")));
    await expect(
      httpGmailClient(fetchImpl as unknown as typeof fetch).list(TOKEN, "q", 10),
    ).rejects.toBeInstanceOf(TransientError);
  });
});

describe("httpGmailClient.get", () => {
  it("GETs message?format=full with Bearer, extracts Subject + decodes the text/plain part", async () => {
    const msg = {
      id: "m1",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "a@b.test" },
          { name: "Subject", value: "פגישה מחר" },
        ],
        body: { data: b64url("תזכורת: פגישה ביום שלישי") },
      },
    };
    const fetchImpl = vi.fn((_url: string, _init: Init) => Promise.resolve(okJson(msg)));
    const out = await httpGmailClient(fetchImpl as unknown as typeof fetch).get(TOKEN, "m1");

    const [url, init] = fetchImpl.mock.calls[0]!;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${GMAIL_MESSAGES}/m1`);
    expect(u.searchParams.get("format")).toBe("full");
    expect(authOf(init)).toBe("Bearer tok-123");
    expect(out).toEqual({ id: "m1", subject: "פגישה מחר", bodyText: "תזכורת: פגישה ביום שלישי" });
  });

  it("prefers the text/plain part inside a nested multipart/alternative (case-insensitive Subject)", async () => {
    const msg = {
      id: "m2",
      payload: {
        mimeType: "multipart/alternative",
        headers: [{ name: "subject", value: "lower-case header" }],
        parts: [
          { mimeType: "text/plain", headers: [], body: { data: b64url("the plain body") } },
          { mimeType: "text/html", headers: [], body: { data: b64url("<p>the html body</p>") } },
        ],
      },
    };
    const fetchImpl = vi.fn(() => Promise.resolve(okJson(msg)));
    const out = await httpGmailClient(fetchImpl as unknown as typeof fetch).get(TOKEN, "m2");
    expect(out.subject).toBe("lower-case header");
    expect(out.bodyText).toBe("the plain body");
  });

  it("falls back to stripped text/html when there is no text/plain part", async () => {
    const msg = {
      id: "m3",
      payload: {
        mimeType: "multipart/alternative",
        headers: [{ name: "Subject", value: "html only" }],
        parts: [
          {
            mimeType: "text/html",
            headers: [],
            body: { data: b64url("<div>Hello&nbsp;<b>World</b></div>") },
          },
        ],
      },
    };
    const fetchImpl = vi.fn(() => Promise.resolve(okJson(msg)));
    const out = await httpGmailClient(fetchImpl as unknown as typeof fetch).get(TOKEN, "m3");
    expect(out.bodyText).toBe("Hello World");
  });

  it("degrades to empty subject + body when no text part and no Subject header are present", async () => {
    const msg = {
      id: "m4",
      payload: {
        mimeType: "multipart/mixed",
        headers: [],
        parts: [{ mimeType: "image/png", headers: [], body: { attachmentId: "x" } }],
      },
    };
    const fetchImpl = vi.fn(() => Promise.resolve(okJson(msg)));
    const out = await httpGmailClient(fetchImpl as unknown as typeof fetch).get(TOKEN, "m4");
    expect(out).toEqual({ id: "m4", subject: "", bodyText: "" });
  });

  it("classifies 5xx as transient and a 4xx as a permanent GmailApiError", async () => {
    const transient = vi.fn(() => Promise.resolve(errJson(500)));
    await expect(
      httpGmailClient(transient as unknown as typeof fetch).get(TOKEN, "m1"),
    ).rejects.toBeInstanceOf(TransientError);

    const permanent = vi.fn(() =>
      Promise.resolve(errJson(401, { error: { message: "Invalid Credentials" } })),
    );
    await expect(
      httpGmailClient(permanent as unknown as typeof fetch).get(TOKEN, "m1"),
    ).rejects.toBeInstanceOf(GmailApiError);
  });
});
