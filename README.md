# ApiScope — 页面 API 接口与敏感信息提取器

> 一款 Manifest V3 浏览器扩展（Chromium 内核，支持 Chrome / Edge）。被动式网页信息提取工具：一边**实时拦截页面 XHR/Fetch 接口**，一边用正则从**页面源码和外链 JS** 中提取 API 端点、IP/域名/邮箱/手机号/身份证/JWT/云密钥/Swagger/Shiro 等敏感情报。功能定位参考 `FindSomething`，代码完全独立、开箱即用。

![version](https://img.shields.io/badge/version-2.0.0-blue) ![MV3](https://img.shields.io/badge/Manifest-V3-green) ![license](https://img.shields.io/badge/license-MIT-lightgrey)

---

## 目录

- [特性](#特性)
- [工作原理](#工作原理)
- [安装](#安装)
- [使用方法](#使用方法)
- [目录结构](#目录结构)
- [导出格式示例](#导出格式示例)
- [技术栈](#技术栈)
- [隐私与安全](#隐私与安全)
- [Roadmap](#roadmap)
- [License](#license)

---

## 特性

### 接口采集
- **双通道采集**：实时拦截页面 `fetch` / `XMLHttpRequest` 网络请求，同时扫描页面 DOM（`script`、`link`、`img`、`a`、`iframe`、`form` 等标签）与内联脚本中的 URL，做到“请求 + 静态资源”全覆盖。
- **智能分类**：按路径特征（`/api/`、`/v1|v2/`、`/graphql`、`.json/.php/.aspx` 等）自动区分 **API 接口** 与 **普通 URL**。
- **自动去重**：API 接口按 `方法 + 去 query 的 URL` 去重；普通 URL 保留 query 去重。

### 敏感信息提取（v2.0 新增）
- **被动信息提取**：从页面源码中用正则匹配以下类别：
  - **资产信息**：IP、IP:端口、域名、邮箱
  - **个人信息**：手机号、身份证号
  - **凭据/密钥**：JWT、API Key、阿里云/腾讯云/百度云/火山引擎 AK、JDBC 连接串
  - **指纹特征**：Swagger、Shiro(rememberMe)、管理后台路径、加密算法(md5/aes/rsa…)
- **深度扫描 JS**：后台自动抓取页面引用的全部 JS 文件内容，继续跑正则，提取藏在打包脚本里的密钥与接口。
- **分类展示**：弹窗「敏感情报」标签页按类别分组展示，每类一键复制；扩展图标角标实时显示发现总数。

### 通用
- **实时统计**：弹窗顶部展示已采集接口数与敏感情报数。
- **筛选与搜索**：接口支持 全部 / API / URL 一键筛选与关键字搜索。
- **一键复制 / 导出**：单条复制、列表批量复制、按类复制，一键导出 **JSON / CSV**。
- **动态页面支持**：`MutationObserver` 监听动态加载 DOM，SPA 友好。
- **安全模式 / 白名单**：配置页可切换深度扫描范围、设置不主动扫描的域名白名单，避免触发目标站 CSRF token 失效。
- **导航自动清空**：页面刷新或跳转时自动清空旧数据。
- **隐私安全**：所有数据仅保存在**本地**，不采集 Cookie/请求体/响应体，不上传服务器。

---

## 工作原理

```
┌────────────────────┐     fetch/XHR 拦截      ┌─────────────────────┐
│  content.js        │ ───────────────────────▶ │                     │
│  (每个页面注入)      │    DOM 静态资源扫描        │   background.js      │
│                    │ ───────────────────────▶ │  (service worker)    │
│  拦截 + 扫描 + 分类 │                            │   按标签页分桶存储     │
└────────────────────┘                            └──────────┬──────────┘
                                                              │ chrome.storage.session
                                                              ▼
                                             ┌──────────────────────────┐
                                             │   popup.html / popup.js   │
                                             │   查询·筛选·搜索·复制·导出   │
                                             └──────────────────────────┘
```

1. **采集（content.js）**：注入到 `<all_urls>` 的每个页面，包装 `window.fetch` 与 `XMLHttpRequest` 记录请求方法、URL、状态码；同时扫描 DOM 属性与内联脚本文本，提取静态 URL 与接口路径。
2. **上报**：端点到 `background.js`，按标签页 ID 分桶存储，单标签页上限 5000 条防内存膨胀。
3. **展示（popup）**：点击工具栏图标，读取当前标签页数据，支持筛选、搜索、复制与导出。

---

## 安装

### 方式一：开发者模式加载（推荐，本地调试）

1. 将本仓库代码克隆或下载到本地：
   ```bash
   git clone https://github.com/gaoqi459-pixel/ApiScope.git
   ```
2. 打开浏览器扩展管理页：
   - Chrome：地址栏输入 `chrome://extensions/`
   - Edge：地址栏输入 `edge://extensions/`
3. 打开右上角 **开发者模式** 开关。
4. 点击 **加载已解压的扩展程序**，选择 `ApiScope` 文件夹。
5. 固定扩展图标，访问任意网页并打开弹窗即可看到采集结果。

### 方式二：打包为 CRX / 商店上架（正式发布）

将本目录打包为 zip 即可提交 Chrome Web Store，或在开发者模式下直接加载本目录。

---

## 使用方法

1. 安装并固定扩展图标后，访问目标网页（保持页面停留，让脚本有时间扫描与监听）。
2. 点击工具栏的 **ApiScope** 图标打开弹窗。
3. 顶部选择 **全部 / API / URL** 过滤类型，输入关键字搜索。
4. 点击单条记录即复制该接口；点击行尾 **复制** 按钮提示复制成功。
5. 使用底部按钮：
   - **重新扫描**：对当前页面强制再扫一遍（适合动态页面）。
   - **复制列表**：复制当前筛选结果的全部 URL（每行一条）。
   - **导出 JSON / CSV**：下载完整采集数据，可导入 Postman / Yakit / Burp。
   - **清空**：清空当前标签页的采集记录。

---

## 目录结构

```
ApiScope/
├── manifest.json        # MV3 扩展清单（权限、入口、图标、配置页声明）
├── background.js        # Service Worker：接口分桶存储 + 敏感信息正则引擎 + 深度扫描
├── content.js           # 内容脚本：fetch/XHR 拦截 + DOM 扫描 + 上报页面源码/JS 列表
├── popup.html           # 弹窗 UI（接口列表 / 敏感情报 双标签）
├── popup.css            # 弹窗样式（深色主题）
├── popup.js             # 弹窗逻辑：筛选/搜索/分类展示/深度扫描/导出
├── settings.html        # 配置页（安全模式、域名白名单、清理缓存）
├── settings.js           # 配置页逻辑
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   └── make_icons.py    # 图标生成脚本（PIL，可重复生成图标）
├── FEATURES.md          # 功能说明文档
├── README.md            # 本文件
├── LICENSE              # MIT 协议
└── .gitignore           # Git 忽略规则
```

---

## 导出格式示例

**JSON**
```json
[
  {
    "method": "GET",
    "url": "https://api.example.com/v1/users?page=1",
    "status": 200,
    "type": "api",
    "source": "fetch",
    "time": 1690000000000
  }
]
```

**CSV**
```csv
method,type,status,source,time,url
"GET","api",200,"fetch",1690000000000,"https://api.example.com/v1/users?page=1"
```

> 字段说明：`method` 请求方法；`url` 完整地址；`status` HTTP 状态码（拦截后补全）；`type` 类型（api/url）；`source` 采集来源（fetch/xhr/dom/xx/inline-script…）；`time` 采集时间戳。

---

## 技术栈

| 模块 | 技术 |
| ---- | ---- |
| 扩展体系 | Manifest V3，Content Script + Service Worker + Popup |
| 数据存储 | `chrome.storage.session`（本地、随会话、防丢数据） |
| 网络采集 | 包装 `window.fetch` 与 `XMLHttpRequest.prototype.open/send` |
| 动态监听 | `MutationObserver`（childList + attributes） |
| 前端 UI | 原生 HTML + CSS + JS，无第三方依赖 |

---

## 隐私与安全

- 所有采集数据**仅保存在本地浏览器**，不发送到任何服务器。
- 仅上报 URL / 方法 / 状态码等接口元信息，**不采集 Cookie、请求体、响应体**。
- 内置统计域名黑名单，减少无关流量。
- 如需用于授权测试，请遵守目标站点条款与当地法律法规。

---

## Roadmap

- [ ] 请求参数 / 请求头详情捕获
- [ ] 右键菜单快速「复制选中接口」
- [ ] 历史记录持久化（`chrome.storage.local`）与跨标签页汇总视图
- [ ] 域名 / 路径维度聚合与去重导出
- [ ] 火狐（WebExtensions）兼容版
- [ ] 云同步开关

---

## License

[MIT](./LICENSE) © 2026 ApiScope contributors
