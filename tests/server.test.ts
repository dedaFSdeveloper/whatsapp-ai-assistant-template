import { createHmac } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationService } from "../src/core/conversation.js";
import { Debouncer } from "../src/core/debouncer.js";
import { MessageDeduper } from "../src/core/dedupe.js";
import { NoopEventSink } from "../src/core/events.js";
import { createApp } from "../src/server.js";
import { InMemoryConversationStore } from "../src/store/memory.js";
import { DryRunSender } from "../src/whatsapp/sender.js";
import { business, FakeLLM, silentLogger, turn, webhookPayload } from "./helpers.js";

const SECRET = "test-app-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

function setup(options: { appSecret?: string; adminToken?: string } = {}) {
  const store = new InMemoryConversationStore();
  const sender = new DryRunSender();
  const llm = new FakeLLM([turn({ reply: "Hello from the clinic" })]);
  const conversations = new ConversationService({
    store,
    llm,
    sender,
    events: new NoopEventSink(),
    business,
    historyLimit: 10,
    logger: silentLogger,
  });
  const debouncer = new Debouncer<string>({ waitMs: 3_500, maxWaitMs: 15_000 }, (waId, texts) =>
    conversations.handle(waId, texts).then(() => undefined),
  );
  const app = createApp({
    verifyToken: "verify-me",
    deduper: new MessageDeduper(60_000),
    debouncer,
    conversations,
    store,
    logger: silentLogger,
    ...options,
  });
  return { app, sender, llm, debouncer };
}

describe("HTTP server", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("GET /health reports ok", async () => {
    const res = await request(setup().app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("completes the webhook verification handshake", async () => {
    const { app } = setup();
    const ok = await request(app)
      .get("/webhook")
      .query({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "12345" });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("12345");

    const bad = await request(app)
      .get("/webhook")
      .query({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "12345" });
    expect(bad.status).toBe(403);
  });

  it("acks with 200 at once, dedupes retries and answers once after the debounce", async () => {
    const { app, sender, llm } = setup();
    const payload = webhookPayload([{ id: "wamid.A", from: "5491100000000", text: "hi" }]);

    const first = await request(app).post("/webhook").send(payload);
    const retry = await request(app).post("/webhook").send(payload);
    await request(app)
      .post("/webhook")
      .send(webhookPayload([{ id: "wamid.B", from: "5491100000000", text: "are you open today?" }]));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(llm.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3_500);
    await vi.waitFor(() => expect(sender.sent).toHaveLength(1));
    expect(llm.calls[0]?.history).toEqual([{ role: "user", content: "hi\nare you open today?" }]);
  });

  it("ignores status updates", async () => {
    const { app, debouncer } = setup();
    const res = await request(app)
      .post("/webhook")
      .send({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.X", status: "read" }] } }] }],
      });
    expect(res.status).toBe(200);
    expect(debouncer.pendingKeys).toBe(0);
  });

  it("rejects unsigned payloads when an app secret is configured", async () => {
    const { app, debouncer } = setup({ appSecret: SECRET });
    const body = JSON.stringify(webhookPayload([{ id: "wamid.S", from: "5491100000000", text: "hi" }]));

    const unsigned = await request(app).post("/webhook").set("content-type", "application/json").send(body);
    expect(unsigned.status).toBe(401);

    const signed = await request(app)
      .post("/webhook")
      .set("content-type", "application/json")
      .set("x-hub-signature-256", sign(body))
      .send(body);
    expect(signed.status).toBe(200);
    expect(debouncer.pendingKeys).toBe(1);
  });

  it("protects admin routes with a bearer token", async () => {
    const { app } = setup({ adminToken: "admin-secret" });
    expect((await request(app).get("/admin/handoffs")).status).toBe(401);
    const res = await request(app).get("/admin/handoffs").set("authorization", "Bearer admin-secret");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("hides admin routes when no admin token is configured", async () => {
    expect((await request(setup().app).get("/admin/handoffs")).status).toBe(404);
  });
});
