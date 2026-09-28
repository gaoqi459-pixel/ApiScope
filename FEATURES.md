# ApiScope 功能说明文档

> 本文档详细介绍 ApiScope 浏览器扩展的各项功能、实现机制、分类规则、导出格式与限制，面向使用者与二次开发者。

---

## 1. 功能总览

ApiScope 是一款基于 **Manifest V3** 的 Chromium 浏览器扩展，用于**自动采集网页上的全部 API 接口与 URL 端点**，并把结果以结构化的方式实时展示给用户。核心能力可概括为「**全段页面 API 提取**」——凡是页面加载过程中发生的网络请求、页面源码中出现的资源地址与接口路径，都会被尽量收集。

| 能力 | 说明 |
| ---- | ---- |
| 网络请求拦截 | 实时捕获 `fetch` 与 `XMLHttpRequest` 发起的请求 |
| DOM 静态扫描 | 扫描常见标签的属性 URL 与内联脚本中的路径 |
| 动态页面监听 | 通过 MutationObserver 持续采集异步加载内容 |
| 智能分类 | 自动区分「API 接口」与「普通 URL」 |
| 自动去重 | 避免同一接口被反复上报 |
| 交互面板 | 筛选、搜索、复制、导出、清空、重扫 |
| 本地存储 | 按标签页分桶，会话内持久化 |

---

## 2. 采集通道详解

### 2.1 网络请求拦截（实时）

扩展在页面注入的 `content.js` 中**包装了浏览器原生网络 API**，从而记录页面发起的每一次请求，无需开发者工具配合：

- **`window.fetch`**：包装原始 `fetch`，在调用前记录 `method` 与 `url`；在 Promise 兑现时再用真实 `response.url` 与 `status` 补全结果（拿到最终跳转地址与状态码）。
- **`XMLHttpRequest`**：包装 `prototype.open` 记录方法与地址，并监听 `loadend` 事件补全最终 `status`。

> 说明：包装**只读不改**，不对请求做任何拦截、篡改或阻断，因此不会影响页面正常功能。

### 2.2 DOM 静态资源扫描

页面注入后立即对以下标签的 URL 属性做一次全量扫描：

| 标签 | 属性 | 标签 | 属性 |
| ---- | ---- | ---- | ---- |
| `script` | src | `iframe` | src |
| `link` | href | `source` | src |
| `img` | src | `video` / `audio` | src |
| `a` | href | `object` | data |
| `form` | action | `embed` | src |
| `meta` | content（http-equiv=refresh 等） | | |

同时对以下**文本区域**做 URL 正则提取：

- 内联 `<script>` 的代码文本（`inline-script`）
- `<style>` 与内联 `style` 属性中的资源引用（`style`）
- 事件处理器属性（`onclick` 等）文本（`attr:on*`）
- 页面整体 `outerHTML`（`page-html`，作为兜底）

### 2.3 动态内容监听（SPA 友好）

通过 `MutationObserver` 监听 `childList` 与 `src/href/action/data/content` 等属性变化。当 SPA 或异步渲染新增节点、替换图片、动态改写链接时，会立即对新节点与变更节点做增量扫描，保证「边滚边采」。

---

## 3. 分类与去重规则

### 3.1 接口 / URL 分类（type 字段）

命中以下任一**路径特征**即判为 `api`，否则为 `url`：

| 特征 | 示例 |
| ---- | ---- |
| 包含 `/api/` | `/api/users` |
| 包含 `/rest/` | `/rest/v2/orders` |
| 包含 `/graphql` | `/graphql` |
| 包含 `/v1/`、`/v2/` … `/vN/` | `/v1/login` |
| 以 `.json` 结尾 | `/data.json` |
| 以 `.php` / `.aspx` / `.jsp` / `.action` 结尾 | `/login.php` |

### 3.2 去重策略（key 计算）

- **API 接口**：`方法 + 去掉 query 参数的 URL`。例如 `GET /api/users?page=1` 与 `GET /api/users?page=2` 视为同一接口，只保留首条。
- **普通 URL**：`方法 + 保留 query 的 URL`。例如带不同查询参数的图片资源各自保留。

这样既避免了接口因参数变化而刷屏，又不丢失普通资源的差异性。

### 3.3 噪音过滤

内置统计 / 广告类域名黑名单（如 `google-analytics.com`、`googletagmanager.com`、`baidu.com`、`hm.baidu.com`、`sentry.io`、`facebook.net` 等），这些域名的请求默认不采集，减少无关噪音。名单可在 `content.js` 的 `BLOCKED_HOSTS` 中维护。

---

## 4. 弹窗交互（Popup）

点击工具栏图标打开弹窗，功能分区如下：

| 区域 | 功能 |
| ---- | ---- |
| 顶栏 | 扩展名称 + 采集状态指示灯（绿色=已就绪） |
| 过滤区 | 「全部 / API / URL」三段切换 + 关键字搜索框 |
| 统计区 | 实时显示 总数 / API 数 / URL 数 / 当前显示数 |
| 列表区 | 每条记录展示：方法徽标、类型标签、完整 URL、状态码、来源、采集时间 |
| 行操作 | 点击整行或行尾「复制」按钮复制该接口 |
| 底部按钮 | 重新扫描 / 复制列表 / 导出 JSON / 导出 CSV / 清空 |

交互细节：
- **方法徽标**按颜色区分：GET 绿、POST 橙、PUT 蓝、DELETE 红、PATCH 紫。
- **复制列表**复制的是当前筛选结果（受筛选与搜索影响）。
- **导出**不受筛选影响，导出该标签页全部数据。

