# Songloft LxBridge

Songloft LxBridge（中文名：Songloft 洛雪音源桥）把洛雪自定义音源脚本的解析能力接入 Songloft。

> 为兼容从 v0.1.x 原位升级，插件内部入口路径继续使用 `lxmusic`。这是兼容标识，不是未完成的项目更名。

## v0.3.1

- 保留 `hires` 原始请求参数，不再转换成 `flac24bit`；
- 新增并区分 `hires`、`flac24bit`、`atmos`、`atmos_plus`、`master`；
- 用户选择的音质始终优先原样请求，音源能力声明只影响尝试顺序；
- 仅在目标音质解析明确失败后逐级降级；
- 增加“允许自动降级”开关，关闭后高音质失败会直接报错；
- 下载确认框分别显示“请求音质”和“实际音质”；
- 网易云搜索额外读取歌曲详情中的 `hr`、`db`、`jm` 音质信息。

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

从 [Releases](https://github.com/NeoHeee/songloft-plugin-lxbridge/releases) 下载：

- `lxbridge-v0.3.1.jsplugin.zip`：安装包
- `lxbridge-v0.3.1.jsplugin.zip.sha256`：SHA-256
- `songloft-plugin-lxbridge-v0.3.1-source.zip`：源码归档

在 Songloft 插件管理页面上传安装包。管理页面仍位于：

```text
/api/v1/jsplugin/lxmusic/static/index.html
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
- `POST /api/sources/import`
- `POST /api/sources/import-url`
- `PUT /api/sources/toggle`
- `DELETE /api/sources?id=...`
- `POST /external/search`
- `POST /api/direct/music/url`
- `GET /api/direct/lyric`
- `POST /api/search/topone`

所有路径均位于兼容前缀 `/api/v1/jsplugin/lxmusic` 下。

## 构建

```bash
npm install
npm run typecheck
npm run build
npm run validate
```

构建产物：

```text
dist/lxmusic.jsplugin.zip
```

构建器仍按稳定入口 `lxmusic` 生成内部包名；Release 会将其发布为 `lxbridge-v0.3.1.jsplugin.zip`。

## 安全与免责声明

自定义音源脚本具有网络访问和计算能力，即使运行在独立 QuickJS 子 VM 中，也只应导入你信任并审阅过的脚本。本项目仅供个人学习与技术研究；歌曲、歌词、封面、音源脚本和平台数据的权利归各自权利人所有，用户须自行确保使用方式符合当地法律、平台条款和版权要求。
