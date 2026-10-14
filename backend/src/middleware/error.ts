import { Response, NextFunction } from "express";
import { ZodError } from "zod";
import { RequestWithId } from "./logger.js";

export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public details?: unknown;

  constructor(message: string, statusCode = 400, code = "BAD_REQUEST", details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function errorHandler(
  err: unknown,
  req: RequestWithId,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) {
  const requestId = req.id || "unknown";

  if (err instanceof ZodError) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Input validation failed",
      details: err.flatten().fieldErrors,
      requestId,
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
      details: err.details,
      requestId,
    });
  }

  const errorObj = err as Error;
  console.error(`[ERROR] [${requestId}] Unhandled exception:`, errorObj?.stack || err);

  return res.status(500).json({
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected server error occurred",
    details: process.env.NODE_ENV === "development" ? errorObj?.message : undefined,
    requestId,
  });
}
