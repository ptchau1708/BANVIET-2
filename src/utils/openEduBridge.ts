const LTI_MODE_KEY = 'banviet_lti_mode';
const OPENEDU_ORIGIN_KEY = 'banviet_openedu_origin';
const LAUNCH_ASSIGNMENT_KEY = 'banviet_launch_assignment_id';

export function isEmbeddedInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isLtiLaunchMode(): boolean {
  try {
    return window.sessionStorage.getItem(LTI_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function getStoredOpenEduOrigin(): string {
  try {
    return window.sessionStorage.getItem(OPENEDU_ORIGIN_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredOpenEduOrigin(origin: string): void {
  try {
    if (origin) {
      window.sessionStorage.setItem(OPENEDU_ORIGIN_KEY, origin);
    } else {
      window.sessionStorage.removeItem(OPENEDU_ORIGIN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function consumeLaunchAssignmentId(): string | null {
  try {
    const id = window.sessionStorage.getItem(LAUNCH_ASSIGNMENT_KEY);
    if (id) {
      window.sessionStorage.removeItem(LAUNCH_ASSIGNMENT_KEY);
      return id;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearLtiSessionMetadata(): void {
  try {
    window.sessionStorage.removeItem(LTI_MODE_KEY);
    window.sessionStorage.removeItem(LAUNCH_ASSIGNMENT_KEY);
    window.sessionStorage.removeItem(OPENEDU_ORIGIN_KEY);
  } catch {
    // ignore
  }
}

export function normalizeStrictOrigin(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '*') return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function normalizeAllowedOrigins(rawOrigins: readonly (string | undefined)[]): string[] {
  const unique: string[] = [];
  for (const raw of rawOrigins) {
    const normalized = normalizeStrictOrigin(raw);
    if (normalized && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  }
  return unique;
}

/**
 * Pure helper to determine the exact embedding parent's origin.
 * - Never returns '*'.
 * - Always requires the parent origin to belong to `allowedOrigins`
 *   (OPENEDU_WEB_ORIGIN or OPENEDU_TEACHER_ORIGIN).
 * - When `ancestorOrigin` (window.location.ancestorOrigins[0]) is available,
 *   it is authoritative: if it is NOT in `allowedOrigins`, returns '' immediately
 *   without falling back to stale referrer/sessionStorage values.
 */
export function resolveAllowedParentOrigin(params: {
  allowedOrigins: readonly (string | undefined)[];
  ancestorOrigin?: string | null;
  referrer?: string | null;
  storedOrigin?: string | null;
}): string {
  const allowed = normalizeAllowedOrigins(params.allowedOrigins);
  if (allowed.length === 0) return '';

  // 1. Authoritative browser-provided immediate parent origin (Chromium/Safari)
  if (typeof params.ancestorOrigin === 'string' && params.ancestorOrigin.trim() !== '') {
    const normalizedAncestor = normalizeStrictOrigin(params.ancestorOrigin);
    return normalizedAncestor && allowed.includes(normalizedAncestor) ? normalizedAncestor : '';
  }

  // 2. Fallback when ancestorOrigins is unsupported (e.g. Firefox): check document.referrer
  if (typeof params.referrer === 'string' && params.referrer.trim() !== '') {
    const normalizedReferrer = normalizeStrictOrigin(params.referrer);
    if (normalizedReferrer && allowed.includes(normalizedReferrer)) {
      return normalizedReferrer;
    }
  }

  // 3. Fallback to server-verified parent origin recorded during /lti/login handoff
  if (typeof params.storedOrigin === 'string' && params.storedOrigin.trim() !== '') {
    const normalizedStored = normalizeStrictOrigin(params.storedOrigin);
    if (normalizedStored && allowed.includes(normalizedStored)) {
      return normalizedStored;
    }
  }

  return '';
}

function getImmediateAncestorOrigin(): string | null {
  try {
    const ancestors = window.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0) {
      return ancestors[0];
    }
    return null;
  } catch {
    return null;
  }
}

export function getBrowserActiveParentOrigin(
  allowedOrigins: readonly (string | undefined)[]
): string {
  if (!isEmbeddedInIframe()) return '';
  return resolveAllowedParentOrigin({
    allowedOrigins,
    ancestorOrigin: getImmediateAncestorOrigin(),
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    storedOrigin: getStoredOpenEduOrigin(),
  });
}

/**
 * Sends a 1EdTech LTI / OPEN-EDU postMessage to window.parent.
 * Strictly requires an exact, verified parent origin within allowedOrigins and NEVER uses "*".
 */
export function postToOpenEduParent(
  payload: Record<string, unknown>,
  targetOrigin: string,
  allowedOrigins?: readonly (string | undefined)[]
): boolean {
  const strictOrigin = normalizeStrictOrigin(targetOrigin);
  if (!strictOrigin || !isEmbeddedInIframe()) return false;
  if (allowedOrigins) {
    const allowed = normalizeAllowedOrigins(allowedOrigins);
    if (!allowed.includes(strictOrigin)) return false;
  }
  try {
    window.parent.postMessage(payload, strictOrigin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribes to postMessage events coming strictly from the exact embedding parent origin
 * (which must belong to allowedOrigins). Ignores all other origins and non-parent sources.
 */
export function subscribeOpenEduMessages(
  exactParentOrigin: string,
  allowedOrigins: readonly (string | undefined)[],
  onMessage: (data: Record<string, unknown>) => void
): () => void {
  const strictOrigin = normalizeStrictOrigin(exactParentOrigin);
  const allowed = normalizeAllowedOrigins(allowedOrigins);
  if (!strictOrigin || !allowed.includes(strictOrigin)) return () => {};

  const listener = (event: MessageEvent) => {
    if (event.origin !== strictOrigin) return;
    if (event.source && event.source !== window.parent) return;
    if (!event.data || typeof event.data !== 'object') return;
    onMessage(event.data as Record<string, unknown>);
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/**
 * Announces 1EdTech LTI client capabilities (lti.capabilities) and notifies parent frame height
 * using ONLY the exact origin of the embedding parent, which MUST belong to
 * [OPENEDU_WEB_ORIGIN, OPENEDU_TEACHER_ORIGIN]. Never uses '*'.
 */
export function initOpenEduIframeBridge(
  allowedOrigins: readonly (string | undefined)[]
): () => void {
  const allowed = normalizeAllowedOrigins(allowedOrigins);
  if (allowed.length === 0 || !isEmbeddedInIframe()) return () => {};

  const immediateAncestor = getImmediateAncestorOrigin();
  let lockedParentOrigin = resolveAllowedParentOrigin({
    allowedOrigins: allowed,
    ancestorOrigin: immediateAncestor,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    storedOrigin: getStoredOpenEduOrigin(),
  });

  // If browser reported an authoritative ancestorOrigin and it was NOT allowed,
  // refuse all postMessage communication immediately.
  if (immediateAncestor && !lockedParentOrigin) {
    return () => {};
  }

  const sendHeight = () => {
    if (!lockedParentOrigin) return;
    const height = Math.max(
      document.documentElement?.scrollHeight ?? 0,
      document.body?.scrollHeight ?? 0
    );
    postToOpenEduParent(
      {
        subject: 'lti.frameResize',
        height,
      },
      lockedParentOrigin,
      allowed
    );
  };

  const announceCapabilities = () => {
    if (!lockedParentOrigin) return;
    const requestId = `bv-cap-${Date.now()}`;
    postToOpenEduParent(
      {
        subject: 'lti.capabilities',
        message_id: requestId,
      },
      lockedParentOrigin,
      allowed
    );
  };

  if (lockedParentOrigin) {
    setStoredOpenEduOrigin(lockedParentOrigin);
    announceCapabilities();
    sendHeight();
  }

  const handleMessage = (event: MessageEvent) => {
    // Must come from the direct embedding parent window
    if (event.source && event.source !== window.parent) return;
    if (!event.data || typeof event.data !== 'object') return;

    const incomingOrigin = normalizeStrictOrigin(event.origin);
    if (!incomingOrigin || !allowed.includes(incomingOrigin)) return;

    if (lockedParentOrigin) {
      // Once locked to the exact embedding parent, reject even the other allowed origin
      if (incomingOrigin !== lockedParentOrigin) return;
    } else {
      // Fallback lock (e.g. Firefox with stripped Referer): lock to window.parent's verified origin
      lockedParentOrigin = incomingOrigin;
      setStoredOpenEduOrigin(lockedParentOrigin);
    }

    const data = event.data as Record<string, unknown>;
    const subject = typeof data.subject === 'string' ? data.subject : '';
    if (subject === 'lti.capabilities.response' || subject === 'lti.frameResize.request') {
      sendHeight();
    }
  };

  window.addEventListener('message', handleMessage);

  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
    observer = new ResizeObserver(() => sendHeight());
    observer.observe(document.body);
  }

  return () => {
    window.removeEventListener('message', handleMessage);
    observer?.disconnect();
  };
}
