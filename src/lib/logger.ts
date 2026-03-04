import pino from "pino";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => {
    const headerValue = req.headers["x-request-id"];
    if (typeof headerValue === "string" && headerValue.trim()) {
      return headerValue;
    }

    if (
      Array.isArray(headerValue) &&
      headerValue.length > 0 &&
      headerValue[0]
    ) {
      return headerValue[0];
    }

    return randomUUID();
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) {
      return "error";
    }

    if (res.statusCode >= 400) {
      return "warn";
    }

    return "info";
  },
});
