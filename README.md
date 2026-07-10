# Songloft 洛雪音源插件（lxmusic）

把洛雪音乐生态的第三方音源脚本接入 Songloft。插件分成两条彼此独立的能力线：

1. **内置 metadata SDK**：酷我、酷狗、QQ 音乐、网易云、咪咕的搜索、歌词、歌单和排行榜。
2. **`songloft.jsenv` 音源引擎**：每个用户导入的洛雪音源脚本运行在独立 QuickJS 子 VM 中，只负责把歌曲元数据解析成真实 CDN URL。

插件**不附带任何第三方音源脚本**。未导入音源时，元数据功能仍可使用，但导入到库中的远程歌曲无法播放。

## 当前状态

这是可构建的 `0.1.14` 实现，最低需要 **Songloft 2.9.6**，已经包含：

- `/api/search` 与 `/api/music/url` 主程序集成契约；
- 五平台搜索、歌词、歌单、排行榜 façade；
- 洛雪 `lx.request / lx.send / lx.on / lx._dispatch` prelude，并对齐桌面端 2.x Promise 与取消请求行为；
- 音源源码与 `currentScriptInfo` 通过 Base64 安全传入子 VM，兼容特殊换行符和长混淆字符串；
- `rawScript` 完整注入、初始化超时和 dispatch 看门狗；
- 多音源按平台反向索引和 `executeParallel(..., 3)` 并行竞速；
- 音源 JS/ZIP/URL 导入、启用、禁用、删除和 KV 持久化；
- ZIP Central Directory + STORE/DEFLATE 解析与 local-header fallback；
- 批量音源后台逐个初始化；
- 搜索、待导入、音源管理三页静态前端；
- 批量导入远程歌曲、歌词抓取、去重 key 和可选新建歌单。

各音乐平台的公开 Web 接口可能随时调整。正式发布前应在目标 Songloft 版本与真实网络环境中逐平台验证搜索、歌词、歌单和榜单。

## 直接安装

可在仓库中下载以下文件并通过 Songloft 插件管理页面安装：

- `releases/v0.1.14/lxmusic-v0.1.14.jsplugin.zip`：直接安装包
- `releases/v0.1.14/lxmusic-v0.1.14.jsplugin.zip.sha256`：SHA-256 校验值
- `releases/v0.1.14/songloft-plugin-lxmusic-v0.1.14-source.zip`：源码归档

当前版本：**v0.1.14**。

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

开发热更新：

```bash
npm run dev
```

## 使用

1. 在 Songloft 插件管理中安装 `lxmusic.jsplugin.zip`。
2. 打开：`/api/v1/jsplugin/lxmusic/static/index.html`。
3. 在“音源管理”中导入你自行取得的洛雪自定义源 `.js` 或 `.zip`。
4. 等待音源状态变为启用。
5. 搜索歌曲，勾选后进入“导入”页添加到 Songloft 音乐库。

## API

### 主程序契约

- `POST /api/search`
- `POST /api/music/url`

### 音源管理

- `GET /api/sources`
- `POST /api/sources/import`
- `POST /api/sources/import-url`
- `PUT /api/sources/toggle`
- `DELETE /api/sources?id=...`

### 元数据和直连

- `GET /api/songlist/{tags|list|detail|search|sorts}?source_id=wy`
- `GET /api/leaderboard/{boards|list}?source_id=wy`
- `POST /api/direct/music/url`
- `GET /api/direct/lyric`
- `POST /api/search/topone`
- `POST /api/songs/import`

所有路径均位于 `/api/v1/jsplugin/lxmusic` 前缀下。

## 安全说明

自定义音源脚本具有网络访问和计算能力，虽然运行在独立子 VM 中，仍应只导入你信任且审阅过的脚本。不要导入来源不明的混淆脚本；不要把个人 Token、Cookie 或密钥写入公开仓库。

## 免责声明

本项目仅供个人学习与技术研究，禁止商用。音源脚本、歌曲、歌词、封面和平台数据的版权归其各自权利人所有。用户须自行确认使用行为符合当地法律、平台条款和版权要求，并自行清除使用过程中产生的版权数据。项目维护者不提供、不托管、不推荐任何第三方音源脚本，也不对第三方脚本或数据的可用性、安全性、合法性负责。

## 搜索结果下载

搜索结果提供“下载”按钮。插件会先将歌曲写入 Songloft 歌曲库，再通过 Songloft 下载服务保存到已配置的 `music_path`。下载采用后台队列，页面会显示“排队中 / 下载中 / 已下载 / 重试”。已下载歌曲会被识别并避免重复下载。
