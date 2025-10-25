# LexiLearn – On-page Vocabulary Coach (Chrome 扩展)

高亮网页上的英文单词，查看释义与例句，并一键加入生词本。右侧 Side Panel 可分组管理与 **导出 XLSX（每个 deck 一个 sheet）**。

<img width="1371" height="811" alt="image" src="https://github.com/user-attachments/assets/aac5bb04-f42d-42a7-b86c-00c3e22548d4" />


---

## ✨ 功能亮点

- 悬停/点击显示词义、例句与操作按钮
- **+ Add** 下拉选择目标 deck（支持新建）
- **Side Panel** 中按 deck 分组显示，支持朗读、复制、打开来源、删除
- **Export** 导出为 `My_Vocabulary.xlsx`（每个 deck -> 一个 sheet）
- 支持**高亮模式**：`basic`（默认）/ `gre`
- 可自带词表：`assets/lists/*.txt`（如 `gre.txt`）

---

## 📦 安装（开发模式 / 直接可用）

1. 点击 **Code → Download ZIP** 下载并解压本仓库。
2. 打开 `chrome://extensions/`，右上角打开 **Developer mode**。
3. 点击 **Load unpacked**，选择解压后的文件夹。
4. 把扩展 **Pin** 到工具栏（方便使用）。

> 如果 Side Panel 没自动打开，手动点击右上角侧边栏图标或扩展图标即可。

---

## 🧪 使用方法

- 在网页上**选择**或**点击**英文单词，浮层会出现词义与操作按钮。
- 点击 **+ Add** 选择目标 deck（或 `+ New deck...`）。
- 打开右侧 **Side Panel**（第一次可能需要手动开启）：
  - 顶部 **Export** 导出为 `My_Vocabulary.xlsx`；
  - **Clear All** 清空所有生词（谨慎操作）。
- **切换高亮模式**：
  - 默认 `basic` 模式；
  - 需要 GRE 词表高亮：将 `assets/lists/gre.txt` 替换成你的 GRE 词表（UTF-8，每行一个词）并**重新加载扩展**；
  - 运行时可用 DevTools 临时切换：
    ```js
    chrome.storage.local.set({ mode: 'gre' })     // 切 GRE
    // chrome.storage.local.set({ mode: 'basic' }) // 切回 basic
    ```

---

## 🗂 目录结构

```text
lexilearn-extension/
├─ assets/
│  ├─ icons/               # 16/48/128 图标
│  └─ lists/               # 可选词表（gre.txt）
├─ vendor/
│  └─ xlsx/
│     └─ xlsx.full.min.js  # 本地打包的 XLSX 库（sidepanel.html 里已引入）
├─ background.js
├─ content.js
├─ sidepanel.html
├─ sidepanel.js
├─ popup.html              # 如使用
├─ popup.js                # 如使用
├─ styles.css              # 如使用
├─ manifest.json
├─ README.md
├─ LICENSE
└─ .gitignore
