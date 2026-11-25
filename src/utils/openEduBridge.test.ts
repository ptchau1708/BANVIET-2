import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initOpenEduIframeBridge,
  normalizeAllowedOrigins,
  normalizeStrictOrigin,
  postToOpenEduParent,
  resolveAllowedParentOrigin,
  subscribeOpenEduMessages,
} from './openEduBridge';

const WEB_ORIGIN = 'https://web.open-edu.vn';
const TEACHER_ORIGIN = 'https://teacher.open-edu.vn';
const EVIL_ORIGIN = 'https://evil.example.com';

test('normalizeStrictOrigin and normalizeAllowedOrigins reject wildcards and non-http(s) origins', () => {
  assert.equal(normalizeStrictOrigin('*'), '');
  assert.equal(normalizeStrictOrigin('javascript:alert(1)'), '');
  assert.equal(normalizeStrictOrigin('https://web.open-edu.vn/foo/bar'), WEB_ORIGIN);
  assert.deepEqual(
    normalizeAllowedOrigins([WEB_ORIGIN, TEACHER_ORIGIN, '*', WEB_ORIGIN + '/dup', '']),
    [WEB_ORIGIN, TEACHER_ORIGIN]
  );
});

test('resolveAllowedParentOrigin strictly prefers authoritative ancestorOrigin and never falls back if untrusted', () => {
  // Embedded in OPENEDU_TEACHER_ORIGIN -> resolves strictly to teacher origin
  assert.equal(
    resolveAllowedParentOrigin({
      allowedOrigins: [WEB_ORIGIN, TEACHER_ORIGIN],
      ancestorOrigin: TEACHER_ORIGIN,
      referrer: WEB_ORIGIN + '/lti/auth',
      storedOrigin: WEB_ORIGIN,
    }),
    TEACHER_ORIGIN
  );

  // Embedded in OPENEDU_WEB_ORIGIN -> resolves strictly to web origin
  assert.equal(
    resolveAllowedParentOrigin({
      allowedOrigins: [WEB_ORIGIN, TEACHER_ORIGIN],
      ancestorOrigin: WEB_ORIGIN,
      referrer: TEACHER_ORIGIN + '/class',
      storedOrigin: TEACHER_ORIGIN,
    }),
    WEB_ORIGIN
  );

  // Embedded in untrusted origin -> MUST return '' even if referrer or storedOrigin was allowed
  assert.equal(
    resolveAllowedParentOrigin({
      allowedOrigins: [WEB_ORIGIN, TEACHER_ORIGIN],
      ancestorOrigin: EVIL_ORIGIN,
      referrer: WEB_ORIGIN + '/lti/auth',
      storedOrigin: TEACHER_ORIGIN,
    }),
    ''
  );

  // Fallback when ancestorOrigin is unavailable (Firefox): uses referrer if allowed, else storedOrigin
  assert.equal(
    resolveAllowedParentOrigin({
      allowedOrigins: [WEB_ORIGIN, TEACHER_ORIGIN],
      ancestorOrigin: null,
      referrer: `${TEACHER_ORIGIN}/assignments/42`,
      storedOrigin: WEB_ORIGIN,
    }),
    TEACHER_ORIGIN
  );

  assert.equal(
    resolveAllowedParentOrigin({
      allowedOrigins: [WEB_ORIGIN, TEACHER_ORIGIN],
      ancestorOrigin: null,
      referrer: 'https://banviet.example.com/lti/launch',
      storedOrigin: TEACHER_ORIGIN,
    }),
    TEACHER_ORIGIN
  );

  assert.equal(
    resolveAllowedParentOrigin({
      allowedOrigins: [WEB_ORIGIN, TEACHER_ORIGIN],
      ancestorOrigin: null,
      referrer: EVIL_ORIGIN,
      storedOrigin: EVIL_ORIGIN,
    }),
    ''
  );
});

