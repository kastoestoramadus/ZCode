import type { RequestVerificationConfig } from "@zcode/shared";

/**
 * Aliyun captcha（验证码 2.0 popup 模式）最小运行时，按 3.16.3 发行版反混淆移植：
 * 脚本 URL、window.AliyunRequestVerificationConfig、init 参数与 3.16 相同；
 * 省略 traceless 设备预校验与 certifyId 去重（仅 model-request 链路需要），
 * claim 一律走交互式弹窗，用户本人完成验证（本应用不自动绕过任何验证）。
 */

const CAPTCHA_SCRIPT_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
const HOST_ELEMENT_ID = "zcode-request-verification-host";
const CAPTCHA_ELEMENT_ID = "zcode-request-verification-element";
const CAPTCHA_BUTTON_ID = "zcode-request-verification-button";
const CAPTCHA_INTERACTIVE_TIMEOUT_MS = 120_000;

export class CaptchaInteractiveRequiredError extends Error {
  readonly code = "CAPTCHA_INTERACTIVE_REQUIRED";
  constructor(message = "Captcha requires interactive verification.") {
    super(message);
    this.name = "CaptchaInteractiveRequiredError";
  }
}

interface AliyunCaptchaInstance {
  show?: () => void;
  refresh?: () => void;
  destroy?: () => void;
}

export interface AliyunCaptchaVerifyCallbackResult {
  captchaResult: boolean;
  bizResult: boolean;
}

interface AliyunCaptchaInitConfig {
  SceneId: string;
  mode: "popup";
  language?: string;
  captchaLogoImg?: string;
  showErrorTip: boolean;
  element: string;
  button: string;
  captchaVerifyCallback: (
    captchaVerifyParam: string,
  ) => Promise<AliyunCaptchaVerifyCallbackResult>;
  getInstance: (instance: AliyunCaptchaInstance | undefined) => void;
}

declare global {
  interface Window {
    initAliyunCaptcha?: (config: AliyunCaptchaInitConfig) => AliyunCaptchaInstance | undefined;
    AliyunRequestVerificationConfig?: { region: string; prefix: string };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadCaptchaScript(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined")
    return Promise.reject(new Error("Captcha requires browser environment."));
  if (typeof window.initAliyunCaptcha === "function") return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CAPTCHA_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => {
          existing.remove();
          reject(new Error("Failed to load captcha script."));
        },
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = CAPTCHA_SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        script.remove();
        scriptPromise = null;
        reject(new Error("Failed to load captcha script."));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** 3.16 pTt 移植：SDK 只认 cn/en；跟随浏览器语言，中文系一律 cn。 */
function languageKey(): string {
  const language =
    typeof navigator === "undefined" ? "" : navigator.language.toLowerCase();
  return language.startsWith("zh") ? "cn" : "en";
}

interface CaptchaHost {
  detach: () => void;
}

/** 挂载固定定位的宿主容器（3.16 Mwt/Nwt 移植）：element 供 SDK 渲染，button 供 popup 触发。 */
function ensureHost(): CaptchaHost {
  let host = document.getElementById(HOST_ELEMENT_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ELEMENT_ID;
    document.body.appendChild(host);
  }
  host.replaceChildren();
  const captchaElement = document.createElement("div");
  captchaElement.id = CAPTCHA_ELEMENT_ID;
  const captchaButton = document.createElement("button");
  captchaButton.id = CAPTCHA_BUTTON_ID;
  captchaButton.type = "button";
  host.append(captchaElement, captchaButton);
  return {
    detach: () => {
      host?.replaceChildren();
      host?.remove();
    },
  };
}

/** 预取 SDK 脚本（3.16 vTt/ETt 预热的脚本部分）；失败静默，点击领取时会重试。 */
export function prewarmCaptchaScript(): void {
  void loadCaptchaScript().catch(() => {});
}

/** 运行交互式验证，解析出 captchaVerifyParam；abort/超时/SDK 失败按对应错误抛出。 */
export async function runInteractiveCaptcha(
  config: RequestVerificationConfig,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  // 3.16 行为：SDK 脚本按该全局选择接入点（region/prefix），加载与 init 前都要就位。
  const endpoint = { region: config.region ?? "", prefix: config.prefix ?? "" };
  window.AliyunRequestVerificationConfig = endpoint;
  // The SDK reads its endpoint from window.AliyunCaptchaConfig (Aliyun captcha 2.0 docs); without it requests go to https://undefined.captcha-open.aliyuncs.com.
  (window as unknown as { AliyunCaptchaConfig?: typeof endpoint }).AliyunCaptchaConfig = endpoint;
  await loadCaptchaScript();
  signal.throwIfAborted();
  const host = ensureHost();
  let instance: AliyunCaptchaInstance | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        fn();
      };
      const onAbort = () =>
        settle(() => reject(signal.reason ?? new DOMException("Aborted", "AbortError")));
      const timeout = setTimeout(() => {
        settle(() => reject(new CaptchaInteractiveRequiredError()));
      }, CAPTCHA_INTERACTIVE_TIMEOUT_MS);
      signal.addEventListener("abort", onAbort, { once: true });
      const openPopup = () => {
        if (settled) return;
        const button = document.getElementById(CAPTCHA_BUTTON_ID);
        if (button instanceof HTMLButtonElement) button.click();
        else instance?.show?.();
      };
      try {
        window.initAliyunCaptcha?.({
          SceneId: config.sceneId ?? "",
          mode: "popup",
          language: languageKey(),
          showErrorTip: false,
          element: `#${CAPTCHA_ELEMENT_ID}`,
          button: `#${CAPTCHA_BUTTON_ID}`,
          captchaVerifyCallback: async (captchaVerifyParam: string) => {
            // 参数回传后即完成客户端职责；真实校验发生在服务端 claim 接口。
            settle(() => resolve(captchaVerifyParam));
            return { captchaResult: true, bizResult: true };
          },
          getInstance: (created) => {
            instance = created;
            // Click only once the SDK has built its instance; a click before that is dropped and the claim spins until the timeout.
            setTimeout(openPopup, 0);
          },
        });
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error(String(error))));
        return;
      }
    });
  } finally {
    host.detach();
  }
}
