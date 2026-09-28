/**
 * ApiScope — background service worker (MV3) v2.0
 * 职责：
 *   1) 按标签页分桶存储实时捕获到的接口（endpoint）
 *   2) 对页面源码与 JS 文件跑「敏感信息正则」，输出分类结果
 *   3) 深度扫描：抓取页面引用的 JS 资源，补充提取
 *   4) 在扩展图标上显示角标（发现总数）
 */
const STORE_KEY = "apiScope.tabs";
const MAX_PER_TAB = 5000;

// ---------- 敏感信息提取规则 ----------
// 命中后按类别归类；每条规则均使用全局匹配。
const RULES = {
  ip:       /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  ip_port:  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d):\d{1,5}\b/g,
  domain:   /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|cn|io|co|dev|app|gov|edu|ai|xyz|top|vip|cc|me|info|biz|us|uk|de|jp|kr|hk|tw|ru|in|br|au|ca|fr|es|it|nl|se|no|fi|dk|pl|io)\b/gi,
  email:    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  mobile:   /\b1[3-9]\d{9}\b/g,
  idcard:   /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
  jwt:      /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g,
  aliyun_ak:/\bLTAI[A-Za-z0-9]{12,20}\b/g,
  tencent_ak:/\bAKID[A-Za-z0-9]{13,20}\b/g,
  baidu_ak: /\bAK[A-Za-z0-9]{10,40}\b/g,
  volc_ak:  /\bAKLT[A-Za-z0-9-_]{8,252}\b/g,
  jdbc:     /\bjdbc:[a-zA-Z:]+:\/\/[A-Za-z0-9._:;=\/@?,&%~-]+\b/gi,
  api_key:  /api[_-]?key\s*[:=]\s*["']?([A-Za-z0-9_\-]{16,})/gi,
  swagger:  /(?:swagger-ui\.html|"swagger"\s*:|Swagger UI|swaggerUi|swaggerVersion)/g,
  shiro:    /(?:rememberMe=|deleteMe)/gi,
  admin_path:/\/(?:admin|manage|manager|system|console|dashboard|backstage|backend)(?:\/|$)/gi,
  algorithm:/\b(?:md5|sha1|sha256|sha512|hmac|CryptoJS\.(?:AES|DES|RSA)|JSEncrypt|btoa|atob|jsencrypt)\b/gi,
  // —— 以下规则参考 SnowEyes(雪瞳) 补充 ——
  aws_ak:    /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|A3T)[0-9A-Z]{16}\b/g,
  google_api:/\bAIza[0-9A-Za-z_\-]{35}\b/g,
  github_token:/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{20,255}\b/g,
  gitlab_token:/\bglpat-[a-zA-Z0-9\-=_]{20,22}\b/g,
  wechat:   /\bwx[a-z0-9]{15,18}\b/g,
  wecom:    /\bww[a-z0-9]{15,18}\b/g,
  alipay:   /\b(?:AKLT|AKTP)[a-zA-Z0-9]{35,50}\b/g,
  credential:/\b(?:password|passwd|pwd|user(?:name)?|account|secret)\s*[:=]\s*["'][^"'\s,]{4,}["']/gi,
  session:  /\b(?:PHPSESSID|JSESSIONID|sessionid|token)\s*[:=]\s*["']?[a-zA-Z0-9._\-]{8,}["']?/gi,
  company:  /[一-龥]{4,15}(?:公司|中心|科技|集团|软件)/g,
  webpack:  /\b(?:webpackJsonp|__webpack_require__|webpack-dev-server)\b/i,
  django:   /\bcsrfmiddlewaretoken\b/i
};

// 深度扫描时跳过的第三方库（减少噪音、加快扫描），参考 SnowEyes
const SKIP_JS = [
  /jquery/i, /^(vue|vue-router|vuex|react|react-dom)/i, /bootstrap/i,
  /(layui|element-ui|ant-design|echarts|chart|highcharts|lodash|moment|axios)/i,
  /(polyfill|modernizr|dataTables|select2|tinymce|underscore|backbone)/i,
  /\b(zh|en)[.-]?min\.js$/i
];

const CATEGORY_LABELS = {
  ip: "IP", ip_port: "IP:端口", domain: "域名", email: "邮箱", mobile: "手机号",
  idcard: "身份证", jwt: "JWT", aliyun_ak: "阿里云AK", tencent_ak: "腾讯云AK",
  baidu_ak: "百度云AK", volc_ak: "火山AK", jdbc: "JDBC连接串", api_key: "API Key",
  swagger: "Swagger", shiro: "Shiro", admin_path: "敏感路径", algorithm: "加密算法",
  aws_ak: "AWS密钥", google_api: "Google API", github_token: "GitHub Token", gitlab_token: "GitLab Token",
  wechat: "微信密钥", wecom: "企业微信密钥", alipay: "支付宝密钥", credential: "账号密码",
  session: "Session/Cookie", company: "公司名", webpack: "Webpack", django: "Django"
};

// ---------- 存储 ----------
async function getStore() {
  const obj = await chrome.storage.session.get(STORE_KEY);
  return obj[STORE_KEY] || {};
}
async function setStore(store) {
  await chrome.storage.session.set({ [STORE_KEY]: store });
}
function freshTab() {
  return { endpoints: [], findings: {}, scripts: [], progress: { scanning: false, done: 0, total: 0 }, updatedAt: Date.now() };
}

