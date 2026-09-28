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
  mobile:   /(?<![\d.])(?:13\d|14[01456879]|15[0-35-9]|16[2567]|17[0-8]|18\d|19[0-35-9])\d{8}(?!\d)/g,
  idcard:   /(?<![0-9a-zA-Z])[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?![0-9a-zA-Z])/g,
  jwt:      /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g,
  aliyun_ak:/\bLTAI[A-Za-z0-9]{12,30}\b/g,
  tencent_ak:/\bAKID[A-Za-z0-9]{13,40}\b/g,
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
  django:   /\bcsrfmiddlewaretoken\b/i,
  // —— 企业级凭据/密钥/连接串（参考 TruffleHog / Gitleaks 公开规则）——
  private_key:/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  aws_secret:/(?:aws_secret_access_key|secret_access_key|aws_secret)["'\s]?[:=]\s*["']?([A-Za-z0-9/+=]{40})\b/g,
  secret_key:/(?:secretKey|secret_key|SecretKey|AccessKeySecret|accessKeySecret|access_key_secret|appSecret|app_secret|clientSecret|client_secret|secretAccessKey|SecretAccessKey|AWS_SECRET_ACCESS_KEY|PRIVATE_KEY_SECRET|SIGNING_SECRET|signing_secret)["'\s]*[:=]\s*["']([A-Za-z0-9/+=_\-.]{16,128})["']/g,
  s3_bucket:/\b[a-z0-9.\-]+\.s3[.-][a-z0-9-]+\.amazonaws\.com\b/gi,
  aliyun_oss:/\b[a-z0-9.\-]+\.oss-[a-z0-9-]+\.aliyuncs\.com\b/gi,
  tencent_cos:/\b[a-z0-9.\-]+\.cos\.[a-z0-9-]+\.myqcloud\.com\b/gi,
  slack_token:/\bxox[baprs]-[0-9a-zA-Z-]{10,72}\b/g,
  slack_webhook:/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+/g,
  discord_webhook:/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g,
  telegram:/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
  stripe:/\b(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{20,}\b/g,
  sendgrid:/\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
  mailgun:/\bkey-[0-9a-zA-Z]{32}\b/g,
  mongodb:/\bmongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
  postgres_url:/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi,
  mysql_url:/\bmysql:?\/\/[^\s"'<>]+/gi,
  redis_url:/\bredis:?\/\/[^\s"'<>]+/gi,
  bearer:/\bBearer\s+[a-zA-Z0-9\-._~+/=]{20,}/g,
  internal_ip:/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
  basic_auth:/https?:\/\/[^:\s\/]+:[^@\s]+@/g,
  basic_auth_hdr:/\bBasic\s+[A-Za-z0-9+/]{18,}={0,2}\b/g,
  auth_header:/["'\[]*[Aa]uthorization["'\]]*\s*[:=]\s*['"]?\b(?:[Tt]oken\s+)?[a-zA-Z0-9\-_+/]{20,500}['"]?/g,
  jd_ak:    /\bJDC_[0-9A-Z]{25,40}\b/g,
  crypto_usage:/\b(?:CryptoJS\.(?:AES|DES|RC4)|JSEncrypt|KJUR|md5|sha1|sha256|sha512)\s*\(/g,
  // —— 源码/敏感文件暴露 ——
  sourcemap:/\/\/#\s*sourceMappingURL=([^\s"'<>]+)/g,
  git_ref:  /(?:^|["'\/])\.git\/(?:config|HEAD|index|refs|logs)/gi,
  env_ref:  /(?:^|["'\/])\.env(?:\.|["'\/]|["'\s])/gi,
  swagger_path:/\/swagger-ui\.html|\/v[23]\/api-docs|\/swagger\.json/gi,
  actuator: /\/actuator\/(?:health|env|heapdump|beans|mappings|configprops|trace)/gi,
  druid:    /\/druid\/(?:index\.html|login\.html|datasource\.json|websession\.json)/gi
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
  session: "Session/Cookie", company: "公司名", webpack: "Webpack", django: "Django",
  private_key: "私钥文件", aws_secret: "AWS SecretKey", secret_key: "SecretKey", s3_bucket: "S3 Bucket",
  aliyun_oss: "阿里云 OSS", tencent_cos: "腾讯云 COS", slack_token: "Slack Token",
  slack_webhook: "Slack Webhook", discord_webhook: "Discord Webhook", telegram: "Telegram Bot",
  stripe: "Stripe Key", sendgrid: "SendGrid Key", mailgun: "Mailgun Key",
  mongodb: "MongoDB 连接串", postgres_url: "PostgreSQL 连接串", mysql_url: "MySQL 连接串",
  redis_url: "Redis 连接串", bearer: "Bearer Token", internal_ip: "内网 IP", basic_auth: "Basic Auth",
  basic_auth_hdr: "Basic 凭证", auth_header: "Authorization 头", jd_ak: "京东云 AK", crypto_usage: "前端加密调用",
  sourcemap: "SourceMap 泄露", git_ref: ".git 目录暴露", env_ref: ".env 文件暴露",
  swagger_path: "Swagger 文档", actuator: "Actuator 端点", druid: "Druid 监控台", security_headers: "安全头缺失"
};

// 风险等级：0=严重 1=高危 2=中危
const SEVERITY = {
  // 严重：直接泄露密钥/凭据/私钥
  private_key:0, aws_secret:0, secret_key:0, aliyun_ak:0, tencent_ak:0, baidu_ak:0, volc_ak:0, aws_ak:0, jd_ak:0,
  google_api:0, github_token:0, gitlab_token:0, wechat:0, wecom:0, alipay:0, credential:0, session:0,
  jdbc:0, mongodb:0, postgres_url:0, mysql_url:0, redis_url:0, bearer:0, basic_auth:0, basic_auth_hdr:0,
  auth_header:0, slack_token:0, slack_webhook:0, discord_webhook:0, telegram:0, stripe:0, sendgrid:0,
  mailgun:0, s3_bucket:0, aliyun_oss:0, tencent_cos:0,
  // 高危：PII / 已知漏洞端点 / 信息泄露
  jwt:1, idcard:1, mobile:1, internal_ip:1, swagger:1, shiro:1, admin_path:1,
  git_ref:1, env_ref:1, swagger_path:1, actuator:1, druid:1, sourcemap:1, security_headers:1,
  // 中危：指纹/加密/联系方式
  email:2, algorithm:2, crypto_usage:2, company:2, webpack:2, django:2, api_key:2
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
      extractEndpointsFromJs(text, url, tab);
      // 自动拼接 sourcemap 地址并探测是否存在
      probeSourceMap(url, text, tab);
    } catch (e) { /* 跨域/失败忽略 */ }
    tab.progress.done++;
    await setStore(store);
  }
  await checkSecurityHeaders(tabId, tab);
  tab.progress.scanning = false;
  await setStore(store);
  updateBadge();
}

// 从 JS 源码里提取写死的 API 绝对路径（参考 FindSomething / Phantom）
const STATIC_EXT = /\.(js|mjs|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|html?|txt|xml|webp|avif|mp4|webm)(\?|$)/i;
const NOISE_DIR = /^\/(node_modules|static|assets?|public|fonts?|images?|img|css|js|lib(?:s)?|dist|build|chunk)\//i;
function extractEndpointsFromJs(text, baseUrl, tab) {
  if (!text) return;
  const re = /["'`](\/[A-Za-z0-9_\-]{1,}(?:\/[A-Za-z0-9_.\-]{1,80})*)(?=["'`?\s:,;)])/g;
  let m;
  const have = new Set(tab.endpoints.map((e) => e.url));
  let added = 0;
  while ((m = re.exec(text))) {
    let p = m[1].replace(/[&"'`\s.;,)]+$/, "");
    if (p.length < 2 || p.length > 120) continue;
    if (STATIC_EXT.test(p) || NOISE_DIR.test(p)) continue;
    if (!/^\//.test(p)) continue;
    if (have.has(p)) continue;
    have.add(p);
    tab.endpoints.push({ method: "GET", url: p, status: 0, type: "api", source: "js", time: Date.now() });
    added++;
  }
  if (added && tab.endpoints.length > MAX_PER_TAB) tab.endpoints.splice(0, tab.endpoints.length - MAX_PER_TAB);
}

// 自动拼接 sourceMappingURL / xxx.js.map 并探测可达性
async function probeSourceMap(jsUrl, jsText, tab) {
  try {
    const base = jsUrl.split("#")[0].split("?")[0];
    const candidates = [];
    // 1) 源码里 sourceMappingURL=xxx
    const m = /\/\/#\s*sourceMappingURL=([^\s"'<>]+)/.exec(jsText || "");
    if (m) {
      candidates.push(new URL(m[1], jsUrl).href);
    }
    // 2) 直接拼 .map
    if (base.endsWith(".js")) candidates.push(base + ".map");
    for (const mapUrl of [...new Set(candidates)]) {
      const r = await fetch(mapUrl, { method: "HEAD", credentials: "omit" });
      if (r.ok && /(json|application)/.test(r.headers.get("content-type") || "")) {
        mergeFindings(tab, { sourcemap: [mapUrl] });
      }
    }
  } catch (e) { /* 忽略 */ }
}

// HTTP 安全响应头检查（HEAD 请求）
async function checkSecurityHeaders(tabId, tab) {
  try {
    const [cur] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = cur && cur.id === tabId ? cur.url : null;
    if (!url || !/^https?:/.test(url)) return;
    const res = await fetch(url, { method: "HEAD", credentials: "omit", redirect: "follow" });
    const miss = [];
    if (!res.headers.get("content-security-policy")) miss.push("缺少 CSP");
    if (!res.headers.get("x-frame-options")) miss.push("缺少 X-Frame-Options（点击劫持）");
    if (!res.headers.get("strict-transport-security")) miss.push("缺少 HSTS");
    if (!res.headers.get("x-content-type-options")) miss.push("缺少 X-Content-Type-Options");
    if (!res.headers.get("referrer-policy")) miss.push("缺少 Referrer-Policy");
    if (miss.length) mergeFindings(tab, { security_headers: miss });
  } catch (e) { /* HEAD 不支持时忽略 */ }
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
        extractEndpointsFromJs(msg.html || "", (sender.tab && sender.tab.url) || location.origin, tab);
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
          severity: SEVERITY,
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
