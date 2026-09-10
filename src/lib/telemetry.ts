import type { NextFunction, Request, Response } from "express";
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { TraceExporter as GoogleCloudTraceExporter } from "@google-cloud/opentelemetry-cloud-trace-exporter";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { Logger } from "pino";

interface TelemetryLifecycle {
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
  middleware: (req: Request, res: Response, next: NextFunction) => void;
}

const ATTR_HTTP_METHOD = "http.request.method";
const ATTR_HTTP_ROUTE = "http.route";
const ATTR_HTTP_STATUS_CODE = "http.response.status_code";
const ATTR_URL_PATH = "url.path";
const ATTR_REQUEST_ID = "ai_gateway.request_id";
const ATTR_TENANT_ID = "ai_gateway.tenant_id";

export function createTelemetryLifecycle(logger: Logger): TelemetryLifecycle {
  const enabled =
    process.env.OTEL_ENABLED === "true" ||
    process.env.OTEL_ENABLED === "1" ||
    process.env.OTEL_ENABLED === "yes";
  const serviceName = process.env.OTEL_SERVICE_NAME || "ai-gateway";
  const serviceVersion = process.env.OTEL_SERVICE_VERSION || process.env.npm_package_version;
  const tracer = trace.getTracer(serviceName, serviceVersion);

  if (!enabled) {
    return {
      start: async () => {
        logger.info("OpenTelemetry disabled (set OTEL_ENABLED=true to enable)");
      },
      shutdown: async () => undefined,
      middleware: (_req, _res, next) => next(),
    };
  }

  const sdk = new NodeSDK({
    traceExporter: new GoogleCloudTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": {
          enabled: false,
        },
      }),
    ],
    serviceName,
  });

  let started = false;

  return {
    start: async () => {
      try {
        await sdk.start();
        started = true;
        logger.info(
          {
            serviceName,
            serviceVersion,
          },
          "OpenTelemetry tracing enabled",
        );
      } catch (error) {
        logger.error({ err: error }, "failed to start OpenTelemetry");
      }
    },
    shutdown: async () => {
      if (!started) {
        return;
      }

      try {
        await sdk.shutdown();
        logger.info("OpenTelemetry shutdown complete");
      } catch (error) {
        logger.error({ err: error }, "OpenTelemetry shutdown failed");
      }
    },
    middleware: (req, res, next) => {
      const parentContext = propagation.extract(
        context.active(),
        req.headers as Record<string, string>,
      );
      const span = tracer.startSpan(
        `${req.method} ${req.path}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            [ATTR_HTTP_METHOD]: req.method,
            [ATTR_URL_PATH]: req.path,
          },
        },
        parentContext,
      );

      const tenantHeader = req.headers["x-tenant-id"];
      const tenantId =
        typeof tenantHeader === "string"
          ? tenantHeader
          : Array.isArray(tenantHeader) && tenantHeader.length > 0
            ? tenantHeader[0]
            : undefined;
      if (tenantId) {
        span.setAttribute(ATTR_TENANT_ID, tenantId);
      }

      if (req.id) {
        span.setAttribute(ATTR_REQUEST_ID, String(req.id));
      }

      res.on("finish", () => {
        const routePath = (req.route as { path?: string } | undefined)?.path;
        if (routePath) {
          span.setAttribute(ATTR_HTTP_ROUTE, routePath);
        }
        span.setAttribute(ATTR_HTTP_STATUS_CODE, res.statusCode);
        if (res.statusCode >= 500) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
          });
        } else {
          span.setStatus({
            code: SpanStatusCode.OK,
          });
        }
        span.end();
      });

      context.with(trace.setSpan(parentContext, span), next);
    },
  };
}
