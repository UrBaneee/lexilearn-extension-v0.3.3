# LexiLearn – On-page Vocabulary Coach (Chrome Extension)

LexiLearn helps you highlight English words directly on any webpage, view definitions and examples, and save them into your personal vocabulary list.  
The saved words are organized by decks and can be exported to **Excel (.xlsx)** in one click.
<img width="2742" height="1622" alt="image" src="https://github.com/user-attachments/assets/91b65b1e-b8c9-4d0a-8aeb-0bba0f0236d4" />

---

## ✨ Features

- Instantly highlight and translate English words on any webpage  
- Click **+ Add** to save words into decks (supports multiple decks)  
- Built-in **Side Panel** to view, edit, and export your vocabulary  
- Export to `My_Vocabulary.xlsx` – one deck per sheet  
- Supports two highlight modes: `basic` and `gre`  
- Fully offline after installation (no external API calls)

---

## 🧭 Quick Start

1. **Download & Install**
   - Click **Code → Download ZIP** to download this repository.
   - Unzip the folder.
   - Open Chrome and navigate to `chrome://extensions/`.
   - Enable **Developer mode** (top right).
   - Click **Load unpacked** and select the unzipped folder.

2. **Pin the Extension**
   - Click the puzzle icon in Chrome’s toolbar.
   - Pin **LexiLearn – On-page Vocabulary Coach** for quick access.

3. **Try it Out**
   - Open any English webpage.
   - Select a word → click the floating **+ Add** button.
   - Open the **Side Panel** to view your saved vocabulary.

---

## 📚 Vocabulary Management

- **Add words**: Highlight or click a word → “+ Add”
- **Decks**: Group words (e.g., “default”, “GRE”, “listening”)
- **Export**: Click **Export** to download an Excel file
  - Each deck appears as a separate sheet in `My_Vocabulary.xlsx`
- **Clear**: Click **Clear All** to reset (deletes all saved words)

---

## 🎛 Highlight Modes: Basic vs GRE

LexiLearn supports two modes of word highlighting:

| Mode  | Description |
|-------|--------------|
| `basic` | Default mode – highlights all common words |
| `gre`   | Highlights only words found in your `assets/lists/gre.txt` file |

### Switch mode manually
You can switch between modes in the Chrome DevTools Console:

```js
// Switch to GRE mode
chrome.storage.local.set({ mode: 'gre' });

// Switch back to Basic mode
chrome.storage.local.set({ mode: 'basic' });
