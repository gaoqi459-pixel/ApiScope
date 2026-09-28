/**
 * ApiScope — content script
 * 职责：拦截页面网络请求 + 扫描 DOM 静态资源，提取 API/URL 端点并上报给 background。
 * 注入一次即保护现场，不重复注入。
 */
(() => {
  if (window.__apiScopeInjected) return;
  window.__apiScopeInjected = true;

  // ---------- 配置 ----------
  const BLOCKED_HOSTS = new Set([
    "google-analytics.com", "googletagmanager.com", "facebook.net", "facebook.com",
    "doubleclick.net", "hotjar.com", "sentry.io", "mixpanel.com", "amplitude.com",
    "segment.com", "intercom.io", "clarity.ms", "baidu.com", "hm.baidu.com",
    "cnzz.com", "yandex.ru", "adservice.google.com"
  ]);

  // 命中即判定为 API 接口的路径特征
  const API_PATTERNS = [
    /\/api\//i, /\/rest\//i, /\/graphql/i, /\/v\d+\//i, /\/v\d+(\/|$)/i,
    /\.json(\?|$)/i, /\.php(\?|$)/i, /\.aspx(\?|$)/i, /\.jsp(\?|$)/i, /\.action(\?|$)/i
  ];

  const MAX_BATCH = 200;          // 单次上报条数上限
  const URL_ATTRS = [             // DOM 属性 -> 需要扫描的标签
    ["script", "src"], ["link", "href"], ["img", "src"], ["a", "href"],
    ["iframe", "src"], ["source", "src"], ["video", "src"], ["audio", "src"],
    ["object", "data"], ["embed", "src"], ["form", "action"],
    ["meta", "content"]
  ];

  const seen = new Set(); // 已上报去重 key

  // ---------- 工具 ----------
  function hostBlocked(rawUrl) {
    try {
      const h = new URL(rawUrl, location.href).hostname;
      if (BLOCKED_HOSTS.has(h)) return true;
      if (h.endsWith("googleapis.com")) return true;
      return false;
    } catch (e) { return true; }
  }

  function normalizeUrl(raw) {
    try {
      const u = new URL(raw, location.href);
      u.hash = "";
      return u.href;
    } catch (e) { return null; }
  }

  function classify(url) {
    try {
      const path = new URL(url).pathname;
      if (API_PATTERNS.some((r) => r.test(path))) return "api";
    } catch (e) { /* ignore */ }
    return "url";
  }

  function buildKey(method, url, type) {
    // API 接口去掉 query 去重；普通 URL 保留 query 去重
    const u = type === "api" ? url.split("?")[0] : url;
    return method + " " + u;
  }

  // ---------- 上报 ----------
  let pending = [];
  function flush() {
    if (!pending.length) return;
    const batch = pending.splice(0, MAX_BATCH);
    try {
      chrome.runtime.sendMessage({ kind: "apiScope.add", list: batch });
    } catch (e) { /* worker 未就绪时忽略 */ }
    if (pending.length) setTimeout(flush, 50);
  }

  function push(method, rawUrl, status, source) {
    const norm = normalizeUrl(rawUrl);
    if (!norm) return;
    const type = classify(norm);
    const key = buildKey(method, norm, type);
    if (seen.has(key)) return;
    seen.add(key);
    pending.push({
      method: method || "GET",
      url: norm,
      status: status || 0,
      type,
      source: source || "scan",
      time: Date.now()
    });
    flush();
  }

  // ---------- 拦截 Fetch ----------
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    let url = args[0];
    let method = "GET";
    if (url instanceof Request) { url = url.url; method = url.method || "GET"; }
    if (args[1] && args[1].method) method = args[1].method;
    if (url && !hostBlocked(url)) push(method, url, 0, "fetch");
    return origFetch.apply(this, args).then((res) => {
      try { if (res && res.url && !hostBlocked(res.url)) push(method, res.url, res.status, "fetch"); } catch (e) {}
      return res;
    });
  };

  // ---------- 拦截 XMLHttpRequest ----------
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (url && !hostBlocked(url)) push(method, url, 0, "xhr");
    this.__apiScopeMethod = method;
    this.__apiScopeUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const url = this.__apiScopeUrl;
    const method = this.__apiScopeMethod || "GET";
    if (url) {
      this.addEventListener("loadend", () => {
        try { if (!hostBlocked(url)) push(method, url, this.status, "xhr"); } catch (e) {}
      });
    }
    return origSend.apply(this, args);
  };

  // ---------- 文本中提取 URL ----------
  function extractUrlsFromText(text, source) {
    if (!text) return;
    const re = /(?:https?:\/\/|\/\/)[^\s"'<>(){}[\]\\]+/g;
    let m;
    while ((m = re.exec(text))) {
      let s = m[0].replace(/[,;:.)]*$/, "");
      s = s.split(/[)\]}>'"\s]+/)[0];
      if (s.length < 8) continue;
      if (/^\/\//.test(s) && !/^https?:/.test(s)) s = "https:" + s;
      if (!/^https?:/.test(s)) continue;
      if (hostBlocked(s)) continue;
      push("GET", s, 0, source);
    }
    // 内联脚本中常见的相对接口路径，如 '/api/user'、'/v1/login'
    const re2 = /["'`]([^"'`]*(?:\/api\/|\/v\d+\/|\/rest\/|\/graphql)[^"'`]*)["'`]/g;
    while ((m = re2.exec(text))) {
      const s = m[1];
      if (/^(https?:)?\/\//.test(s) || s.startsWith("/") || s.startsWith("./")) {
        push("GET", s, 0, source);
      }
    }
  }

  // ---------- 扫描单个元素 ----------
  function scanElement(el) {
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();
    for (const [t, attr] of URL_ATTRS) {
      if (t !== tag) continue;
      const v = el.getAttribute(attr);
      if (v && /^(https?:)?\/\//i.test(v) && !v.startsWith("data:") && !v.startsWith("javascript:")) {
        push("GET", v, 0, "dom:" + tag);
      }
    }
    for (const a of el.attributes || []) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "src" || n === "href") {
        extractUrlsFromText(a.value, "attr:" + n);
      }
    }
    if (tag === "script" && !el.src) extractUrlsFromText(el.textContent || "", "inline-script");
    if (tag === "style" && !el.getAttribute("src")) extractUrlsFromText(el.textContent || "", "style");
  }

  function fullScan() {
    document.querySelectorAll("script,link,img,a,iframe,source,video,audio,object,embed,form,meta").forEach(scanElement);
    extractUrlsFromText(document.documentElement.outerHTML, "page-html");
  }

  // 初始扫描
  fullScan();

  // 收集页面引用的 JS 资源，并把页面源码上报给 background 做敏感信息提取 + 深度扫描
  function collectScripts() {
    const set = new Set();
    document.querySelectorAll("script[src]").forEach((s) => {
      try {
        const u = new URL(s.src, location.href).href;
        if (!u.startsWith("data:")) set.add(u);
      } catch (e) {}
    });
    // preload 标记为 script 的 link 也纳入
    document.querySelectorAll('link[rel="preload"][as="script"]').forEach((l) => {
      try { set.add(new URL(l.href, location.href).href); } catch (e) {}
    });
    return [...set];
  }

  function reportPageSource() {
    try {
      chrome.runtime.sendMessage({
        kind: "apiScope.pageSource",
        html: document.documentElement.outerHTML,
        scripts: collectScripts()
      });
    } catch (e) {}
  }
  // 等待静态脚本基本就绪后再上报，同时给动态注入的脚本一点时间
  setTimeout(reportPageSource, 600);

  // 动态内容监听
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") {
        scanElement(m.target);
      } else if (m.addedNodes && m.addedNodes.length) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) scanElement(n);
        }
      }
    }
  });
  mo.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "href", "action", "data", "content"]
  });

  // 接收来自 popup 的“重新扫描”指令
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.kind === "apiScope.rescan") {
      fullScan();
      sendResponse({ ok: true });
      return;
    }
  });
})();
