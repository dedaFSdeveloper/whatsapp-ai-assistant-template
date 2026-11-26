import express, { type Request, type Response } from "express";
import type { Logger } from "pino";
import type { ConversationService } from "./core/conversation.js";
import type { Debouncer } from "./core/debouncer.js";
import type { MessageDeduper } from "./core/dedupe.js";
import type { ConversationStore } from "./store/types.js";
import { extractMessages, isValidSignature, verifySubscription } from "./whatsapp/webhook.js";

export interface AppDeps {
  verifyToken: string;
  appSecret?: string;
  adminToken?: string;
  deduper: MessageDeduper;
  debouncer: Debouncer<string>;
  conversations: ConversationService;
  store: ConversationStore;
  logger: Pick<Logger, "info" | "warn" | "error">;
  /** Extra checks for /health (e.g. Redis ping). */
  healthChecks?: Record<string, () => Promise<boolean>>;
}

type RawBodyRequest = Request & { rawBody?: Buffer };

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    }),
  );

  app.get("/health", async (_req, res) => {
    const checks: Record<string, boolean> = {};
    for (const [name, check] of Object.entries(deps.healthChecks ?? {})) {
      checks[name] = await check().catch(() => false);
    }
    const ok = Object.values(checks).every(Boolean);
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", checks, uptime: Math.round(process.uptime()) });
  });

  // Meta calls this once when you register the webhook URL.
  app.get("/webhook", (req, res) => {
    const challenge = verifySubscription(req.query, deps.verifyToken);
    if (challenge === null) {
      res.sendStatus(403);
      return;
    }
    res.status(200).type("text/plain").send(challenge);
  });

  app.post("/webhook", (req: RawBodyRequest, res: Response) => {
    if (deps.appSecret) {
      const signature = req.header("x-hub-signature-256");
      if (!req.rawBody || !isValidSignature(req.rawBody, signature, deps.appSecret)) {
        res.sendStatus(401);
        return;
      }
    }

    // Answer right away: Meta retries slow deliveries, and the LLM call can take seconds.
    res.sendStatus(200);

    for (const message of extractMessages(req.body)) {
      if (!deps.deduper.isFirstSeen(message.id)) continue;
      deps.debouncer.push(message.from, message.text);
    }
  });

  const requireAdmin = (req: Request, res: Response): boolean => {
    if (!deps.adminToken || req.header("authorization") !== `Bearer ${deps.adminToken}`) {
      res.sendStatus(deps.adminToken ? 401 : 404);
      return false;
    }
    return true;
  };

  app.get("/admin/handoffs", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const handoffs = await deps.store.listHandoffs();
    res.json(handoffs.map((c) => ({ waId: c.waId, handoff: c.handoff, lead: c.lead, updatedAt: c.updatedAt })));
  });

  app.post("/admin/conversations/:waId/release", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const released = await deps.conversations.releaseHandoff(req.params.waId as string);
    res.status(released ? 200 : 404).json({ released });
  });

  return app;
}
