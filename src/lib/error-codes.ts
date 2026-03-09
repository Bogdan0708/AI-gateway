export const ErrorCodes = {
  routingUnsupportedProvider: "routing.unsupported_provider",
  routingProviderDisabled: "routing.provider_disabled",
  routingUnsupportedModel: "routing.unsupported_model",
  tenantRequired: "tenant.required",
  tenantMismatch: "tenant.mismatch",
  tenantUnknown: "tenant.unknown",
  tenantProviderDenied: "tenant.provider_denied",
  tenantModelDenied: "tenant.model_denied",
  tenantMaxTokensExceeded: "tenant.max_tokens_exceeded",
  concurrencyGlobalLimitReached: "concurrency.global_limit_reached",
  concurrencyTenantLimitReached: "concurrency.tenant_limit_reached",
  requestBodyTooLarge: "request.body_too_large",
  requestInvalidJson: "request.invalid_json",
  aiCompletionFailed: "ai.completion_failed",
  serverInternal: "server.internal_error",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
