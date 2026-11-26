import { pino, type Logger } from "pino";

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: ["req.headers.authorization", "*.accessToken", "*.apiKey"],
  });
}

/** Logs should not carry full customer phone numbers. */
export function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
}