---

## 5. 数据存储

- 存储介质：`chrome.storage.session`（浏览器会话内存），页面刷新/导航时自动清空对应标签页数据。
- 分桶方式：以 `tabId` 为键，每个标签页一个数组。
- 容量上限：单标签页最多 **5000** 条，超出后自动裁剪最早数据，防止内存膨胀。
- 数据字段：`method`、`url`、`status`、`type`、`source`、`time`。

---

## 6. 导出格式

### JSON（推荐，信息完整）

```json
[
  {
    "method": "GET",
    "url": "https://api.example.com/v1/users?page=1",
    "status": 200,
    "type": "api",
    "source": "fetch",
    "time": 1759017600000
  }
]
```

### CSV（便于表格 / 其他工具导入）

```csv
method,type,status,source,time,url
"GET","api",200,"fetch",1759017600000,"https://api.example.com/v1/users?page=1"
```

> CSV 以 UTF-8 BOM 开头，Excel 直接打开不乱码。

---

## 7. 权限说明

| 权限 | 用途 |
| ---- | ---- |
| `storage` | 使用 `chrome.storage.session` 存储采集数据 |
| `tabs` | 读取当前活动标签页 ID |
| `activeTab` | 与当前标签页交互（重新扫描指令） |
| `scripting` | （预留）注入扫描逻辑 |
| `host_permissions: <all_urls>` | 在所有页面注入内容脚本并拦截请求 |

> 提示：如需降低权限敏感度，可将 `host_permissions` 收敛为 `activeTab`，代价是仅对用户主动打开弹窗的页面生效。

---

## 8. 已知限制

1. **不采集请求体 / 响应体**：出于隐私与性能考虑，仅记录接口元信息，不捕获具体参数与返回数据。
2. **不采集 Cookie / 请求头**：如需携带凭据的接口清单，请配合开发者工具或 Burp 使用。
3. **正则提取的边界**：内联脚本中的字符串 URL 依赖正则匹配，个别混淆 / 动态拼接路径可能漏采，可点击「重新扫描」提高命中率。
4. **跨域 iframe**：`all_frames: true` 会注入所有子框架；受浏览器跨源限制，`page-html` 兜底扫描以当前 frame 为界。
5. **会话级存储**：数据在浏览器重启后不保留（`storage.session` 特性），如需长期保留请使用导出功能。

---

## 9. 后续规划

见 [README.md](./README.md#roadmap)。核心方向包括：请求参数 / 请求头详情捕获、域名聚合视图、历史记录持久化、右键快速复制、火狐兼容版、云同步开关等。

---

## 10. 二次开发指引

- **改分类规则**：修改 `content.js` 中 `API_PATTERNS`。
- **改黑名单**：修改 `content.js` 中 `BLOCKED_HOSTS`。
- **改容量上限**：修改 `background.js` 中 `MAX_PER_TAB`。
- **新增采集来源**：在 `content.js` 的 `scanElement` / `extractUrlsFromText` 中扩展。
- **改 UI**：编辑 `popup.html` / `popup.css` / `popup.js`。

---

## 11. v2.0 新增：敏感情报提取与深度扫描

### 11.1 提取类别（规则位于 background.js 的 RULES）

| 类别 key | 展示名 | 匹配目标 |
| ---- | ---- | ---- |
| ip | IP | IPv4 地址 |
| ip_port | IP:端口 | IPv4:port |
| domain | 域名 | 常见后缀域名 |
| email | 邮箱 | 电子邮件 |
| mobile | 手机号 | 中国大陆手机号 1[3-9]xxxxxxxxx |
| idcard | 身份证 | 18 位身份证号 |
| jwt | JWT | eyJ 开头的三段式 Token |
| aliyun_ak / tencent_ak / baidu_ak / volc_ak | 云厂商 AK | LTAI / AKID / AK / AKLT 开头的密钥 |
| jdbc | JDBC 连接串 | jdbc:xxx://... |
| api_key | API Key | api_key=xxx 形式 |
| swagger | Swagger | swagger-ui.html / swaggerVersion 等 |
| shiro | Shiro | rememberMe= / deleteMe |
| admin_path | 敏感路径 | /admin /console /dashboard 等 |
| algorithm | 加密算法 | md5/sha1/sha256/CryptoJS/JSEncrypt 等 |

### 11.2 深度扫描流程

1. content.js 在页面加载后收集所有 <script src> 与 link[rel=preload][as=script] 的 JS 地址，连同页面 outerHTML 一起上报 background。
2. background 先对页面源码跑一遍正则，得到首轮结果。
3. 对非白名单页面，后台自动 etch（credentials: omit，不携带 Cookie）拉取每个 JS 文件内容，再跑正则并合并去重。
4. 弹窗「敏感情报」页签实时轮询进度条，扫描完成后按类别分组展示、每类一键复制。
5. 安全模式下只抓取 .js 结尾资源，避免对图片/CSS 等发起非预期请求。

### 11.3 配置项（settings.html）

- **安全模式**：默认开启，深度扫描仅处理 JS 资源。
- **域名白名单**：每行一个后缀，命中的页面不启动深度扫描（避免目标站 CSRF token 失效）。
- **清空缓存**：一键清除所有标签页采集结果。

### 11.4 隐私说明

深度扫描仅用于你自己授权测试的目标；抓取时不携带任何 Cookie/凭据，不会在目标站点产生已登录会话请求。

