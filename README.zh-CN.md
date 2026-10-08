# Keysong

[English](README.md) | 简体中文

*让你的按键唱出歌曲。* Keysong 让任何人都能跟着喜爱的音乐一起演奏，无需乐器基础。将歌曲分离成不同音轨后，你选择的声部（通常是人声）只会在打字时发声。持续打字，歌曲就会继续唱；停下输入，它便等待你的下一次敲击。

这是一款在本地运行的 Windows 11 桌面应用，可以响应任意应用中的键盘输入。因此，写邮件或编写代码时，你也能在后台演奏歌曲。你也可以专注于演奏，跟着节拍敲击键盘。

Keysong 在 v0.1.0 及之前的版本中名为 Cadence。

[用户指南（英文）](docs/user-guide.en.md) | [开发指南（英文）](docs/development.en.md) | [版本说明（英文）](docs/release-notes-v0.2.0.md)

## 主要功能

- **打开即可演奏：** 内置演示曲目《欢乐颂》，由 Keysong 自行合成的四音轨编曲，无需先准备自己的音乐就能体验。
- 通过打字让选定的声部发声，包括人声、鼓、贝斯或其他乐器，其余伴奏保持同步播放。按键落下时，选定声部立即响起。
- **演奏反馈：**
  - 歌曲时间图展示所选声部有内容的片段，并将你成功奏响的部分标为金色。
  - 状态标签提示何时轮到你演奏，以及何时处于间奏或所选声部的空白段。
  - 实时评分衡量你奏响了该声部的多少内容。
  - 每首曲目都会保存你的最佳成绩。
- **节拍感知：** Keysong 会检测歌曲的节拍。键盘光球随节拍跳动；当你踩准节拍时，它会闪现金光。跟着节奏敲击，即使每拍只按一次键，也能让所选声部持续发声。
- 支持 Windows 11 全局键盘响应。只有点击 **Enable（启用）** 后才会开始监听，点击 **Disable（停用）** 或退出应用即可停止。
- 原始按键代码在 Electron 主进程中分类；渲染进程只接收 `char`、`back`、`enter` 或 `space`。
- 自动扫描并监听固定的 `Music Resources/歌曲文件夹/音频文件` 目录结构。
- 支持播放、暂停、下一首、顺序播放、随机播放、直接从播放列表选曲，以及点击歌曲时间图或进度条跳转。
- 声音面板可调节音乐音量，并开关按键提示音。
- 提供 Windows 便携版，无需安装。

## 快速开始

将可执行文件与资源文件夹放在同一目录下：

```text
Keysong-0.2.0-Windows.exe
Music Resources/
└─ Sample Song/
   ├─ Sample Song_(Vocals).wav
   └─ Sample Song_(Instrumental).wav
```

运行 Keysong，选择曲目，点击 **Enable（启用）**，然后在任意应用中开始打字。完整的 UVR 音轨分离和导入步骤请参阅[用户指南（英文）](docs/user-guide.en.md)。

> 应用界面使用英文。本文中的中文按钮名称仅用于说明；操作时请以界面上的英文名称为准。

## 隐私说明

全局键盘钩子需要接收操作系统的键盘事件，才能检测输入活动。但 Keysong 不会持久化保存输入的字符、还原后的文本、剪贴板内容或按键历史。演奏反馈仅使用按键时间信息；保存的演奏数据只有每首曲目的最佳成绩。暂停播放**不会**停止键盘监听。如果希望停止监听，请点击 **Disable（停用）** 或退出 Keysong。

导入的音乐仅在本地读取，不会上传。采样钢琴可能会通过 `smplr` 发起一次 CDN 请求；离线时，Keysong 会回退到本地合成器。

## 音乐资源

桌面版只扫描 `Music Resources` 下的直接子文件夹，每个子文件夹对应一首歌曲。直接放在资源根目录中的音频文件会被忽略。

推荐使用 UVR 分离得到的以下配对文件：

```text
Music Resources/Sample Song/Sample Song_(Vocals).wav
Music Resources/Sample Song/Sample Song_(Instrumental).wav
```

支持识别的格式：

```text
.mp3 .wav .m4a .aac .ogg .opus .flac .webm .mid .midi
```

Keysong 能识别常见的英文声部标签，例如 `Vocals`（人声）、`Instrumental`（伴奏）、`No Vocals`（无人声）、`Drums`（鼓）、`Bass`（贝斯）和 `Other`（其他乐器）。旧版的非英文标签仍通过内部转义匹配规则保持兼容，但应用界面不会因此显示非英文文本。

## 开发

需要 Node.js 22.12 或更高版本。

```powershell
npm install
npm test             # 使用 Node 测试运行器执行单元测试
npm run dev          # 浏览器预览，仅响应页面内的键盘输入
npm run desktop      # 构建并启动桌面应用
npm run package:win  # 创建排除开发者本地歌曲的 Windows 便携包
```

`npm run package:win` 会从公开发布的安装包中排除开发者本地的歌曲。架构、测试和发布流程请参阅[开发指南（英文）](docs/development.en.md)。

## 版权与许可

请仅处理、播放或分发你拥有或已获授权使用的音乐。音轨分离不会改变录音作品的版权状态。

Keysong 的源代码以 [MIT 许可证](LICENSE) 发布。该许可证只涵盖代码，不涵盖你用它播放的任何音乐。发布版本附带 `THIRD-PARTY-NOTICES.txt`，其中列出了打包进应用的开源软件包的许可证。
