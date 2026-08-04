# Songloft LxBridge

Songloft LxBridge（中文名：Songloft 洛雪音源桥）把洛雪自定义音源脚本的解析能力接入 Songloft。

> v0.5.0 起插件永久内部标识为 `neo-lxbridge`。后续版本即使更改显示名称，也不再更改该标识。

## v0.8.0

下一版本：`v0.8.0`。

- 自定义目录默认平铺保存，不再按“歌手-专辑”自动创建目录，减少 Songloft 首页产生单曲文件歌单；
- 支持“歌曲名-歌手名”和“歌手名-歌曲名”两种文件命名顺序；
- 可选按歌手创建一级文件夹，关闭时歌曲直接保存到目标目录；
- Docker 环境支持目录简写：`/LxBridge` 自动解析为 `/app/music/LxBridge`；
- 设置页显示最终实际保存路径，并可管理常用目录；
- 可从 Songloft 已有歌曲路径中推断目录，作为输入建议；
- 新增“每次下载前询问目录”，单曲可临时选择目录和命名规则；
- 新增批量下载选中歌曲，整批只确认一次目录，然后继续按安全间隔串行下载；
- 下载任务保存目录与命名规则快照，重试不会受后续设置修改影响。

## v0.7.0

发布版本：`v0.7.0`（2026-08-04 发布）。

- 新增默认开启的“批量下载保护”，下载任务继续严格串行执行；
- 每首下载成功或失败后默认等待 5 秒，可在设置页调整为 2～60 秒；
- 新增播放地址解析保护，默认间隔 2 秒，可调整为 1～30 秒；
- 下载等待期间显示“安全间隔”和剩余秒数；
- 设置页增加保护开关、间隔参数、功能说明和关闭风险提示；
- 关闭保护只会取消等待间隔，下载任务仍不会并发执行。

## v0.6.1

发布版本：`v0.6.1`（2026-08-03 发布）。

- 修复部分 Songloft QuickJS 环境中音频响应头不提供 `.get()`，导致文件大小显示“未知”且探测说明为 `not a function` 的问题；
- 文件大小探测同时兼容标准 `Headers` 和普通响应头对象；
- 无法探测时显示可读原因，不再暴露无意义的运行时错误。
- 修复 Android 等手机文件选择器把 `.js` 音源文件置灰、只能选择 ZIP 的问题；选择后仍只允许上传 `.js` 和 `.zip`。

## v0.6.0

发布版本：`v0.6.0`（2026-08-03 发布）。

- 设置页新增“下载目录”，留空时继续使用 Songloft 默认 downloads；
- 支持填写 Songloft `music_path` 内的绝对目录，例如 `/音乐` 或 `/音乐/Songloft`；
- 保存后的目录仅作用于新下载任务，已排队任务会保留入队时的目录；
- 自定义目录使用 `{artist}-{album}/{title}` 模板，不再叠加 Songloft 默认的 `downloads/` 前缀；
- 下载管理继续显示 Songloft 返回的最终实际保存路径；
- 增加路径格式校验，并把越界、无法创建及不可写错误转换成明确提示。

## v0.5.3

发布版本：`v0.5.3`（2026-08-03 发布）。

- 修复网易云大型歌单显示“已加载 10 / 总数”但无法继续加载的问题；
- 根据网易云歌单的完整 `trackIds` 按页获取歌曲详情，不再依赖只包含前 10 首的 `tracks` 字段；
- 网易云歌单和排行榜共用同一套完整分页逻辑。

## v0.5.2

发布版本：`v0.5.2`（2026-08-03 发布）。

- 修复部分平台搜索歌单后只显示第一页 10 首歌曲的问题；
- 歌单和排行榜详情会自动按页加载、合并并去重；
- 增加重复页面与最大 500 首保护，避免异常接口导致循环或页面卡死；
- 加载过程中显示当前页数和已获取歌曲数量。

## v0.5.1

发布版本：`v0.5.1`（2026-08-03 发布）。

