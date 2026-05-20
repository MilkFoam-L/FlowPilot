// phone-sms/providers/custom-sms.js - 自定义手机号接码适配层
(function attachCustomSmsProvider(root, factory) {
  root.PhoneSmsCustomSmsProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createCustomSmsProviderModule() {
  const PROVIDER_ID = 'custom-sms';
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;

  function normalizePhoneDigits(value = '') {
    let digits = String(value || '').replace(/\D+/g, '');
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }
    if (digits.startsWith('1') && digits.length > 11) {
      digits = digits.slice(1);
    }
    return digits;
  }

  function normalizePhoneNumber(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    return raw;
  }

  function normalizePhoneEntry(value = '') {
    const text = String(value || '').trim();
    if (!text) {
      return null;
    }
    const parts = text.split(/\s*----\s*/);
    if (parts.length < 2) {
      return null;
    }
    const phoneNumber = normalizePhoneNumber(parts[0]);
    const url = String(parts.slice(1).join('----')).trim();
    if (!phoneNumber || !url) {
      return null;
    }
    return { phoneNumber, url };
  }

  function normalizePhoneEntries(value = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '')
        .split(/\r?\n+/)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const entries = [];
    const seen = new Set();
    for (const entry of source) {
      const normalized = entry && typeof entry === 'object' && !Array.isArray(entry)
        ? normalizePhoneEntry(`${entry.phoneNumber || entry.phone || ''}----${entry.url || entry.smsUrl || ''}`)
        : normalizePhoneEntry(entry);
      if (!normalized || seen.has(normalized.phoneNumber)) {
        continue;
      }
      seen.add(normalized.phoneNumber);
      entries.push(normalized);
    }
    return entries;
  }

  function normalizeBaseUrl(value = '') {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return '';
    }
    try {
      return new URL(trimmed).toString();
    } catch {
      return '';
    }
  }

  function buildLookupUrl(url, phoneNumber) {
    const normalizedUrl = normalizeBaseUrl(url);
    if (!normalizedUrl) {
      return '';
    }
    const digits = normalizePhoneDigits(phoneNumber);
    return normalizedUrl
      .replace(/\{\{\s*(?:phone|mobile|msisdn)\s*\}\}/gi, digits)
      .replace(/\{\s*(?:phone|mobile|msisdn)\s*\}/gi, digits);
  }

  function extractVerificationCode(payload) {
    const text = typeof payload === 'string'
      ? payload
      : (() => {
        if (payload && typeof payload === 'object') {
          return String(payload.message || payload.msg || payload.data || payload.text || payload.code || '').trim();
        }
        return String(payload || '').trim();
      })();
    if (!text) {
      return '';
    }
    const segments = text.split('|').map((part) => part.trim()).filter(Boolean);
    for (const segment of segments) {
      const match = segment.match(/\b(\d{4,8})\b/);
      if (match) {
        return match[1];
      }
    }
    const directMatch = text.match(/\b(\d{4,8})\b/);
    return directMatch?.[1] || '';
  }

  function describePayload(raw) {
    if (typeof raw === 'string') {
      return raw.trim();
    }
    if (raw && typeof raw === 'object') {
      const direct = String(raw.message || raw.msg || raw.error || raw.text || raw.data || '').trim();
      if (direct) {
        return direct;
      }
      try {
        return JSON.stringify(raw);
      } catch {
        return String(raw);
      }
    }
    return String(raw || '').trim();
  }

  function resolveConfig(state = {}, deps = {}) {
    return {
      phoneEntries: normalizePhoneEntries(state.customSmsPhoneEntries || state.customSmsEntries || state.customSmsPool || []),
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  function resolveEntry(state = {}, activation = {}) {
    const phoneNumber = normalizePhoneNumber(activation.phoneNumber || activation.number || activation.phone || '');
    if (!phoneNumber) {
      return null;
    }
    const entries = normalizePhoneEntries(state.customSmsPhoneEntries || state.customSmsEntries || state.customSmsPool || []);
    return entries.find((entry) => normalizePhoneDigits(entry.phoneNumber) === normalizePhoneDigits(phoneNumber)) || null;
  }

  async function fetchLookupPayload(config, entry, actionLabel = '自定义接码查询验证码') {
    if (!config.fetchImpl) {
      throw new Error('自定义接码网络请求实现不可用。');
    }
    const requestUrl = buildLookupUrl(entry.url, entry.phoneNumber);
    if (!requestUrl) {
      throw new Error('自定义接码 URL 无效。');
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS)
      : null;
    try {
      const response = await config.fetchImpl(requestUrl, {
        method: 'GET',
        signal: controller?.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${actionLabel}失败：${describePayload(text) || response.status}`);
      }
      return text;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${actionLabel}超时。`);
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async function requestActivation(state = {}, options = {}) {
    const config = resolveConfig(state);
    const entry = normalizePhoneEntries(options?.phoneEntries || config.phoneEntries)[0] || null;
    if (!entry) {
      throw new Error('请先在接码设置中配置自定义手机号与取码 URL。');
    }
    return {
      activationId: entry.phoneNumber,
      phoneNumber: entry.phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: 'custom',
      countryId: null,
      countryLabel: '',
      successfulUses: 0,
      maxUses: 1,
      source: 'custom-sms',
      lookupUrl: entry.url,
    };
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const normalizedActivation = activation && typeof activation === 'object'
      ? activation
      : { phoneNumber: String(activation || '').trim() };
    const config = resolveConfig(state, deps);
    const entry = resolveEntry(state, normalizedActivation);
    if (!entry) {
      throw new Error('缺少自定义接码手机号或 URL。');
    }
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 180000);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 5000);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let pollCount = 0;
    let lastResponse = '';

    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) {
        break;
      }
      deps.throwIfStopped?.();
      const payloadText = await fetchLookupPayload(config, entry, '自定义接码查询验证码');
      lastResponse = payloadText;
      pollCount += 1;
      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: payloadText,
          timeoutMs,
        });
      }
      const code = extractVerificationCode(payloadText);
      if (code) {
        return code;
      }
      if (typeof options.onWaitingForCode === 'function') {
        await options.onWaitingForCode({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: payloadText,
          timeoutMs,
        });
      }
      await deps.sleepWithStop?.(intervalMs) ?? await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`PHONE_CODE_TIMEOUT::等待手机验证码超时。${lastResponse ? ` 最后响应：${lastResponse}` : ''}`);
  }

  async function finishActivation() {
    return '';
  }

  async function cancelActivation() {
    return '';
  }

  function createProvider(deps = {}) {
    return {
      id: PROVIDER_ID,
      label: '自定义接码',
      defaultCountryId: null,
      defaultCountryLabel: '',
      defaultProduct: 'custom',
      normalizeCountryId: (value) => value,
      normalizeCountryLabel: (value = '', fallback = '') => String(value || '').trim() || fallback,
      normalizeCountryFallback: (value = []) => Array.isArray(value) ? value : [],
      normalizeMaxPrice: (value = '') => String(value || '').trim(),
      resolveCountryCandidates: () => [],
      requestActivation: (state, options) => requestActivation(state, options, deps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, deps),
      finishActivation: () => finishActivation(),
      cancelActivation: () => cancelActivation(),
      describePayload,
      normalizePhoneEntries,
      normalizePhoneNumber,
      normalizePhoneDigits,
      extractVerificationCode,
    };
  }

  return {
    PROVIDER_ID,
    createProvider,
    normalizePhoneEntries,
    normalizePhoneNumber,
    normalizePhoneDigits,
    extractVerificationCode,
  };
});
