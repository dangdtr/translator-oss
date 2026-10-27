import type { GeminiSettings } from './settings';
export type GeminiErrorCode =
  | 'MissingApiKey'
  | 'TextModelDisabled'
  | 'InvalidModel'
  | 'AuthenticationError'
  | 'QuotaExceeded'
  | 'ServiceUnavailable'
  | 'RequestFailed'
  | 'RequestTimeout'
  | 'LiveReadyTimeout'
  | 'LiveConfigurationError'
  | 'GeminiDisconnected'
  | 'InvalidServerMessage'
  | 'Aborted'
  | 'InvalidResponse'
  | 'InvalidAudioResponse'
  | 'InvalidInput';
const messages: Record<GeminiErrorCode, string> = {
  MissingApiKey: 'Vui lòng nhập Gemini API key.',
  TextModelDisabled:
    'Model dịch text đang tắt. Bật lại trong Settings để dịch trang/phụ đề; Gemini Live vẫn dùng được.',
  InvalidModel: 'Tên model Gemini không hợp lệ.',
  AuthenticationError: 'API key không hợp lệ hoặc chưa có quyền truy cập model.',
  QuotaExceeded: 'Gemini đã hết hạn mức. Vui lòng chờ rồi thử lại.',
  ServiceUnavailable: 'Gemini tạm thời không khả dụng.',
  RequestFailed: 'Không thể kết nối Gemini.',
  RequestTimeout: 'Gemini phản hồi quá lâu. Vui lòng thử lại.',
  LiveReadyTimeout: 'Gemini Live chưa xác nhận kết nối sau 35 giây. Kiểm tra mạng và thử lại.',
  LiveConfigurationError: 'Model Gemini Live không khả dụng hoặc cấu hình không được hỗ trợ.',
  GeminiDisconnected: 'Không thể kết nối Gemini Live. Kiểm tra mạng và thử lại.',
  InvalidServerMessage: 'Gemini Live trả về dữ liệu không hợp lệ.',
  Aborted: 'Đã hủy yêu cầu.',
  InvalidResponse: 'Gemini trả về dữ liệu không hợp lệ.',
  InvalidAudioResponse: 'Gemini trả về âm thanh không hợp lệ.',
  InvalidInput: 'Nội dung yêu cầu không hợp lệ.',
};
export class GeminiError extends Error {
  constructor(public readonly code: GeminiErrorCode) {
    super(messages[code]);
    this.name = 'GeminiError';
  }
}
let cooldownUntil = 0;
export async function generateContent(
  settings: GeminiSettings,
  model: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!settings.apiKey.trim()) throw new GeminiError('MissingApiKey');
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new GeminiError('InvalidModel');
  if (signal?.aborted) throw new GeminiError('Aborted');
  if (Date.now() < cooldownUntil) throw new GeminiError('QuotaExceeded');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (signal?.aborted) throw new GeminiError('Aborted');
    if (!response.ok) {
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After'));
        cooldownUntil =
          Date.now() +
          (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) * 1000 : 30_000);
        throw new GeminiError('QuotaExceeded');
      }
      throw new GeminiError(
        response.status === 401 || response.status === 403
          ? 'AuthenticationError'
          : response.status >= 500
            ? 'ServiceUnavailable'
            : 'RequestFailed',
      );
    }
    try {
      return await response.json();
    } catch {
      throw new GeminiError('InvalidResponse');
    }
  } catch (error) {
    if (timedOut) throw new GeminiError('RequestTimeout');
    if (signal?.aborted) throw new GeminiError('Aborted');
    if (error instanceof GeminiError) throw error;
    throw new GeminiError('RequestFailed');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
