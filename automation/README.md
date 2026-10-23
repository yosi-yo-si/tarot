# Tarot browser automation — Codex/Playwright test

This is an isolated proof of concept; it does not alter the production tarot page.

## Run in a Codex cloud environment with browser access

```bash
cd automation
npm install
npx playwright install chromium
cp input.example.json input.json
# edit only the question field with the fictional persona's question
npm run draw -- input.json
```

The runner opens `https://tsukiyo-arcana.pages.dev/creative`, selects 本格 / 3枚 / 逆位置あり, fills the question, and clicks the draw button **once**. It captures screenshots and writes `artifacts/result.json`. The caller must **not** treat `drawn_unverified` as a verified result or retry automatically: the draw may already have occurred. The browser's reading is captured for manual validation.

This is untested against the live `/creative` DOM: selectors and card extraction may need adjustment. A first test should run with a throwaway fictional question and human inspection of the screenshots. Do not add credentials, access codes, or real clients' personal data to repository files. Do not store the full reading or screenshots in public GitHub commits.

## Integration boundary

The scheduled task should pass a fictional `question` via an ephemeral JSON file, and consume `result.json` only when `status=verified` and all three cards/positions are non-empty. Connecting an ordinary ChatGPT scheduled task directly to Codex Cloud is **not configured** here; a separate supported runner or service is needed before claiming unattended end-to-end automation.
