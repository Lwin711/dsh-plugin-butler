# 插件管家 · Plugin Butler

一个控制台，管理 DSH 里的全部插件：一份清单、一列开关、一套启动策略。

## 安装

从 GitHub Release 的 tarball 安装，装进 profile 的是真实副本，源码目录可以删：

```
plugin_manager install_bundle(target=https://github.com/Lwin711/dsh-plugin-butler/releases/download/v0.2.0/dsh-plugin-butler-0.2.0.tgz)
```

用本地目录安装会在 profile 里留下 `link:`，删掉源码目录插件就失效（包里会出现
`availability: "missing"`）——那种装法只适合改代码时用。

装好后重启 DSH，在 **设置 → 插件管家** 打开面板。

## 它解决什么

DSH 的插件层是启动时一次性挂载的。第三方插件越多，每次冷启动要加载的模块就越多。
插件管家把「加载哪些插件」变成可切换的策略：

| 模式 | 行为 |
| --- | --- |
| 手动（默认） | 只提供清单和开关，不自动改动任何插件。装上不会破坏现状。 |
| 精简启动 | 启动时只载核心插件（`@deepseek-ai/*` 与插件管家自身），其余收起。 |
| 全部载入 | 每次启动都拉起全部插件，功能最全、启动最慢。 |

## 语义

- **核心行永不被自动停用**：`@deepseek-ai/` 开头的模块和插件管家自身。
- **管家自身不能被自己关掉**：两处清单都会给它打「管家自身」徽标，开关是禁用的并说明原因，
  `/set` 与 `/bundle` 对它的请求一律 `409`——从面板上关掉自己会在请求途中拆掉面板，
  真要停用它请到插件市场。
- **本次会话内的启用是有租约的**：精简模式下点开一个插件，它就正常加载；下一次启动时租约会过期，
  该插件自动收起。所以「关掉 DSH 以后其他插件都关掉」在行为上成立，只是由下一次启动来执行。
- **常驻（Pin）**：把一行钉住，任何模式下都不会被自动停用。插件被卸载后，失效的常驻记录会在
  下一次启动时自动清理。
- **下次启动预览**：面板实时显示「下次启动：收起 N · 拉起 M」，就是当前策略对下次启动的结果，
  不用等到重启才知道。

## 两个粒度

- **插件包（bundle）**：按包启用/停用，作用于包内全部模块。来自 profile 的包可直接切换；
  `availability: "missing"`（链接失效）或 `readOnlyReason` 存在的包会被拒绝并给出原因。
- **单行（entry）**：按 `entryId` 精确开关单个插件行，适合只想留一个模块的场景。

## 平台限制（已知）

Host 侧没有 `shutdown` / `exit` 事件，`setPluginEnabled` 只有「持久化并立即应用」一种语义，
没有「只写配置、不应用」的通道。因此「退出时立刻停用」无法在退出瞬间完成，
只能由下一次启动时的启动策略执行，最多晚一个启动周期。

## 面板

设置 → 插件管家（`settings.section`，order 45）。包含：

- 模式卡片与「立即精简 / 全部启用」批量操作；
- 统计条（插件数、已启用、可管理、插件包、常驻）与本次启动标识；
- 下次启动预览；
- 插件清单：本地化标题、模块名、`fiberPhase` 徽标（待加载/加载中/停止中/加载失败）、
  只读原因（需在插件市场管理 / 无法定位）、常驻标记、单行开关；
- 插件包清单：版本、模块数、可用性（未安装/已缺失/官方）、安装异常、只读原因、整包开关；
  点左侧三角可以展开包内模块，看到每个模块的标题、模块名、当前开关状态和加载阶段，
  没有对应插件行的模块会标成「未挂载」；
- 搜索框同时过滤插件与插件包。

插件包清单一律只列「与当前 profile 有关」的包（已安装、已启用、`availability: profile`
或带安装异常），因为清单接口会连带返回大量只是「可安装」的包；输入关键字搜索时才放开，
这样既能定位任意包，又不会让主列表被几十行官方包淹掉。

页面每 4 秒比对一次 `GET /revision`（轻量，只读一个计数器），并在窗口重新获得焦点时立刻刷新；
所以从插件市场装、卸插件后，这里会自动跟上，不需要手动刷新。如果宿主还是旧版本、
没有 `/revision` 路由，面板会自动退回「每次都读完整快照」，只是流量大一点，功能不受影响。

## 状态

`%DSH_HOME%\butler\state.json`（无 `DSH_HOME` 时落在 profile 上一层目录下的 `butler\`）：

```json
{
  "version": 1,
  "mode": "lean",
  "pinned": ["include:mynote"],
  "leases": {}
}
```

`leases` 记录「本次启动为了让你用上而临时拉起的行」，值是本进程的 `bootId`；下次启动时键值不匹配，
租约自然作废。写入走临时文件 + `rename`，不会读到半个文件。

## 接口

Host 注册 7 个同源 JSON 路由（仅回环地址可用，`sec-fetch-site: cross-site` 与外部 `Origin` 一律 403；
写操作要求 `POST`）：

- `GET  /dsh-butler/api/state` — 清单 + 插件包 + 策略 + 下次启动预览 + 计数
- `GET  /dsh-butler/api/revision` — `{ revision, bootId }`，供面板轮询
- `POST /dsh-butler/api/mode` — `{ mode: "observe" | "lean" | "all" }`（切到 lean/all 会立即执行一次收敛）
- `POST /dsh-butler/api/sweep` — `{ mode: "lean" | "all" }`
- `POST /dsh-butler/api/set` — `{ entryId, enabled }`
- `POST /dsh-butler/api/bundle` — `{ name, enabled }`
- `POST /dsh-butler/api/pin` — `{ entryId, pinned }`

所有写操作串行执行，并返回逐行 `ChangeResult` 摘要（`application` / `restartReason` / `error` / `warnings`）。
错误码：`400` 参数不合法、`404` 未知行或包、`405` 非 POST、`409` 只读或不可切换（含管家自身）、
`503` 服务未就绪。

`plugin-manager/changed` 事件会让 `revision` 自增，因此任何面板、市场或命令行做的改动都会反映到这里。

## 自测

三套，都不依赖 DSH 运行时（假 Cordis 上下文 / 假 React），可单独运行：

```powershell
node .butler-test\smoke.mjs         # Host：路由 + 状态机
node .butler-test\client-smoke.mjs  # 客户端装配：槽位注册 + 文案字典
node .butler-test\render-smoke.mjs  # 面板渲染：真实组件树 + 交互
```

- `smoke.mjs`：用假 Cordis 上下文跑真实的 `apply()`——路由注册、清单/插件包快照、跨域拒绝、
  revision 事件、单行与整包切换、只读 409、管家自身的 409、常驻保护、精简收敛、下次启动预览、
  失效常驻清理、第二个启动实例。
- `client-smoke.mjs`：抓 `__ModuleLoader__` 的载荷，校验 `settings.section` 的注册（id/order/label/locale）、
  zh/en 字典键对齐、源码里每个字面量 `t('…')` 都有翻译、客户端引用了全部 7 个端点、
  轮询与 focus/visibilitychange 监听，以及 disposer 真的注销。
- `render-smoke.mjs`：自带迷你 React（hooks + 重渲染循环）和 fetch 桩，把面板真渲染成一棵树，
  断言不抛错、不把翻译 key 直接显示给用户、条目/插件包/状态文件路径都渲染出来、
  「可安装但未安装」的包不进列表、只有可切换的行才带点击回调、展开插件包能看到包内模块，
  并点一次行内开关确认会 `POST /set` 且带上翻转后的值。