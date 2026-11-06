export type RequestVerificationConfig = Readonly<{
  enabled?: boolean;
  region?: string;
  prefix?: string;
  sceneId?: string;
  mode?: string;
  language?: string;
  captchaLogoImg?: string;
  skipModelRequest?: boolean;
}>;

/** 领取（claim）链路的校验凭据：Aliyun captcha 回调产出的 verify 参数。 */
export interface RequestVerificationProof {
  captchaVerifyParam: string;
  captchaRegion?: string;
}

export type RequestVerificationClientConfig = Readonly<Record<string, unknown>>;

export const requestVerificationReasons = ["model-request", "captcha-retry"] as const;
export type RequestVerificationReason = (typeof requestVerificationReasons)[number];
export const requestVerificationTimeoutMessage =
  "Provider runtime headers request timed out. Please send your message again.";
export const REQUEST_VERIFICATION_REQUIRED = "request_verification_unavailable";

function readStringField(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value.trim() : "";
}

export function readRequestVerificationConfig(
  configs: RequestVerificationClientConfig | null | undefined,
): RequestVerificationConfig | null {
  // 仅 claim 链路随本次修复恢复；model-request 交互策略保持 no-op（见文件尾注释）。
  return readValidatedRequestVerificationConfig(configs);
}

/**
 * 远端 configs 中的 `captcha` 条目 → 客户端配置。
 * 缺条目或 region/prefix/sceneId 不齐时返回 null：与 3.16 行为一致，
 * 由调用方按“无交互”处理；服务端仍会把裸 claim 拒绝（fail-closed 在服务端）。
 */
export function readValidatedRequestVerificationConfig(
  configs: RequestVerificationClientConfig | null | undefined,
): RequestVerificationConfig | null {
  const entry = configs?.["captcha"];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const raw = entry as Record<string, unknown>;
  const region = readStringField(raw, "region");
  const prefix = readStringField(raw, "prefix");
  const sceneId = readStringField(raw, "sceneId");
  if (!region || !prefix || !sceneId) return null;
  const skipModelRequest = raw["skip_model_request"];
  return {
    ...raw,
    region,
    prefix,
    sceneId,
    ...(typeof raw["enabled"] === "boolean" ? { enabled: raw["enabled"] } : {}),
    ...(typeof skipModelRequest === "boolean" ? { skipModelRequest } : {}),
  };
}

/** 3.16 原实现：verify 参数进 `X-Aliyun-Captcha-Verify-Param`，区域可选。 */
export function requestVerificationClaimHeaders(
  proof: RequestVerificationProof,
): Record<string, string> {
  return {
    "X-Aliyun-Captcha-Verify-Param": proof.captchaVerifyParam,
    ...(proof.captchaRegion ? { "X-Aliyun-Captcha-Verify-Region": proof.captchaRegion } : {}),
  };
}

export function withoutRequestVerificationHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  return { ...headers };
}

export function allowRequestVerificationHeaders(
  _headers: Record<string, string>,
): Record<string, string> {
  return {};
}

export function requiresRequestVerification(
  _access: { mode: string } | undefined,
  _config?: RequestVerificationConfig | null,
): boolean {
  return false;
}

export function isRequestVerificationMessage(_message: string): boolean {
  return false;
}

export function summarizeRequestVerificationHeaders(
  _headers: Record<string, unknown>,
): Record<string, unknown> {
  return {};
}

export function requestVerificationDiagnostics(
  _input: Record<string, unknown>,
): Record<string, unknown> {
  return {};
}

/**
 * `requestVerificationInteractionAvailable` 与 `requiresRequestVerification` 保持 no-op：
 * 它们只作用于 model-request 运行时头链路（zcodeAgentService），与领取（claim）链路无关；
 * 恢复它们需要完整移植 3.16 的 traceless 预校验与 certifyId 状态机，超出本修复范围。
 */
export const requestVerificationInteractionAvailable = false;
