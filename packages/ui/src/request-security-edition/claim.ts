import type { ICodingPlanSubscriptionService } from "@zcode/services";
import type { RequestVerificationProof } from "@zcode/shared";
import { prewarmCaptchaScript, runInteractiveCaptcha } from "./captcha-runtime.js";

/** 3.16 ETt 移植：领取入口可见时预取 SDK 脚本，点击领取时省一次脚本下载。 */
export function useRequestVerificationPrewarm(visible: boolean): void {
  if (visible) prewarmCaptchaScript();
}

/**
 * 3.16 DTt 移植：先取服务端 captcha 配置，再跑交互式验证产出凭据。
 * 配置缺失/停用/不完整或凭据为空时返回 undefined——绝不发送裸 claim，
 * 否则服务端以 “captcha verify failed” 拒绝（bug zai-org/feedback#849，
 * 3.17.x 源码把该校验桩成空实现导致 2026-11-03 起全部领取失败）。
 */
export async function prepareRequestVerificationClaim(
  service: ICodingPlanSubscriptionService,
  signal: AbortSignal,
  onVerifying: () => void,
): Promise<RequestVerificationProof | undefined> {
  signal.throwIfAborted();
  onVerifying();
  // 3.16 的配置缓存对错误按 null 处理：取不到配置视为无交互，取消而非裸发。
  const config = await service.getRequestVerificationConfig().catch(() => null);
  signal.throwIfAborted();
  if (!config || config.enabled === false || !config.region || !config.prefix || !config.sceneId)
    return undefined;
  const captchaVerifyParam = await runInteractiveCaptcha(config, signal);
  signal.throwIfAborted();
  if (!captchaVerifyParam.trim()) return undefined;
  return {
    captchaVerifyParam,
    ...(config.region ? { captchaRegion: config.region } : {}),
  };
}
