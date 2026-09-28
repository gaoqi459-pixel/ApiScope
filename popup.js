/**
 * ApiScope — popup v2.1  (Apple-style chips UI)
 */
(() => {
  const $ = (s) => document.querySelector(s);

  let activeTabId = null;
  let endpoints = [];
  let findings = {};
  let labels = {};
  let progress = { scanning: false, done: 0, total: 0 };
  let filter = "all";
  let keyword = "";
  let pollTimer = null;

  // 每个类别的左边框颜色
  const CAT_COLOR = {
    api: "#bf5af2", url: "#0071e3",
    ip: "#0071e3", ip_port: "#0071e3", domain: "#0071e3", email: "#30d158",
    mobile: "#ff9f0a", idcard: "#ff9f0a", jwt: "#ff453a",
    aliyun_ak: "#ff6a00", tencent_ak: "#ff6a00", baidu_ak: "#ff6a00", volc_ak: "#ff6a00",
    aws_ak: "#ff6a00", google_api: "#ff6a00", github_token: "#ff453a", gitlab_token: "#ff453a",
    wechat: "#30d158", wecom: "#30d158", alipay: "#ff6a00",
    credential: "#ff453a", session: "#ff453a",
    jdbc: "#bf5af2", api_key: "#ff6a00", swagger: "#bf5af2", shiro: "#bf5af2",
    admin_path: "#bf5af2", algorithm: "#8e8e93", company: "#8e8e93",
    webpack: "#8e8e93", django: "#8e8e93",
    private_key: "#ff453a", aws_secret: "#ff9f0a", s3_bucket: "#ff9f0a", aliyun_oss: "#ff9f0a",
    tencent_cos: "#ff9f0a", slack_token: "#ff453a", slack_webhook: "#ff453a",
    discord_webhook: "#ff453a", telegram: "#ff453a", stripe: "#ff9f0a", sendgrid: "#ff9f0a",
    mailgun: "#ff9f0a", mongodb: "#bf5af2", postgres_url: "#bf5af2", mysql_url: "#bf5af2",
    redis_url: "#bf5af2", bearer: "#ff453a", internal_ip: "#5ac8fa", basic_auth: "#ff453a",
    basic_auth_hdr: "#ff453a", auth_header: "#ff453a", jd_ak: "#ff9f0a", crypto_usage: "#8e8e93"
  };

  const els = {
    statusDot: $("#statusDot"), statusText: $("#statusText"),
    tabs: document.querySelectorAll(".tab"), tabIndicator: $("#tabIndicator"),
    paneCollect: $("#pane-collect"), paneSecrets: $("#pane-secrets"), paneSettings: $("#pane-settings"),
    search: $("#search"), segBtns: document.querySelectorAll(".seg-btn"),
    collectBody: $("#collectBody"), findingsBody: $("#findingsBody"),
    badgeFindings: $("#badgeFindings"),
    btnDeep: $("#btnDeep"), progress: $("#progress"),
    progressText: $("#progressText"), progressFill: $("#progressFill"),
    optSafe: $("#optSafe"), optAllowlist: $("#optAllowlist"),
    btnSaveSettings: $("#btnSaveSettings"), btnClear: $("#btnClear")
  };

  function setStatus(on, text) {
    els.statusDot.className = "dot" + (on ? " on" : "");
    els.statusText.textContent = text;
  }
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      if (btn) { const old = btn.textContent; btn.textContent = "已复制"; setTimeout(() => (btn.textContent = old), 900); }
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    });
  }

  // 通用：渲染一个分组（标题 + 数量 + 复制全部 + chips）
  function renderGroup(container, title, count, items, color, opts = {}) {
    const g = document.createElement("div");
    g.className = "group";

    const head = document.createElement("div");
    head.className = "group-head";
    const left = document.createElement("span");
    left.className = "group-title";
    left.textContent = title;
    const cnt = document.createElement("span");
    cnt.className = "group-count"; cnt.textContent = "(" + count + ")";
    left.appendChild(cnt);

    const copy = document.createElement("button");
    copy.className = "group-copy"; copy.textContent = "复制全部";
    copy.addEventListener("click", () => copyText(items.join("\n"), copy));

    head.append(left, copy);
    g.appendChild(head);

    const chips = document.createElement("div");
    chips.className = "chips";
    if (!items.length) {
      chips.innerHTML = '<div class="chip empty">暂无数据</div>';
    } else {
      items.forEach((item, i) => {
        const c = document.createElement("div");
        c.className = "chip";
        c.style.setProperty("--c", color);
        c.style.animationDelay = (i * 15) + "ms";
        if (opts.method) {
          const m = document.createElement("span");
          m.className = "method"; m.textContent = item.method || "GET";
          c.appendChild(m);
        }
        c.appendChild(document.createTextNode(opts.method ? item.url : item));
        c.addEventListener("click", () => copyText(opts.method ? item.url : item, c));
        chips.appendChild(c);
      });
    }
    g.appendChild(chips);
    container.appendChild(g);
  }

  // 信息采集 tab
  function renderCollect() {
    els.collectBody.innerHTML = "";
    const list = endpoints.filter((r) => {
      if (filter !== "all" && r.type !== filter) return false;
      if (keyword && !(r.url + " " + r.method).toLowerCase().includes(keyword.toLowerCase())) return false;
      return true;
    });
    const apis = list.filter((r) => r.type === "api");
    const urls = list.filter((r) => r.type !== "api");
    renderGroup(els.collectBody, "API 接口（绝对路径）", apis.length, apis, "#bf5af2", { method: true });
    renderGroup(els.collectBody, "URL / 静态资源", urls.length, urls, "#0071e3", { method: true });
    if (findings.domain && findings.domain.length)
      renderGroup(els.collectBody, "域名", findings.domain.length, findings.domain, "#0071e3");
    if (findings.ip && findings.ip.length)
      renderGroup(els.collectBody, "IP", findings.ip.length, findings.ip, "#5ac8fa");
  }

  // 敏感情报 tab
  function renderFindings() {
    const SKIP = { domain: 1, ip: 1, ip_port: 1 };
  const cats = Object.keys(findings).filter((c) => findings[c] && findings[c].length && !SKIP[c]);
    const total = cats.reduce((s, c) => s + findings[c].length, 0);
    if (total > 0) {
      els.badgeFindings.textContent = total > 99 ? "99+" : total;
      els.badgeFindings.classList.remove("hidden");
    } else els.badgeFindings.classList.add("hidden");

    els.findingsBody.innerHTML = "";
    if (!cats.length) {
      renderGroup(els.findingsBody, "敏感情报", 0, [], "#8e8e93");
      return;
    }
    // 按类别数量从多到少排
    cats.sort((a, b) => findings[b].length - findings[a].length);
    for (const c of cats) {
      renderGroup(els.findingsBody, labels[c] || c, findings[c].length, findings[c], CAT_COLOR[c] || "#8e8e93");
    }
    renderProgress();
  }

  function renderProgress() {
    if (progress.scanning) {
      els.progress.classList.remove("hidden");
      const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
      els.progressText.textContent = `深度扫描中 ${progress.done}/${progress.total} · ${pct}%`;
      els.progressFill.style.width = pct + "%";
    } else if (progress.total > 0) {
      els.progress.classList.remove("hidden");
      els.progressText.textContent = `深度扫描完成 ${progress.done}/${progress.total}`;
      els.progressFill.style.width = "100%";
    } else els.progress.classList.add("hidden");
  }

  // tab 指示条动画
  function moveIndicator(tabBtn) {
    const parent = tabBtn.parentElement;
    const iw = tabBtn.offsetWidth;
    els.tabIndicator.style.width = iw + "px";
    els.tabIndicator.style.transform = `translateX(${tabBtn.offsetLeft}px)`;
  }

  function load() {
    if (activeTabId == null) return;
    chrome.runtime.sendMessage({ kind: "apiScope.getByTab", tabId: activeTabId }, (res) => {
      if (!res) return;
      endpoints = res.endpoints || [];
      findings = res.findings || {};
      labels = res.labels || {};
      progress = res.progress || { scanning: false, done: 0, total: 0 };
      renderCollect();
      renderFindings();
      if (progress.scanning) {
        if (!pollTimer) pollTimer = setInterval(load, 800);
      } else if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    });
  }

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) { setStatus(false, "无活动页"); return; }
    activeTabId = tab.id;
    setStatus(true, "采集就绪");

    // tab 切换
    els.tabs.forEach((t) => t.addEventListener("click", () => {
      els.tabs.forEach((x) => x.classList.toggle("active", x === t));
      moveIndicator(t);
      const name = t.dataset.tab;
      els.paneCollect.classList.toggle("hidden", name !== "collect");
      els.paneSecrets.classList.toggle("hidden", name !== "secrets");
      els.paneSettings.classList.toggle("hidden", name !== "settings");
      if (name === "settings") loadSettings();
    }));
    requestAnimationFrame(() => moveIndicator(document.querySelector(".tab.active")));

    els.search.addEventListener("input", (e) => { keyword = e.target.value.trim(); renderCollect(); });
    els.segBtns.forEach((b) => b.addEventListener("click", () => {
      els.segBtns.forEach((x) => x.classList.toggle("active", x === b));
      filter = b.dataset.filter; renderCollect();
    }));

    els.btnDeep.addEventListener("click", () => {
      chrome.runtime.sendMessage({ kind: "apiScope.deepScan", tabId: activeTabId });
      setTimeout(load, 300);
    });

    // 设置
    function loadSettings() {
      chrome.storage.local.get(["safeMode", "allowlist"]).then((s) => {
        els.optSafe.checked = s.safeMode !== false;
        els.optAllowlist.value = (s.allowlist || []).join("\n");
      });
    }
    els.btnSaveSettings.addEventListener("click", () => {
      chrome.storage.local.set({
        safeMode: els.optSafe.checked,
        allowlist: els.optAllowlist.value.split("\n").map((x) => x.trim()).filter(Boolean)
      }).then(() => {
        const old = els.btnSaveSettings.textContent;
        els.btnSaveSettings.textContent = "已保存 ✓";
        setTimeout(() => (els.btnSaveSettings.textContent = old), 1000);
      });
    });
    els.btnClear.addEventListener("click", () => {
      chrome.runtime.sendMessage({ kind: "apiScope.clear", tabId: activeTabId }, () => {
        endpoints = []; findings = {}; renderCollect(); renderFindings();
      });
    });

    load();
    setTimeout(load, 600);
  }

  init();
})();
