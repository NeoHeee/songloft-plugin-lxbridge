// 注入每个音源子 QuickJS VM 的洛雪兼容运行时。
// 尽量对齐 LX Music Desktop 2.x 的用户音源 API：
// request 返回可调用的取消函数；send/on 返回 Promise；utils 采用官方对象结构。
export const LX_PRELUDE_JS = String.raw`
(function () {
  'use strict';

  var handlers = Object.create(null);
  var requestSeq = 0;
  var hasInited = false;
  var hasUpdateAlert = false;
  var EVENT_NAMES = {
    request: 'request',
    inited: 'inited',
    updateAlert: 'updateAlert',
  };

  function safeStringify(value) {
    try { return JSON.stringify(value == null ? null : value); }
    catch (error) { return JSON.stringify({ error: String(error && error.message || error) }); }
  }

  function emit(name, data) {
    var eventName = String(name);
    if (eventName === EVENT_NAMES.inited && globalThis.lx) {
      globalThis.lx.sources = data && data.sources && typeof data.sources === 'object' ? data.sources : data;
      globalThis.lx.__initDiagnostics.inited = true;
      globalThis.lx.__initDiagnostics.sourceKeys = Object.keys(globalThis.lx.sources || {});
    }
    try {
      __go_send(eventName, safeStringify(data));
      return true;
    } catch (error) {
      if (globalThis.lx) globalThis.lx.__initDiagnostics.lastSendError = String(error && error.message || error);
      return false;
    }
  }

  function encodeForm(form) {
    if (!form || typeof form !== 'object') return '';
    var result = [];
    Object.keys(form).forEach(function (key) {
      var value = form[key];
      if (value == null) return;
      if (Array.isArray(value)) {
        value.forEach(function (item) {
          result.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(item)));
        });
      } else {
        result.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
      }
    });
    return result.join('&');
  }

  function responseHeaders(headers) {
    var output = {};
    if (!headers) return output;
    try {
      if (typeof headers.forEach === 'function') {
        headers.forEach(function (value, key) {
          output[String(key).toLowerCase()] = String(value);
        });
      } else if (typeof headers === 'object') {
        Object.keys(headers).forEach(function (key) {
          output[String(key).toLowerCase()] = String(headers[key]);
        });
      }
    } catch (_) {}
    return output;
  }

  function parseResponse(text, contentType, responseType) {
    if (responseType === 'arraybuffer' || responseType === 'buffer') return Buffer.from(text, 'latin1');
    if (responseType === 'json' || String(contentType || '').indexOf('json') > -1) {
      try { return JSON.parse(text); } catch (_) { return text; }
    }
    var trimmed = String(text || '').trim();
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      try { return JSON.parse(text); } catch (_) {}
    }
    return text;
  }

  function lxRequest(url, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    options = options || {};
    callback = typeof callback === 'function' ? callback : function () {};

    var cancelled = false;
    var settled = false;
    var headers = {};
    Object.keys(options.headers || {}).forEach(function (key) {
      headers[key] = options.headers[key];
    });

    var method = String(options.method || (options.body || options.form || options.formData ? 'POST' : 'GET')).toUpperCase();
    var body;
    var timeoutMs = Math.max(1000, Math.min(60000, Number(options.timeout || 60000)));
    var timeoutId = setTimeout(function () {
      if (cancelled || settled) return;
      settled = true;
      callback(new Error('request timeout after ' + timeoutMs + 'ms'), null, null);
    }, timeoutMs);

    function finish(error, result, responseBody) {
      if (cancelled || settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try { callback.call(cancelRequest, error, result, responseBody); }
      catch (callbackError) {
        if (globalThis.lx) globalThis.lx.__initDiagnostics.lastCallbackError = String(callbackError && callbackError.message || callbackError);
      }
    }

    if (options.form) {
      body = encodeForm(options.form);
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (options.formData) {
      // Songloft 子 VM 暂无浏览器 FormData；绝大多数洛雪源仅传普通键值。
      body = encodeForm(options.formData);
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (options.body != null) {
      if (
        typeof options.body === 'string' ||
        (typeof Uint8Array !== 'undefined' && options.body instanceof Uint8Array) ||
        (typeof ArrayBuffer !== 'undefined' && options.body instanceof ArrayBuffer)
      ) {
        body = options.body;
      } else if (options.body && typeof options.body._hex === 'string') {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
      }
    }

    Promise.resolve().then(function () {
      return fetch(String(url), { method: method, headers: headers, body: body });
    }).then(function (response) {
      var hdrs = responseHeaders(response.headers);
      var binary = options.responseType === 'arraybuffer' || options.responseType === 'buffer';
      var reader;
      if (binary && typeof response.arrayBuffer === 'function') {
        reader = response.arrayBuffer().then(function (value) {
          return { binary: true, value: value };
        });
      } else {
        reader = response.text().then(function (value) {
          return { binary: false, value: value };
        });
      }
      return reader.then(function (raw) {
        if (cancelled || settled) return;
        var parsed;
        var rawBuffer;
        if (binary) {
          rawBuffer = raw.binary
            ? Buffer.from(new Uint8Array(raw.value))
            : Buffer.from(String(raw.value || ''), 'latin1');
          parsed = rawBuffer;
        } else {
          parsed = parseResponse(raw.value, hdrs['content-type'] || '', options.responseType);
          rawBuffer = Buffer.from(String(raw.value || ''), 'utf8');
        }
        var result = {
          statusCode: response.status,
          status: response.status,
          statusMessage: response.statusText || '',
          headers: hdrs,
          bytes: rawBuffer.length || 0,
          raw: rawBuffer,
          body: parsed,
        };
        finish(null, result, parsed);
      });
    }).catch(function (error) {
      finish(error, null, null);
    });

    function cancelRequest() {
      cancelled = true;
      clearTimeout(timeoutId);
    }
    // 同时兼容官方返回“函数”和部分旧适配器使用 .cancelHttp() 的写法。
    cancelRequest.cancel = cancelRequest;
    cancelRequest.cancelHttp = cancelRequest;
    cancelRequest.request = cancelRequest;
    return cancelRequest;
  }

  function dispatch(reqId, eventName, dataJSON) {
    var id = String(reqId);
    var handler = handlers[String(eventName)];
    var settled = false;
    var watchdog = setTimeout(function () {
      if (settled) return;
      settled = true;
      emit('dispatchError', { id: id, error: 'source handler timeout after 18000ms' });
    }, 18000);

    function ok(result) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      emit('dispatchResult', { id: id, result: result });
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      emit('dispatchError', { id: id, error: String(error && error.message || error || 'unknown source error') });
    }

    if (typeof handler !== 'function') {
      fail('event handler not registered: ' + eventName);
      return;
    }

    var data;
    try { data = typeof dataJSON === 'string' ? JSON.parse(dataJSON) : dataJSON; }
    catch (error) { fail(error); return; }

    try {
      Promise.resolve(handler(data)).then(ok, fail);
    } catch (error) {
      fail(error);
    }
  }

  var bufferUtils = {
    from: function () { return Buffer.from.apply(Buffer, arguments); },
    alloc: function (size) { return Buffer.alloc(size); },
    concat: function (list) { return Buffer.concat(list); },
    bufToString: function (buf, format) { return Buffer.from(buf, 'binary').toString(format || 'utf8'); },
  };

  var cryptoUtils = {
    aesEncrypt: function (buffer, mode, key, iv) { return crypto.aesEncrypt(buffer, mode, key, iv); },
    aesDecrypt: function (buffer, mode, key, iv) { return crypto.aesDecrypt(buffer, mode, key, iv); },
    rsaEncrypt: function (buffer, key) { return crypto.rsaEncrypt(buffer, key); },
    randomBytes: function (size) { return crypto.randomBytes(size); },
    md5: function (text) { return crypto.md5(String(text)); },
    sha1: function (text) { return crypto.sha1(String(text)); },
    sha256: function (text) {
      if (typeof crypto.sha256 === 'function') return crypto.sha256(String(text));
      return crypto.sha256Bytes(Buffer.from(String(text), 'utf8')).toString('hex');
    },
    rc4: function (key, data) { return crypto.rc4(key, data); },
  };

  var zlibUtils = {
    inflate: function (buf) {
      try { return Promise.resolve(zlib.inflate(buf)); }
      catch (error) { return Promise.reject(error); }
    },
    deflate: function (data) {
      try { return Promise.resolve(zlib.deflate(data)); }
      catch (error) { return Promise.reject(error); }
    },
    rawInflate: function (buf) {
      try {
        if (typeof zlib.rawInflate === 'function') return Promise.resolve(zlib.rawInflate(buf));
        if (typeof zlib.inflateRaw === 'function') return Promise.resolve(zlib.inflateRaw(buf));
        return Promise.resolve(zlib.inflate(buf));
      } catch (error) { return Promise.reject(error); }
    },
  };

  var lx = {
    // 官方桌面端用户音源环境当前暴露 2.0.0；部分脚本会把它写进 UA 或做环境判断。
    version: '2.0.0',
    env: 'desktop',
    currentScriptInfo: {},
    sources: {},
    EVENT_NAMES: EVENT_NAMES,
    request: lxRequest,
    send: function (name, data) {
      var eventName = String(name);
      if (eventName !== EVENT_NAMES.inited && eventName !== EVENT_NAMES.updateAlert) {
        return Promise.reject(new Error('The event is not supported: ' + eventName));
      }
      if (eventName === EVENT_NAMES.inited) {
        if (hasInited) return Promise.reject(new Error('Script is inited'));
        hasInited = true;
      } else if (eventName === EVENT_NAMES.updateAlert) {
        if (hasUpdateAlert) return Promise.reject(new Error('The update alert can only be called once.'));
        hasUpdateAlert = true;
      }
      if (!emit(eventName, data)) return Promise.reject(new Error('send event failed: ' + eventName));
      return Promise.resolve();
    },
    on: function (name, handler) {
      var eventName = String(name);
      if (eventName !== EVENT_NAMES.request) return Promise.reject(new Error('The event is not supported: ' + eventName));
      if (typeof handler !== 'function') return Promise.reject(new Error('handler must be a function'));
      handlers[eventName] = handler;
      lx.__initDiagnostics.requestHandler = true;
      return Promise.resolve();
    },
    off: function (name) {
      delete handlers[String(name)];
      return Promise.resolve();
    },
    removeEvent: function (name) {
      delete handlers[String(name)];
      return Promise.resolve();
    },
    _dispatch: dispatch,
    __initDiagnostics: {
      requestHandler: false,
      inited: false,
      sourceKeys: [],
      lastSendError: '',
      lastCallbackError: '',
    },
    utils: {
      buffer: bufferUtils,
      crypto: cryptoUtils,
      zlib: zlibUtils,
    },
  };

  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.global = globalThis;
  if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = { userAgent: 'lx-music-desktop/2.0.0 Songloft' };
  }
  if (typeof globalThis.location === 'undefined') {
    globalThis.location = { href: '', protocol: 'https:', hostname: 'localhost' };
  }
  if (typeof globalThis.setInterval !== 'function') {
    globalThis.setInterval = function (fn, ms) {
      var active = true;
      var token = { id: null, active: true };
      function tick() {
        if (!active || !token.active) return;
        token.id = setTimeout(function () {
          if (!active || !token.active) return;
          try { fn(); } finally { tick(); }
        }, ms || 0);
      }
      tick();
      return token;
    };
    globalThis.clearInterval = function (token) {
      if (!token) return;
      token.active = false;
      if (token.id != null) clearTimeout(token.id);
    };
  }

  globalThis.lx = lx;
  globalThis.__lx_handlers = handlers;
  globalThis.__lx_request_seq = function () { requestSeq += 1; return requestSeq; };
})();
`;
