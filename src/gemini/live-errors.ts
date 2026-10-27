export function liveErrorMessage(code?: string): string {
  const messages: Record<string, string> = {
    UnsupportedTab: 'Chế độ Live chỉ hỗ trợ trên YouTube.',
    MissingApiKey: 'Nhập Gemini API key trong cài đặt extension.',
    AuthenticationError: 'API key không hợp lệ hoặc chưa có quyền truy cập model Live.',
    QuotaExceeded: 'Gemini đã hết hạn mức. Chờ rồi bật lại Live.',
    LiveConfigurationError: 'Gemini từ chối cấu hình hoặc model Live đang chọn. Chọn lại model và kiểm tra kết nối.',
    LiveReadyTimeout: 'Gemini Live chưa xác nhận kết nối sau 35 giây. Kiểm tra kết nối rồi bật lại Live.',
    ServiceUnavailable: 'Dịch vụ Gemini Live đang gặp lỗi. Chờ rồi bật lại Live.',
    CapturePermissionDenied: 'Chrome chưa cho phép capture âm thanh tab. Mở YouTube và bật Live từ extension.',
    CaptureEnded: 'Chrome đã dừng capture âm thanh tab. Bật lại Live trên tab YouTube.',
    LiveAudioError: 'Không khởi tạo được capture hoặc phát audio trong Chrome. Reload extension và tab YouTube rồi bật lại Live.',
    InvalidServerMessage: 'Gemini Live trả về dữ liệu hoặc định dạng audio không hợp lệ.',
    InputBackpressure: 'Audio gửi tới Gemini bị nghẽn. Dừng rồi bật lại Live.',
    OutputBackpressure: 'Giọng Gemini trả về bị dồn quá nhiều. Dừng rồi bật lại Live.',
    GeminiDisconnected: 'Kết nối WebSocket tới Gemini Live bị ngắt sau nhiều lần thử lại. Kiểm tra mạng rồi bật lại Live.',
  };
  return messages[code || ''] || 'Không bật được Gemini Live. Reload extension và kiểm tra lại cấu hình.';
}

export function classifyLiveClose(code: number, reason: string): string | undefined {
  if (/quota|resource[._ ]exhausted|rate.?limit/i.test(reason)) return 'QuotaExceeded';
  if (/api.?key|unauthenticated|permission|forbidden|access.?denied/i.test(reason)) return 'AuthenticationError';
  if (code === 1007 || code === 1008 ||
      /not[._ ]found|invalid[._ ]argument|invalid (?:json|payload)|unknown (?:name|field)|not supported|unsupported|not implemented/i.test(reason))
    return 'LiveConfigurationError';
  return undefined;
}
