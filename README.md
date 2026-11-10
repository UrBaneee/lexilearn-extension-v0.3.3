# LexiLearn

[中文说明](README%20-%20CN.md) · [Download the latest release](https://github.com/UrBaneee/lexilearn-extension-v0.3.3/releases/latest)

LexiLearn is a Chrome extension for reading in English. Look up a word on the page and save its meaning, original sentence, and source in a vocabulary deck.

## Install

1. Download the extension ZIP from Releases and unzip it.
2. In Chrome 138 or later, open `chrome://extensions` and turn on Developer mode.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Pin LexiLearn to make its settings and vocabulary panel easy to reach.

## Read and review

- Select a word or short phrase on a webpage, right-click, and choose **Look up in LexiLearn**.
- Choose **Explain in context** to look up the sense used in the sentence, or **Translate** for a word translation. Edit the result before saving if needed.
- From the toolbar popup, enable **GRE highlights** for the current page. Click a highlighted word to look it up. **I know this** hides that word from future GRE highlights.
- Open **Vocabulary** from the toolbar popup to search your decks, review with answers hidden, listen using a local voice, or export an Excel workbook.

Chrome's on-device AI depends on the browser, device, and language. Chrome may download a model or language pack on first use. If the requested explanation language is unavailable, LexiLearn can keep the English contextual definition. If on-device lookup is unavailable, save a note manually or explicitly open Google Translate.

## Data

LexiLearn stores vocabulary, example sentences, source URLs, settings, and known words in Chrome's local extension storage. Built-in AI processes lookup text on the device. LexiLearn has no server, account, or analytics. If you choose **Open Google Translate**, the selected word or phrase is sent to Google Translate. Excel export creates a local file.

## Development

Run `npm test` for lookup and storage tests. GitHub Actions also runs an isolated Chromium test with deterministic model responses, covering contextual lookup, GRE highlights, saved vocabulary, review, and Excel export.
