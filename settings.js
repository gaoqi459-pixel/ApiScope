/** ApiScope 配置页逻辑 */
const $ = (s) => document.querySelector(s);

function load() {
  chrome.storage.local.get(["safeMode", "allowlist"]).then((s) => {
    $("#safeMode").checked = s.safeMode !== false; // 默认 true
    $("#allowlist").value = (s.allowlist || []).join("\n");
  });
}

function save() {
  const allowlist = $("#allowlist").value.split("\n").map((x) => x.trim()).filter(Boolean);
  chrome.storage.local.set({
    safeMode: $("#safeMode").checked,
    allowlist
  }).then(() => {
    const t = $("#saved");
    t.style.visibility = "visible";
    setTimeout(() => (t.style.visibility = "hidden"), 1200);
  });
}

$("#save").addEventListener("click", save);
$("#clear").addEventListener("click", () => {
  if (!confirm("确认清空所有标签页已采集的数据？")) return;
  chrome.runtime.sendMessage({ kind: "apiScope.clearAll" }, () => {
    const t = $("#saved");
    t.textContent = "已清空 ✓";
    t.style.visibility = "visible";
    setTimeout(() => { t.style.visibility = "hidden"; t.textContent = "已保存 ✓"; }, 1200);
  });
});

load();
