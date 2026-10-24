<div align="center">

<img src="assets/logo.svg" alt="" width="72">

# Elffuss Copilot

**Skills for your meetings.**

Copilot listens to a call in your browser, tells the voices apart and, as you talk, fills in the client record and tells you what is
still missing before you close. With the optional advanced AI it also proposes the next move. Free, no account.

[![License](https://img.shields.io/badge/license-Apache--2.0-8a5a00?style=flat-square)](LICENSE)
[![Runs in](https://img.shields.io/badge/runs%20in-your%20browser-8a5a00?style=flat-square)](https://copilot.elffuss.com)
[![No build](https://img.shields.io/badge/build-none-5b6169?style=flat-square)](#files)

[Open Copilot](https://copilot.elffuss.com) · [Elffuss](https://elffuss.com) · [Translator](https://github.com/utopia-ia/elffuss-translator) · [Claw](https://github.com/utopia-ia/elffuss-claw) · [Shared core](https://github.com/utopia-ia/elffuss)

</div>

> Elffuss Copilot now lives in the UtopiaIA organization on GitHub, at github.com/utopia-ia/elffuss-copilot. It moved from github.com/KikoCis/elffuss-copilot on 23 October 2026; the old address redirects.

---

**In this repository:** [what it does](#what-it-does) · [skills](#skills) · [files](#files) · [run it](#run-it) · [limits](#limits) · [licence](#licence)

---

## What it does

- **It listens and fills in the record as you talk:** name, company, role, phone, email, budget and timeline, also when the number is
  spoken ("six one one…"). The rules that read them do not depend on a language model, so they work on any computer.
- **It tells you what is missing:** "still to capture: email, need, next step. Ask before you close."
- **With the optional advanced AI, it proposes the next move** and an advice line, within a closed space of actions checked against the
  transcript, so it cannot invent a phone number.
- **The record goes where you point it:** download it as a CSV, or send it with one click to your own webhook or a Google Form.
- **Your audio stays in your browser.** The transcription happens there. Only the record leaves, to the destination you set, when you
  press Send.
- **A link for the whole team:** `?webhook=…&form=…&skill=…` opens Copilot already configured. Spanish and English (`?ui=es`, `?ui=en`).

## Skills

You pick one before you start: a customer record, sales objectives and a meeting skill. Each paints its own live view next to the
transcript.

## Files

- `index.html`: the whole app, with its styles and logic inline.
- `copilot-grammar.mjs`: the closed space that the AI's answer has to fit.
- `copilot-llm.mjs`: the optional advanced AI (Gemma through LiteRT-LM, in the browser).
- `diarize.mjs`: who is speaking.
- `model-broker.js`, `model-cache.mjs`, `sw.js`: the shared model store, so the models are downloaded once and kept for the next visit.
- `tests/`: `node tests/grammar.test.mjs`, `node tests/i18n-extraccion.test.mjs` and `node tests/capability.test.mjs` need no browser;
  `ux.mjs`, `a11y.mjs` and `stop.mjs` drive a real browser with Playwright.

## Run it

It is static: serve this folder over HTTP (`python3 -m http.server`) and open it in a recent Chrome or Edge on a desktop.

## Limits

- Capturing the audio of a call needs a desktop Chromium. Firefox and Safari cannot share the audio of a tab, so there Copilot offers
  microphone-only mode, and it says so before you start.
- It handles two voices: you and the client. It is not a tool for group meetings.
- The advanced AI is optional, and needs a computer that can run it; without it the record still fills in by rules.

## Licence

[Apache-2.0](LICENSE). The third-party models it downloads, and their licences, are listed in `NOTICE`.