- “音乐发现”的热门歌单模式新增歌单关键词搜索；
- 支持按当前平台搜索酷我、酷狗、QQ 音乐、网易云和咪咕歌单；
- 搜索结果可直接进入歌单详情，并继续试听、下载、单曲导入或批量导入；
- 可一键清空搜索并返回平台热门歌单。

## v0.5.0

发布版本：`v0.5.0`（2026-08-03 发布）。

- 插件永久标识改为 `neo-lxbridge`，同时避开已有插件使用的 `lxmusic` 和 `lxbridge`；
- 管理页、API、歌曲归属、构建产物和发布文件统一使用 `neo-lxbridge`；
- 设置页新增 GitHub 仓库地址和永久插件标识信息；
- 保留对旧 `lxbridge:*` 和 `lxmusic:*` 浏览器设置的读取兼容，新设置写入 `neo-lxbridge:*`。

## v0.4.0

- 插件内部标识从 `lxmusic` 改为 `lxbridge`，解决与其他洛雪插件的安装冲突；
- 所有管理页和 API 路径迁移到 `/api/v1/jsplugin/lxbridge`；
- 音源管理列表新增“导出”按钮，可下载已保存的原始 `.js` 音源脚本；
- 新增“发现”页面，支持浏览酷我、酷狗、QQ 音乐、网易云和咪咕的排行榜与热门歌单；
- 榜单和歌单详情中支持试听、下载、单曲导入和批量选择导入；
- v0.4.0 会作为新插件安装，旧 `lxmusic` 存储不会自动迁移；请在确认原音源脚本可重新导入后再移除旧版。

## v0.3.4

- 保留 `hires` 原始请求参数，不再转换成 `flac24bit`；
- 新增并区分 `hires`、`flac24bit`、`atmos`、`atmos_plus`、`master`；
- 用户选择的音质始终优先原样请求，音源能力声明只影响尝试顺序；
- 仅在目标音质解析明确失败后逐级降级；
- 增加“允许自动降级”开关，关闭后高音质失败会直接报错；
- 下载确认框分别显示“请求音质”和“实际音质”；
- 网易云搜索额外读取歌曲详情中的 `hr`、`db`、`jm` 音质信息；
- 使用移动端兼容运行环境，并补齐 `meta.songId`、`meta.qualitys`、`meta._qualitys`，避免增强音源因歌曲信息不完整静默返回低码率地址。\n- 高音质地址拒绝 `HEAD`/Range 时不再导致内部错误，改为显示“大小未知”和探测原因，不阻断下载。

## v0.3.0

当前稳定版本：`v0.3.0`（2026-07-28 发布）。

- 新增独立“下载管理”页面；
- 分类查看全部、进行中、已完成和失败任务；
- 显示歌曲、歌手、实际音质、文件大小、时间、状态和保存路径；
- 失败任务支持重新加入队列；
- 支持删除单条记录及批量清除已结束记录，不删除已下载文件；
- 页面自动刷新进行中的任务状态。

## v0.2.1



- 下载前解析最终音频地址并探测真实文件大小；
- 确认下载时显示实际音质、文件大小和媒体类型；
- 音质自动降级时明确显示“请求音质 → 实际音质”；
- 下载队列按钮显示已探测到的总大小；
- 音频服务器不提供文件大小时显示“大小未知”，并允许用户确认后继续。

## v0.2.0

- 项目、插件界面、仓库链接和发布产物统一使用 LxBridge 名称；
- 从已启用音源的 `qualitys` 声明动态汇总可用音质；
- 支持 `128k`、`320k`、`flac`、`flac24bit`、臻品音质、臻品母带及音源自定义扩展档位；
- 音源不支持目标音质时在界面中禁用；
- 解析失败时按质量链逐级降级，并在响应和播放提示中返回实际音质；
- 保留搜索、试听、导入、下载、歌词、歌单、排行榜和外部搜索接口。

插件不附带、不托管、不推荐任何第三方音源脚本。

## 安装

### 方式一：通过插件源安装（推荐）

在 Songloft 的插件源管理页面添加以下地址：

