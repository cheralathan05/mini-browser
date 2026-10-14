import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

export interface RequestWithId extends Request {
  id?: string;
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export function requestLogger(req: RequestWithId, res: Response, next: NextFunction) {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);

  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const logMessage = `[${new Date().toISOString()}] [${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
    if (res.statusCode >= 500) {
      console.error(logMessage);
    } else if (res.statusCode >= 400) {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  });

  next();
}

export const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[DEBUG] ${msg}`, ...args),
};
