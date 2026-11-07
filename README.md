# 插件管家 · dsh-plugin-butler

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的插件管家：一份清单、一列开关、一套启动策略，
把「每次冷启动要加载哪些插件」变成可切换的模式，并在设置页里直接管理。

仓库地址：<https://github.com/Lwin711/dsh-plugin-butler>

```powershell
git clone https://github.com/Lwin711/dsh-plugin-butler.git
```

插件本体与自测代码分居两个目录：

```
dsh-plugin-butler/   npm 包本体（Host 路由 + 客户端设置页 + 文案）
.butler-test/        三套不依赖 DSH 运行时的自测
```

## 它做什么

- **三种启动模式**：手动（默认，只给清单不动手）、精简启动（只载核心插件，其余下次启动收起）、
  全部载入（每次启动拉起全部插件）。
- **两个粒度**：按插件包（bundle）整体开关，或按 `entryId` 精确开关单行。
- **本次租约 + 常驻**：精简模式下临时点开的插件，下次启动自动收起；钉住（pin）的行任何模式都不动。
- **下次启动预览**：面板实时显示「收起 N · 拉起 M」，不用重启才知道结果。
- **自我保护**：管家不会提供关掉自己的开关，`/set`、`/bundle` 对自身一律 409。

## 安装

从 GitHub Release 的 tarball 安装（推荐，脱离本地目录，装完源码目录可以随便删）：

```
plugin_manager install_bundle(target=https://github.com/Lwin711/dsh-plugin-butler/releases/download/v0.2.0/dsh-plugin-butler-0.2.0.tgz)
```

要在 DSH 设置页里点装，就下载同一个 tarball 后用「安装本地文件」选它。

也可以从源码目录安装 —— 注意这种装法在 profile 里留下的是 `link:`，删掉源码目录插件就失效：

```powershell
plugin_manager install_bundle(target=<仓库路径>\dsh-plugin-butler)
```

装好后重启 DSH，在 **设置 → 插件管家** 打开面板。

## 自测

不需要 DSH 运行时，也不联网（假 Cordis 上下文 / 假 React）：

```powershell
node .butler-test\smoke.mjs         # Host：7 个路由 + 状态机
node .butler-test\client-smoke.mjs  # 客户端装配：槽位注册 + 文案字典
node .butler-test\render-smoke.mjs  # 面板渲染：真实组件树 + 交互
```

## 已知限制

DSH 的 Host 侧没有 `shutdown` / `exit` 事件，`setPluginEnabled` 只有「持久化并立即应用」一种语义，
所以「退出时立刻停用」只能由下一次启动的启动策略执行，最多晚一个启动周期。

状态保存在 `%DSH_HOME%\butler\state.json`（模式、常驻列表、本次租约），写入走临时文件 + `rename`。

## 许可

[MIT](LICENSE)。