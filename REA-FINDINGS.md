# REA Findings — Raycast (shipped artifact analysis)

Target: `Raycast.dmg` — Raycast v1.104.32 (universal), downloaded from Raycast's own release server.
Analysis: REA CLI 6.7.0 (`rea-agents`), artifact-level tools + sealed JavaScript application graph.
Evidence: `ev_bbdbd979f2ecfef07e977662496d3b450d1ec931797864dfe188fa3888860c29` (RaycastWeb bundle graph, sha256 `670532185bcb5b…`).
DMG sha256 prefix: `76cc6b631f5d257e`.
Native decompilers (Hopper/Ghidra/IDA) were unavailable on this Linux host; macOS-native REA providers were out of scope. Findings below come from format-aware parsing (plist, asset catalogs, bundle inventory), REA's JavaScript application analyzer, and binary string tables — each labeled.

## Observations (directly evidenced)

### Identity & lifecycle (`Contents/Info.plist`, parsed)
- Bundle id `com.raycast.macos`, version 1.104.32, macOS ≥ 13.0, `LSUIElement = true` (menu-bar agent; no Dock icon).
- URL schemes: `raycast://`, `com.raycast://` — deep-link entry point for commands.
- Permission strings: Microphone + SpeechRecognition (dictation/translation), AppleEvents ("control your Mac and run Shortcuts").
- Main executable: `Contents/MacOS/Raycast` (Swift, ~large native binary) + Helpers (`Restart Helper`, `App Uninstall Helper`).
- Frameworks shipped: `SoulverCore.framework` (natural-language math), `SplineRuntime.framework`.

### Root command taxonomy (binary symbol/string tables)
Calculator (+ **Calculator History**, `CalculatorService`), Clipboard History (with per-app disable + content-length limits), Snippets (`Clipboard Snippet`, signature insertion), **AI Chat** (presets, chat history, models, credits indicator, `ChatCompletion`/`ChatCompletionResponse`), Ask AI, Applications, Search Files, Store, Extensions, Quicklinks, Notes, Color Picker, Emoji, Kill Process, Port Allocator, Window Management, Run Script Commands, System Settings, Sleep, Lock Screen, Quit/Force Quit Applications, Translate, Define, Convert, Timer, Stopwatch, Scheduled.

### Window Management command set (string table — exact names)
Left/Right/Top/Bottom **Half**; **Center**; **Maximize**; **Almost** Maximize; quarters (Bottom Left/Right Quarter…); sixths (Bottom Left Sixth, Center Sixth…); thirds (Bottom/Center Two Thirds); Three Fourths; behavior string: "Center focused window horizontally or vertically when moving it up, down, left, or right".

### AI BYO providers (`Resources/ai-providers.template.yaml`, file content)
Users may add any **OpenAI-API-compatible** provider: `id`, `name`, `base_url`, `api_keys`, `additional_parameters`, `models[]` with `id`, `name`, `context`, and an **abilities matrix** (`temperature`, `vision`, `system_message`, `tools`, `reasoning_effort` — each `supported: bool`). Template ships a Perplexity `sonar` example.

### Extension runtime (`RaycastNodeExtensions…bundle/template/src/*.ts[x]`)
Command kinds shipped to extension authors: `blank`, `script`, `static-list`, `list-and-detail`, `typeahead-search`, `grid`, `form`, `detail`, `ai`, `menu-bar-extra`, plus `tools/confirmation`.

### Voice (`RaycastDictation…bundle`, permission strings)
In-app dictation subsystem with its own asset catalog; mic + speech-recognition permissions are declared for "transcribe audio for translation".

### Theme (web bundle + string table)
Backgrounds: dark `#1E1E1E`, light `#EEF0F2` (top-frequency colors in the shipped web bundle). Accent names: Red, Orange, Yellow, Green, Blue, Purple, Pink, Magenta.

### Telemetry & realtime (bundle inventory)
`PostHog_PostHog.bundle` (analytics), `Starscream_Starscream.bundle` (WebSockets), `MathJaxSwift…bundle` (formula rendering in calculator), `emoji.json`.

## Inferences (reasonable, not directly observed)
- Raycast is a menu-bar-resident agent app whose launcher window is summoned by a monitored **global hotkey** (string evidence: global hotkey monitoring + "Raycast Hotkey Changed"); Windows port defaults to Alt+Space per public docs.
- The `raycast://` scheme maps root commands to deep links (e.g. `raycast://clipboard`), analogous to our `rayvox://`.
- SoulverCore powers natural-language calculation ("convert 10 USD to EUR", time differences) seen in marketing strings.

## Unknowns / limits of this pass
- Exact hotkey default values, private command id strings, and full WM layout math were not recoverable without native decompilation (engines unavailable on this host).
- The Windows MSIX could not be downloaded (Store delivery is Cloudflare-gated; no Windows Store session here). The macOS DMG is the same product and the richer artifact; Windows parity commands were confirmed via public docs cross-check.
- No runtime observation was performed (static analysis only — REA never executed the target).

## Reconstruction obligations this imposes on the rebuild
1. Root-command taxonomy mirrors Raycast's (names above in ⌐ comments).
2. Window Management uses the exact observed command names + layout families (halves/quarters/sixths/thirds/center/maximize/almost-maximize).
3. AI Chat supports BYO OpenAI-compatible providers with the observed fields (base_url, api key, model, abilities hints) + presets.
4. Calculator keeps history and handles natural-language conversions (time/units; currency routes to web search — we have no offline rates).
5. Theme: dark/light using observed background colors; 8 accent colors matching observed names.
6. Dictation via local Whisper (mic + speech permission analog).
7. Deep-link scheme `rayvox://` + global hotkey in the desktop build.