```text
https://raw.githubusercontent.com/NeoHeee/songloft-plugin-lxbridge/main/registry.json
```

保存并刷新插件源后，选择 `Songloft LxBridge` 安装。以后发布新版本时，也可以通过该插件源检查和安装更新。

插件源必须使用能直接返回 JSON 的 Raw 地址。下面这种带有 `/blob/` 的 GitHub 文件浏览页面返回的是 HTML，**不能**作为插件源地址：

```text
https://github.com/NeoHeee/songloft-plugin-lxbridge/blob/main/registry.json
```

如果已经添加了错误的 `/blob/` 地址，请先删除，再重新添加上面的 `raw.githubusercontent.com` 地址。

### 方式二：下载 Release 安装包

从 [Releases](https://github.com/NeoHeee/songloft-plugin-lxbridge/releases/latest) 下载：

- `neo-lxbridge-v0.8.0.jsplugin.zip`：安装包
- `neo-lxbridge-v0.8.0.jsplugin.zip.sha256`：SHA-256
- `songloft-plugin-neo-lxbridge-v0.8.0-source.zip`：源码归档

在 Songloft 插件管理页面上传 `neo-lxbridge-v0.8.0.jsplugin.zip`。不要解压安装包，也不要上传源码归档。

可选：下载 `.sha256` 文件并校验安装包完整性。在 Windows PowerShell 中运行：

```powershell
Get-FileHash -Algorithm SHA256 .\neo-lxbridge-v0.8.0.jsplugin.zip
```

命令输出应与 `.sha256` 文件中的值一致。

### 方式三：从源码构建

适合需要审阅或修改代码的用户：

```bash
git clone https://github.com/NeoHeee/songloft-plugin-lxbridge.git
cd songloft-plugin-lxbridge
npm install
npm run typecheck
npm run validate
npm run build
```

构建完成后，在 Songloft 插件管理页面上传：

```text
dist/neo-lxbridge.jsplugin.zip
```

### 安装要求

插件管理页面仍位于：

```text
/api/v1/jsplugin/neo-lxbridge/static/index.html
```

最低需要 Songloft 2.9.6。

## 使用

1. 安装插件并打开管理页面。
2. 在“音源管理”导入可信的洛雪自定义音源 `.js` 或 `.zip`。
3. 等待音源初始化并启用。
4. 搜索歌曲，选择当前音源支持的目标音质。
5. 试听、导入到 Songloft 音乐库，或加入后台下载队列。

## API

主程序契约：

- `POST /api/search`
- `POST /api/music/url`

音源与直连接口：

- `GET /api/sources`
- `GET /api/sources/export?id=...`
- `GET /api/settings/download`
- `PUT /api/settings/download`
- `GET /api/songlist/list?source_id=...`
- `GET /api/songlist/detail?source_id=...&id=...`
- `GET /api/leaderboard/boards?source_id=...`
- `GET /api/leaderboard/list?source_id=...&id=...`
- `POST /api/sources/import`
- `POST /api/sources/import-url`
- `PUT /api/sources/toggle`
- `DELETE /api/sources?id=...`
- `POST /external/search`
- `POST /api/direct/music/url`
- `GET /api/direct/lyric`
- `POST /api/search/topone`

所有路径均位于前缀 `/api/v1/jsplugin/neo-lxbridge` 下。

## 构建

```bash
npm install
npm run typecheck
npm run build
npm run validate
```

构建产物：

```text
dist/neo-lxbridge.jsplugin.zip
```

构建器按入口 `neo-lxbridge` 生成内部包名；Release 会将其发布为 `neo-lxbridge-v0.8.0.jsplugin.zip`。

## 安全与免责声明

自定义音源脚本具有网络访问和计算能力，即使运行在独立 QuickJS 子 VM 中，也只应导入你信任并审阅过的脚本。本项目仅供个人学习与技术研究；歌曲、歌词、封面、音源脚本和平台数据的权利归各自权利人所有，用户须自行确保使用方式符合当地法律、平台条款和版权要求。
