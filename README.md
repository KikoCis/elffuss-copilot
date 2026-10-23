# Elffuss Copilot

Skills for your meetings. Copilot listens to a call in your browser, tells the voices apart, fills in a client record as you talk
(name, company, role, phone, email, budget, timeline) and tells you what is still missing before you close. With the optional
advanced AI it also proposes the next move. The record goes where you point it: a CSV, your own webhook or a Google Form.

Elffuss Copilot now lives in the UtopiaIA organization on GitHub, at github.com/utopia-ia/elffuss-copilot. It moved from github.com/KikoCis/elffuss-copilot on 23 October 2026; the old address redirects.

Live: https://copilot.elffuss.com. Free, no account. The audio is transcribed in your browser and does not leave it; only the
record leaves, to the destination you set, when you press Send.

Spanish and English interface (`?ui=es` / `?ui=en`). Team link: `?webhook=…&form=…&skill=…` opens the page already configured.

## Files

- `index.html`: the whole app (styles and logic inline).
- `copilot-grammar.mjs`: the closed space the AI's answer must fit (actions, fields checked against the transcript).
- `copilot-llm.mjs`: the optional advanced AI (Gemma through LiteRT-LM, in the browser).
- `diarize.mjs`: who is speaking.
- `model-broker.js`, `model-cache.mjs`, `sw.js`: shared model store, so the models are downloaded once and kept for the next visit.
- `tests/`: `node tests/grammar.test.mjs`, `node tests/i18n-extraccion.test.mjs` and `node tests/capability.test.mjs` need no browser;
  `ux.mjs`, `a11y.mjs` and `stop.mjs` drive a real browser with Playwright.

## Run it

It is static: serve this folder over HTTP (`python3 -m http.server`) and open it in a recent Chrome or Edge on a desktop.
Capturing the audio of a call needs a Chromium on desktop; Firefox and Safari cannot share the audio of a tab, so Copilot
offers microphone-only mode there.

Third-party models and their licences: see `NOTICE`. Licence: Apache-2.0.
