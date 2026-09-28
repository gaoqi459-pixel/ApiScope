/**
 * ApiScope — popup v2.0
 * 双标签：接口列表（endpoints）+ 敏感情报（findings），支持深度扫描。
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
  let currentPane = "endpoints";
  let pollTimer = null;

  const els = {
    statusDot: $("#statusDot"),
    statusText: $("#statusText"),
    counts: $("#counts"),
    list: $("#list"),
    empty: $("#empty"),
    search: $("#search"),
    segBtns: document.querySelectorAll(".seg-btn"),
    tabs: document.querySelectorAll(".tab"),
    paneEndpoints: $("#pane-endpoints"),
    paneFindings: $("#pane-findings"),
    badgeFindings: $("#badgeFindings"),
    findings: $("#findings"),
    findingsEmpty: $("#findingsEmpty"),
    btnDeep: $("#btnDeep"),
    progress: $("#progress"),
    progressText: $("#progressText"),
    progressFill: $("#progressFill"),
    btnRescan: $("#btnRescan"),
    btnCopy: $("#btnCopy"),
    btnExportJson: $("#btnExportJson"),
    btnExportCsv: $("#btnExportCsv"),
    btnSettings: $("#btnSettings"),
    btnClear: $("#btnClear")
  };

  function setStatus(on, text) {
    els.statusDot.className = "dot" + (on ? " on" : "");
    els.statusText.textContent = text;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- 接口列表 ----------
  function filtered() {
    return endpoints.filter((r) => {
      if (filter !== "all" && r.type !== filter) return false;
      if (keyword && !(r.url + " " + r.method).toLowerCase().includes(keyword.toLowerCase())) return false;
      return true;
    });
  }
  function renderEndpoints() {
    const list = filtered();
    els.counts.textContent = `共 ${endpoints.length} 条 · API ${endpoints.filter((r) => r.type === "api").length} · URL ${endpoints.filter((r) => r.type === "url").length} · 当前 ${list.length}`;
    els.list.innerHTML = "";
    if (!list.length) { els.empty.style.display = endpoints.length ? "none" : "block"; return; }
    els.empty.style.display = "none";
    for (const r of list) {
      const li = document.createElement("li");
      li.className = "item";
      const method = document.createElement("span");
      method.className = "method m-" + (r.method || "GET").toUpperCase();
      method.textContent = (r.method || "GET").toUpperCase();
      const type = document.createElement("span");
      type.className = "type-tag t-" + r.type;
      type.textContent = r.type === "api" ? "API" : "URL";
      const main = document.createElement("div");
      main.className = "main";
      const u = document.createElement("div");
      u.className = "url"; u.textContent = r.url;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `状态:${r.status || "-"} · 来源:${r.source || "-"}`;
      const copy = document.createElement("button");
      copy.className = "copy"; copy.textContent = "复制";
      copy.addEventListener("click", (e) => { e.stopPropagation(); copyText(r.url, copy); });
      li.addEventListener("click", () => copyText(r.url));
      main.append(u, meta);
      li.append(method, type, main, copy);
      els.list.appendChild(li);
    }
  }

  // ---------- 敏感情报 ----------
  function renderFindings() {
    const cats = Object.keys(findings).filter((c) => findings[c] && findings[c].length);
    // 角标
    const total = cats.reduce((s, c) => s + findings[c].length, 0);
    if (total > 0) {
      els.badgeFindings.textContent = total > 99 ? "99+" : total;
      els.badgeFindings.classList.remove("hidden");
    } else { els.badgeFindings.classList.add("hidden"); }

    els.findings.innerHTML = "";
    if (!cats.length) { els.findingsEmpty.style.display = "block"; return; }
    els.findingsEmpty.style.display = "none";

    for (const cat of cats) {
      const arr = findings[cat];
      const g = document.createElement("div");
      g.className = "fgroup";
      const head = document.createElement("div");
      head.className = "fgroup-head";
      const title = document.createElement("span");
      title.className = "fgroup-title";
      title.textContent = (labels[cat] || cat);
      const cnt = document.createElement("span");
      cnt.className = "fgroup-count"; cnt.textContent = arr.length;
      const copyBtn = document.createElement("button");
      copyBtn.className = "fgroup-copy"; copyBtn.textContent = "复制";
      copyBtn.addEventListener("click", () => copyText(arr.join("\n"), copyBtn));
      head.append(title, cnt, copyBtn);
      const body = document.createElement("div");
      body.className = "fgroup-body";
      for (const v of arr) {
        const it = document.createElement("div");
        it.className = "fitem"; it.textContent = v;
        body.appendChild(it);
      }
      g.append(head, body);
      els.findings.appendChild(g);
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
    } else {
      els.progress.classList.add("hidden");
    }
  }

  // ---------- 工具 ----------
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      if (btn) { const old = btn.textContent; btn.textContent = "✓"; setTimeout(() => (btn.textContent = old), 900); }
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    });
  }
  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function load() {
    if (activeTabId == null) return;
    chrome.runtime.sendMessage({ kind: "apiScope.getByTab", tabId: activeTabId }, (res) => {
      if (!res) return;
      endpoints = res.endpoints || [];
      findings = res.findings || {};
      labels = res.labels || {};
      progress = res.progress || { scanning: false, done: 0, total: 0 };
      renderEndpoints();
      renderFindings();
      // 扫描中则轮询
      if (progress.scanning) {
        if (!pollTimer) pollTimer = setInterval(load, 800);
      } else if (pollTimer) {
        clearInterval(pollTimer); pollTimer = null;
      }
    });
  }

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) { setStatus(false, "无活动标签页"); return; }
    activeTabId = tab.id;
    setStatus(true, "采集已就绪");

    // tab 切换
    els.tabs.forEach((t) => t.addEventListener("click", () => {
      els.tabs.forEach((x) => x.classList.toggle("active", x === t));
      currentPane = t.dataset.tab;
      els.paneEndpoints.classList.toggle("hidden", currentPane !== "endpoints");
      els.paneFindings.classList.toggle("hidden", currentPane !== "findings");
    }));

    // 接口筛选
    els.segBtns.forEach((b) => b.addEventListener("click", () => {
      els.segBtns.forEach((x) => x.classList.toggle("active", x === b));
      filter = b.dataset.filter; renderEndpoints();
    }));
    els.search.addEventListener("input", (e) => { keyword = e.target.value.trim(); renderEndpoints(); });

    // 深度扫描
    els.btnDeep.addEventListener("click", () => {
      chrome.runtime.sendMessage({ kind: "apiScope.deepScan", tabId: activeTabId });
      setTimeout(load, 300);
    });

    els.btnRescan.addEventListener("click", () => {
      chrome.tabs.sendMessage(activeTabId, { kind: "apiScope.rescan" }, () => setTimeout(load, 300));
    });
    els.btnCopy.addEventListener("click", () => {
      const list = filtered();
      if (list.length) copyText(list.map((r) => r.url).join("\n"));
    });
    els.btnExportJson.addEventListener("click", () => {
      download("apiscope_" + activeTabId + ".json", JSON.stringify({ endpoints, findings }, null, 2), "application/json");
    });
    els.btnExportCsv.addEventListener("click", () => {
      const head = "method,type,status,source,time,url";
      const rows = endpoints.map((r) => [r.method || "GET", r.type, r.status || 0, r.source || "", r.time || "", r.url]
        .map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","));
      download("apiscope_" + activeTabId + ".csv", "\ufeff" + [head].concat(rows).join("\r\n"), "text/csv");
    });
    els.btnSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
    els.btnClear.addEventListener("click", () => {
      chrome.runtime.sendMessage({ kind: "apiScope.clear", tabId: activeTabId }, () => { endpoints = []; findings = {}; renderEndpoints(); renderFindings(); });
    });

    load();
    setTimeout(load, 600);
  }

  init();
})();
