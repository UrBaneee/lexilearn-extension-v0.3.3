# LexiLearn 网页生词本

[English](README.md) · [下载最新版](https://github.com/UrBaneee/lexilearn-extension-v0.3.3/releases/latest)

LexiLearn 是一个 Chrome 扩展。读英文网页时，可以在原地查词，把释义、原句和来源一起保存到生词本。

## 安装

1. 从 GitHub Releases 下载 ZIP 并解压。
2. 在 Chrome 138 或更高版本打开 `chrome://extensions`，开启「开发者模式」。
3. 选择「加载已解压的扩展程序」，选中包含 `manifest.json` 的文件夹。
4. 固定扩展图标，方便打开设置和生词本。

## 使用

- 在网页选中单词或短语，右键选择 **Look up in LexiLearn**。
- 点 **Explain in context** 查看词在当前句子里的含义，或点 **Translate** 查单词翻译。保存前可以修改释义。
- 从扩展图标为当前页面开启 GRE 高亮。点击高亮词可查词，点 **I know this** 可在以后的 GRE 高亮中隐藏这个词。
- 打开 **Vocabulary** 搜索词本、隐藏答案复习、使用本地语音朗读，或导出 Excel。

Chrome 内置 AI 的可用性取决于浏览器、设备和目标语言，首次使用可能需要下载模型或语言包。如果目标语言暂时不可用，可以保留英文的上下文释义。端侧查词不可用时，也可以手动填写释义，或主动打开 Google Translate。

## 数据处理

生词、例句、来源网址、设置和已认识的词保存在 Chrome 扩展的本地存储中。内置 AI 在设备上处理查词文本。LexiLearn 没有服务端、账号或分析追踪。主动点击 **Open Google Translate** 时，选中的单词或短语会发送给 Google Translate。Excel 导出生成本地文件。