function extractFindings(text) {
  const out = {};
  if (!text) return out;
  for (const [cat, re] of Object.entries(RULES)) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m && m.length) out[cat] = [...new Set(m)];
  }
  return out;
}

function mergeFindings(tab, found) {
  for (const [cat, arr] of Object.entries(found || {})) {
    if (!tab.findings[cat]) tab.findings[cat] = [];
    const set = new Set(tab.findings[cat]);
    for (const v of arr) if (!set.has(v)) { set.add(v); tab.findings[cat].push(v); }
  }
}

async function getSettings() {
  const s = await chrome.storage.local.get(["safeMode", "allowlist"]);
  return {
    safeMode: s.safeMode !== false,                 // 默认开
    allowlist: Array.isArray(s.allowlist) ? s.allowlist : []
  };
}

function hostAllowed(host, allowlist) {
  for (const w of allowlist) {
    const ww = String(w).trim();
    if (ww && (host.endsWith(ww) || host === ww)) return false; // 白名单内跳过
  }
  return true;
}

// ---------- 深度扫描 JS ----------
async function deepScan(tabId) {
  const store = await getStore();
  const tab = store[tabId] || freshTab();
  if (tab.progress.scanning) return;

  const { safeMode } = await getSettings();
  let scripts = (tab.scripts || []).slice();
  if (safeMode) scripts = scripts.filter((u) => /\.js(\?|$)/i.test(u));
  // 跳过常见第三方库（jquery/vue/echarts 等），减少噪音
  scripts = scripts.filter((u) => !SKIP_JS.some((re) => re.test(u)));

  tab.progress = { scanning: true, done: 0, total: scripts.length };
  store[tabId] = tab;
  await setStore(store);
  updateBadge();

  for (const url of scripts) {
    try {
      const res = await fetch(url, { credentials: "omit", redirect: "follow", cache: "default" });
      const text = await res.text();
      mergeFindings(tab, extractFindings(text));
    } catch (e) { /* 跨域/失败忽略 */ }
    tab.progress.done++;
    await setStore(store);
  }
  tab.progress.scanning = false;
  await setStore(store);
  updateBadge();
}

function findingsCount(tab) {
  let n = 0;
  for (const arr of Object.values(tab.findings || {})) n += arr.length;
  return n;
}
function updateBadge() {
  // 角标只对当前活动标签页有意义，这里用全局近似：取最近活动标签页的计数
  chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    if (!tab || tab.id == null) return;
    const store = await getStore();
    const t = store[tab.id];
    const n = t ? findingsCount(t) + t.endpoints.length : 0;
    chrome.action.setBadgeText({ text: n > 0 ? String(n > 999 ? "999+" : n) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#4f8cff" });
  }).catch(() => {});
}

// ---------- 消息 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.kind) return { ok: false };
    switch (msg.kind) {
      case "apiScope.add": {
        const tabId = sender.tab ? sender.tab.id : msg.tabId;
        if (tabId == null) return { ok: false };
        const store = await getStore();
        const tab = store[tabId] || freshTab();
        const list = Array.isArray(msg.list) ? msg.list : [msg.data];
        for (const r of list) tab.endpoints.push(Object.assign({ tabId }, r));
        if (tab.endpoints.length > MAX_PER_TAB) tab.endpoints.splice(0, tab.endpoints.length - MAX_PER_TAB);
        store[tabId] = tab;
        await setStore(store);
        updateBadge();
        return { ok: true, count: tab.endpoints.length };
      }

      case "apiScope.pageSource": {
        // content 上报：页面 HTML + script 列表
        const tabId = sender.tab ? sender.tab.id : msg.tabId;
        if (tabId == null) return { ok: false };
        const { allowlist } = await getSettings();
        const host = (sender.tab && sender.tab.url) ? new URL(sender.tab.url).hostname : "";
        const store = await getStore();
        const tab = store[tabId] || freshTab();

        if (msg.scripts && msg.scripts.length) {
          const set = new Set(tab.scripts || []);
          for (const s of msg.scripts) set.add(s);
          tab.scripts = [...set];
        }
        // 页面源码本身先跑一遍正则
        mergeFindings(tab, extractFindings(msg.html || ""));
        tab.updatedAt = Date.now();
        store[tabId] = tab;
        await setStore(store);
        updateBadge();

        // 白名单外的页面，自动启动深度扫描
        if (hostAllowed(host, allowlist)) deepScan(tabId);
        return { ok: true };
      }

      case "apiScope.deepScan": {
        deepScan(msg.tabId);
        return { ok: true };
      }

      case "apiScope.getByTab": {
        const store = await getStore();
        const tab = store[msg.tabId] || freshTab();
        return {
          endpoints: tab.endpoints,
          findings: tab.findings,
          progress: tab.progress,
          labels: CATEGORY_LABELS,
          tabId: msg.tabId
        };
      }

      case "apiScope.clear": {
        const store = await getStore();
        delete store[msg.tabId];
        await setStore(store);
        updateBadge();
        return { ok: true };
      }
      case "apiScope.clearAll": {
        await setStore({});
        updateBadge();
        return { ok: true };
      }
      default:
        return { ok: false, error: "unknown kind" };
    }
  })().then(sendResponse);
  return true;
});

// 导航时清空旧数据
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  chrome.storage.session.get(STORE_KEY).then((obj) => {
    const store = obj[STORE_KEY];
    if (store && store[tabId]) {
      delete store[tabId];
      chrome.storage.session.set({ [STORE_KEY]: store });
    }
  }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
});