function withMockBrowserIframe(
  options: {
    ancestorOrigins?: string[];
    referrer?: string;
    storedOrigin?: string;
  },
  fn: (ctx: {
    sentMessages: Array<{ payload: unknown; targetOrigin: string }>;
    dispatchMessage: (event: { origin: string; source: unknown; data: unknown }) => void;
    parentWindow: Record<string, unknown>;
    otherWindow: Record<string, unknown>;
  }) => void
) {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;

  const sentMessages: Array<{ payload: unknown; targetOrigin: string }> = [];
  const listeners = new Set<(event: MessageEvent) => void>();
  const storage = new Map<string, string>();
  if (options.storedOrigin) {
    storage.set('banviet_openedu_origin', options.storedOrigin);
  }

  const parentWindow: Record<string, unknown> = {
    postMessage(payload: unknown, targetOrigin: string) {
      sentMessages.push({ payload, targetOrigin });
    },
  };
  const otherWindow: Record<string, unknown> = {};

  const mockWindow: Record<string, unknown> = {
    top: parentWindow,
    parent: parentWindow,
    location: {
      ancestorOrigins: options.ancestorOrigins ?? undefined,
    },
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
    addEventListener: (type: string, cb: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.add(cb);
    },
    removeEventListener: (type: string, cb: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.delete(cb);
    },
  };
  mockWindow.self = mockWindow;

  const mockDocument = {
    referrer: options.referrer ?? '',
    documentElement: { scrollHeight: 820 },
    body: { scrollHeight: 800 },
  };

  (globalThis as Record<string, unknown>).window = mockWindow;
  (globalThis as Record<string, unknown>).document = mockDocument;

  try {
    fn({
      sentMessages,
      parentWindow,
      otherWindow,
      dispatchMessage: (event) => {
        for (const cb of listeners) {
          cb(event as unknown as MessageEvent);
        }
      },
    });
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
    if (prevDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  }
}

test('initOpenEduIframeBridge sends and receives ONLY with the exact embedding parent origin and never uses "*"', () => {
  // Case 1: Embedded in TEACHER_ORIGIN
  withMockBrowserIframe({ ancestorOrigins: [TEACHER_ORIGIN] }, (ctx) => {
    const cleanup = initOpenEduIframeBridge([WEB_ORIGIN, TEACHER_ORIGIN]);

    // Initial messages (lti.capabilities + lti.frameResize) must go ONLY to TEACHER_ORIGIN
    assert.equal(ctx.sentMessages.length, 2);
    for (const msg of ctx.sentMessages) {
      assert.equal(msg.targetOrigin, TEACHER_ORIGIN);
      assert.notEqual(msg.targetOrigin, '*');
    }

    // Message from the OTHER allowed origin (WEB_ORIGIN) must be IGNORED because parent is TEACHER_ORIGIN
    ctx.dispatchMessage({
      origin: WEB_ORIGIN,
      source: ctx.parentWindow,
      data: { subject: 'lti.capabilities.response' },
    });
    assert.equal(ctx.sentMessages.length, 2);

    // Message from EVIL_ORIGIN must be IGNORED
    ctx.dispatchMessage({
      origin: EVIL_ORIGIN,
      source: ctx.parentWindow,
      data: { subject: 'lti.capabilities.response' },
    });
    assert.equal(ctx.sentMessages.length, 2);

    // Message from wrong window source with TEACHER_ORIGIN must be IGNORED
    ctx.dispatchMessage({
      origin: TEACHER_ORIGIN,
      source: ctx.otherWindow,
      data: { subject: 'lti.capabilities.response' },
    });
    assert.equal(ctx.sentMessages.length, 2);

    // Message from exact parent TEACHER_ORIGIN + window.parent triggers frameResize ONLY to TEACHER_ORIGIN
    ctx.dispatchMessage({
      origin: TEACHER_ORIGIN,
      source: ctx.parentWindow,
      data: { subject: 'lti.capabilities.response' },
    });
    assert.equal(ctx.sentMessages.length, 3);
    assert.equal(ctx.sentMessages[2].targetOrigin, TEACHER_ORIGIN);

    cleanup();
  });

  // Case 2: Embedded in EVIL_ORIGIN -> sends ZERO messages and ignores everything
  withMockBrowserIframe({ ancestorOrigins: [EVIL_ORIGIN], storedOrigin: WEB_ORIGIN }, (ctx) => {
    const cleanup = initOpenEduIframeBridge([WEB_ORIGIN, TEACHER_ORIGIN]);
    assert.equal(ctx.sentMessages.length, 0);

    ctx.dispatchMessage({
      origin: WEB_ORIGIN,
      source: ctx.parentWindow,
      data: { subject: 'lti.capabilities.response' },
    });
    assert.equal(ctx.sentMessages.length, 0);
    cleanup();
  });

  // Case 3: postToOpenEduParent & subscribeOpenEduMessages reject '*' and unallowed origins
  withMockBrowserIframe({ ancestorOrigins: [WEB_ORIGIN] }, (ctx) => {
    assert.equal(postToOpenEduParent({ subject: 'test' }, '*', [WEB_ORIGIN, TEACHER_ORIGIN]), false);
    assert.equal(
      postToOpenEduParent({ subject: 'test' }, EVIL_ORIGIN, [WEB_ORIGIN, TEACHER_ORIGIN]),
      false
    );
    assert.equal(
      postToOpenEduParent({ subject: 'test' }, WEB_ORIGIN, [WEB_ORIGIN, TEACHER_ORIGIN]),
      true
    );
    assert.equal(ctx.sentMessages.length, 1);
    assert.equal(ctx.sentMessages[0].targetOrigin, WEB_ORIGIN);

    const received: Record<string, unknown>[] = [];
    const unsub = subscribeOpenEduMessages(WEB_ORIGIN, [WEB_ORIGIN, TEACHER_ORIGIN], (d) =>
      received.push(d)
    );
    ctx.dispatchMessage({ origin: TEACHER_ORIGIN, source: ctx.parentWindow, data: { ok: 1 } });
    ctx.dispatchMessage({ origin: WEB_ORIGIN, source: ctx.parentWindow, data: { ok: 2 } });
    assert.deepEqual(received, [{ ok: 2 }]);
    unsub();
  });
});
