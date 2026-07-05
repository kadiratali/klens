export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Maps raw Appium/driver error text to a stable code and a message a human
// can act on — instead of freezing silently or echoing driver internals.
const RULES = [
  {
    code: 'uia2-crash',
    re: /instrumentation process is not running|instrumentation process cannot|uiautomator2 server.*(died|crash|not running)|socket hang up.*uiautomator/i,
    user:
      'UiAutomator2 server on the device crashed (instrumentation process died). ' +
      'This happens when the app under test is killed or the device is under heavy load. A fresh session is needed.',
  },
  {
    code: 'wda-crash',
    re: /webdriveragent|wda.*(crash|quit|not running|unreachable)/i,
    user:
      'WebDriverAgent on the iOS device stopped responding. ' +
      'It may have been killed by the system; a fresh session is needed.',
  },
  {
    code: 'session-dead',
    re: /terminated or not started|invalid session id|no such session|already been (deleted|terminated)/i,
    user: 'The Appium session no longer exists (expired, quit elsewhere, or the server restarted).',
  },
  {
    code: 'appium-unreachable',
    re: /cannot reach appium|econnrefused|econnreset|fetch failed|socket hang up|network|aborted|timed? ?out/i,
    user: 'Appium server is unreachable. Check that it is still running and the URL is correct.',
  },
];

export function classify(message) {
  const msg = message || '';
  for (const rule of RULES) {
    if (rule.re.test(msg)) return { code: rule.code, user: rule.user };
  }
  return { code: 'unknown', user: null };
}

/** Codes that mean the session itself is gone and a reconnect is warranted. */
export const FATAL_SESSION_CODES = ['uia2-crash', 'wda-crash', 'session-dead'];
