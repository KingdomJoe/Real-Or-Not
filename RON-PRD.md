# Product Requirements Document (PRD): RON (Real or Not)

**Document Path:** `docs/superpowers/specs/2026-11-03-ron-design.md`

**Target Event:** Meta Global AI Developer Hackathon ($1,000,000 Prize Pool)

**Submission Cutoff:** Wednesday, November 4, 2026 at 9:00 PM EST (Thursday, November 5 at 2:00 AM GMT)

**Target Tracks & Bonus Prizes:**

* Primary Track: **Build for Your World** / **Push the Frontier** ($150K Indie / $250K Startup Grand Prize)
* Bonus 1: **Best Build on Meta Open Weight Models** ($10,000 — `Muse Spark Open` & `Muse Glimmer` on Modal)
* Bonus 2: **Best Agentic Use-Case** ($5,000 — Multi-step hypothesis-testing pipeline)
* Bonus 3: **Best Creative Build** ($5,000 — `Muse Image` forensic X-ray plates & `Dithercn` shaders)
* Bonus 4: **Most Viral Project on X** ($20,000 — Floating `RON` companion catching fake clips live on X/TikTok)

---

# RON (Real or Not) — Honest Production Architecture (v2.1 Reality-Checked)
## 1. Core Honesty & Trust Principles
1. **Never Fake a Result:** Every metric in `[ Show Proof ]` is computed live from the uploaded media buffer, C2PA manifest, `SAM 3.1` masks, `AudioSeal` waveform detector, and `SigLIP-2` regional crops.
2. **Never Silently Swap Failed Links:** If a pasted URL cannot be unpacked directly, RON tells the user plainly and prompts them to drop the file or use Tab Share. Instagram/Facebook scraping is excluded to respect Meta TOS.
3. **Celebrate Epistemic Humility (`⚪ Not Sure`):** When heavy compression (`QF < 40` or `<360p`) destroys forensic signal and no C2PA or `AudioSeal` watermark is present, RON outputs `⚪ Not Sure (Too Compressed)` rather than guessing.
4. **Two Distinct Checks:**
   - **Check A — Media Integrity:** C2PA/IPTC cryptographic check + `AudioSeal` localized audio watermark/clone detection + `SAM 3.1` per-object `SigLIP-2` & Boundary ELA comparison.
   - **Check B — Story & Web Context:** `Muse Spark 1.3` (`web_search`) reverse-context lookup with verifiable clickable URLs (or *"No prior web copies found"*).
5. **Mandatory Open-Weight Attribution:** Displays `"Built with Muse Spark Open"` prominently in the top navbar and footer per the Muse Model License.

---

## 1. Intent, Vision & The "Why"



### 1.1 The Problem

The internet is flooded with AI-generated videos, cloned voices, and subtly edited photos. Worse, the most dangerous deception today is no longer "100% fake AI slop"—it is **90% real media with a 10% surgical edit** (a real street video where one protest sign was altered by AI, a real executive video where 3 seconds of audio were voice-cloned, or a real 2022 video reposted with a fake 2026 breaking-news audio track).

Existing AI detectors fail everyday people in two ways:

1. **They overwhelm regular users with scary lab jargon** ("spectral kurtosis," "perplexity," "ELA residuals") or give an uncalibrated *"82% Fake"* guess without proving *which part* was changed.


2. **They live in isolated web tabs** requiring users to download heavy video files first, instead of living right on the screen where people scroll TikTok, X, Instagram, and YouTube.

### 1.2 The Solution: What RON Is

**RON (Real or Not)** is an everyday media trust platform and floating screen companion that tells anyone—in plain, friendly English—whether a video, photo, audio clip, or social media link is **Real** or **Not**, pinpoints the exact spot or second that was changed, and proves it in one click.

---

## 2. Goals, Non-Goals & Anti-Goals



* Goals:


1. **Zero-Jargon Consumer Clarity:** Any everyday user must understand RON's verdict in under 3 seconds using plain English and color-coded visual highlights—with all deep scientific math tucked neatly inside the **`[ Show Proof ▾ ]`** toggle.
2. **Universal Social Link + File Input:** Accept pasted URLs from X/Twitter, TikTok, Instagram Reels, YouTube Shorts, and Reddit alongside drag-and-drop video, image, and audio files.
3. **60 FPS Snappiness:** Achieve `<16ms` UI frame times using **Svelte 5 Runes** and an off-main-thread **Rust WebAssembly (`wasm-bindgen`)** signal worker.
4. **Zero-Install Floating Screen Companion:** Let users float **RON** on top of any browser tab or app via the native browser **Document Picture-in-Picture API** + a lightweight **Manifest V3 Chrome Extension**.
5. **Full-Spectrum Meta AI + Research Depth:** Under the **`[ Show Proof ▾ ]`** hood, execute pixel-level segmentation via **`SAM 3.1`**, audio turn-slicing via **`Muse Voice Transcribe`**, open-weight reasoning via **`Muse Spark Open` & `Muse Glimmer` on Modal**, multimodal orchestration via **`Muse Wonder` & `Muse Spark**`, visual autopsy plates via **`Muse Image`**, calibrated probabilities via **TypeSafe `Jev**`, and blind-spot discovery via the **Alien Space Sampler ($F_{\beta=0.7}$)** (`arXiv:2603.01092v3`).




* Non-Goals:


* Requiring users or judges to install heavy macOS `.dmg` or Windows `.exe` binaries that trigger OS security blocks.
* Forcing users to create an account or enter API keys before testing a link or file.


* Anti-Goals (What Would Make This a Failure Even If It Works Technically):


* **Looking like a "Simple Image Analyzer" (Banned by Meta's Sample Anti-Projects list):** RON must never just output a generic LLM caption and a single fake percentage. Even in Simple Mode, RON visually isolates *which exact object or audio second* was changed and lets the user test it interactively.
* **Leaking academic jargon into the default view:** Terms like `SAM 3.1 Mask`, `RLCD`, `FFT`, `ELA`, or `F_beta` must **never** appear until the user clicks **`[ Show Proof ▾ ]`**.



---

## 3. Brand Identity, Messaging & Plain-English Lexicon

### 3.1 Brand Personality

Think **Shazam’s effortless one-tap magic** + **Truecaller’s protective caller-ID shield** + **Pangram’s clean editorial trust** + **HeyClicky’s friendly, expressive screen buddy**.

* **Hero Headline:** `Real or Not? Know in seconds.`
* **Hero Sub-headline:** `Paste any link from TikTok, X, Instagram, or YouTube—or drop a photo, video, or voice clip—to see what’s real and what was changed by AI.`
* **Floating Companion Tagline:** `Float RON on your screen while you scroll. One tap tells you what’s real.`

### 3.2 The Strict Translation Lexicon (Default Simple View vs. `Show Proof` View)

| Internal / Scientific Mechanism | What the User Sees by Default (Plain English) | What Unlocks Inside `[ Show Proof ▾ ]` (For Judges & Power Users) |
| --- | --- | --- |
| **`SAM 3.1` Semantic Segmentation Masks** | **"Highlighted Spot"** (e.g., *"This sign was edited in by AI"*) | `SAM 3.1 Pixel Mask M2 (IoU: 0.96, Temporal Track Locked)` |
| **`Muse Voice Transcribe` Diarization** | **"Voice Check"** (e.g., *"Voice from 0:04 to 0:07 is an AI clone"*) | `Muse Voice Transcribe Turn-Boundary & Viseme Phase Drift (Δφ = 142ms)` |
| **TypeSafe `Jev` System-1 RLCD Engine** | **"Confidence Level"** (e.g., *"High Confidence — 98% Sure"*) | `TypeSafe Jev System-1 RLCD Distribution (128ms, ±2.4% Epistemic Band)` |
| Causal Perturbation (`arXiv:2603.01092v3` App. F.2)

 | **`[ ✂️ Hide the Fake Part to Test ]`** button | `Causal Necessity & Sufficiency Ablation (Confidence Shift: 12% → 99% Real)`

 |
| Evolutionary Misinformation (`arXiv:2603.01092v3` Fig. 27)

 | **"Where This Came From"** (3-step visual story history) | `Muse Spark Web-Grounded Mutation Graph & Next-Variant Prediction`

 |
| Alien Space Sampler ($F_{\beta=0.7}$)

 | **"Hidden Trick Spotted"** (e.g., *"AI video recorded off a laptop screen"*) | `Alien Space Score F_β=0.7 (Coherence z_C: +1.8, Detector Unavailability z_U: +2.4)`

 |
| **Rust WASM ELA + 2D FFT + Noiseprint** | **"Camera & Lighting Check"** | `Interactive Optical X-Ray Loupe (Boundary ΔELA, 2D FFT Spectrum, Dithercn Halftone)` |

### 3.3 The 5 Universal Verdict Badges

Every scan—both on the Main Checker and inside the floating **RON** companion—resolves to one of five unmistakable badges:

1. 🟢 **Real** (`{ ^-^ }` Emerald `#10B981`): *"Looks and sounds like a real camera and microphone."*
2. 🟡 **Real, Just Filtered** (`{ o_o }` Amber `#F59E0B`): *"Real photo or video—just touched up with color filters, cropping, or lighting."*
3. 🟠 **Partly Changed by AI** (`( ¬_¬ )` Orange-Coral `#F97316`): *"Careful! Most of this is real, but one specific part was changed by AI."*
4. 🟣 **Real Video, Twisted Story** (`( o_¬ )` Violet `#8B5CF6`): *"The video and voice are real recordings, but stitched together from different events or dates."*


5. 🔴 **Made by AI** (`[ x_x ]` Crimson `#EF4444`): *"Created entirely by artificial intelligence."*
*(Plus a fallback ⚪ **Too Blurry to Be Sure** when heavy social media compression destroys the evidence).*

---

## 4. Detailed Feature Specifications

### Feature 1: The Universal Link & Media Checker (Main Web App)

1. **Single Smart Input Bar (Hero):**
* Accepts **any pasted social URL** (`tiktok.com`, `x.com`, `instagram.com`, `youtube.com`, `reddit.com`) OR a dragged-and-dropped **video, image, or audio file**.
* **Animated Platform Badge:** Right beside the prompt *"Paste a link or drop a file"*, a circular pill smoothly morphs every 1.5 seconds between **TikTok → X → Instagram → YouTube → Photo/Audio** icons.
* **Instant 1-Click Sample Strip:** Directly underneath the bar sit 4 pre-loaded real-world cases so judges can test with zero typing:
* *Sample 1 (X / Twitter Link):* Street interview where **only 3 seconds of voice (`0:04–0:07`) and a held sign** were altered by AI (**🟠 Partly Changed by AI**).
* *Sample 2 (TikTok Link):* Real 2022 footage paired with stolen 2026 audio (**🟣 Real Video, Twisted Story**).


* *Sample 3 (Instagram Reel):* Color-graded travel portrait by a human creator (**🟡 Real, Just Filtered** — generates a shareable *"Verified Human Receipt"*).
* *Sample 4 (YouTube Short):* AI video recorded off a laptop screen with an iPhone to fool standard detectors (**🔴 Made by AI — Hidden Trick Spotted**).






2. **Interactive Media Stage & Plain-English Spotlights:**
* Renders the video/image/audio player with a clean glowing outline around the exact forged object or face and a colored highlight on the audio waveform timeline.
* The 1-Click `"Hide the Fake Part"` Proof Test: Clicking this button masks out the highlighted fake object or mutes the 3-second cloned audio clip and immediately re-runs the meter—watching the rest of the clip jump to **🟢 99% Real**.


* "Where This Came From" Story Card: Shows a simple 3-node horizontal breadcrumb of when the original media first appeared online and how it was altered over time.




3. **The `[ Show Proof ▾ ]` Drawer (Progressive Disclosure for Judges):**
* Clicking **`[ Show Proof ▾ ]`** smoothly expands (and optionally dims the canvas into Darkroom contrast) to reveal:
* **Draggable Optical X-Ray Loupe:** Move a circular magnifying glass across the media to inspect **Compression Seams (ELA)**, **AI Grid Patterns (2D FFT)**, and **1-Bit Dither Anomaly Masks (`Dithercn`)**, complete with tactile **DialKit-style** sensitivity knobs.
* **Meta AI Model Execution Trace:** Live step-by-step badges showing `SAM 3.1` masks, `Muse Voice Transcribe` segments, `Muse Spark Open` & `Muse Wonder` reasoning, `Muse Image` forensic comparison plate, `TypeSafe Jev` probability curve, and the `Alien Space` score ($F_{\beta=0.7}$).







### Feature 2: The Floating `RON` Companion (Zero-Install Window + Chrome Extension)

1. **Mode A — Zero-Install Browser Floating Window (`Document Picture-in-Picture API`):**
* Clicking **`[ 💬 Float RON on My Screen ]`** (or pressing `Alt + R`) calls `window.documentPictureInPicture.requestWindow({ width: 320, height: 130 })` paired with `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`.
* This pops out a tiny, always-on-top floating window that hovers unobtrusively in the corner of the user's screen while they browse X, YouTube, TikTok, or any desktop window.
* **Privacy First:** Just like HeyClicky, **RON** stays asleep (`[ -_- ] Sleeping · Tap or Alt+R to Check`) until the user taps the floating buddy or hits `Alt + R`.
* **Color Shift + Message Bubble:** Within ~1.2 seconds of tapping, the floating **RON** avatar shifts its aura color (Green, Yellow, Orange, Purple, or Red), animates its expression (`{ ^-^ }`, `( ¬_¬ )`), and shows a 1-sentence plain-English bubble:
> *"Hold up! Most of this clip is real, but the voice at 0:04 was changed by AI. [ See Full Proof in RON → ]"*


* Clicking the bubble focuses the main RON web app with that exact media already loaded and dissected.


2. **Mode B — Lightweight Chrome Extension (`/extension` in Repo):**
* A clean 3-file Manifest V3 extension (`manifest.json`, `content.js`, `background.js`) that injects the floating **RON** pill directly onto `x.com`, `tiktok.com`, `youtube.com`, and `instagram.com` and syncs with the main app via **Convex**.


3. **Mode C — Built-In "Social Feed Simulator" Tab (Judge Safety Net):**
* Inside the main web app, a tab labeled **`[ Try Floating RON on a Live Feed ]`** renders a scrollable mock X/TikTok/Instagram feed with the floating **RON** avatar hovering over it—guaranteeing that even a judge on a mobile browser or restricted corporate monitor can experience the floating avatar magic in one click.



---

## 5. Design System & Visual Language: "Daylight Trust × Forensic Darkroom"

### 5.1 Dual-Theme Color Architecture (`mode-watcher` — Default Light Mode + Dark Mode Toggle)

Configured via Tailwind CSS v4 `@custom-variant dark (&:is(.dark *))` and `mode-watcher@^1.0.0` (`<ModeWatcher defaultMode="light"/>`):

| Semantic Token | Default Light Mode ("Daylight Trust" — Pangram × Truecaller) | Dark Mode ("Forensic Darkroom" — Leica × ObsidianUI) |
| --- | --- | --- |
| **Background Canvas (`--bg-canvas`)** | `#FAF9F5` (Warm editorial alabaster — zero harsh glare) | `#090A0D` (Deep optical obsidian) |
| **Card Surface (`--bg-surface`)** | `#FFFFFF` (Pure crisp card surface) | `#12141A` (Elevated carbon slate) |
| **Subtle / Well Surface (`--bg-subtle`)** | `#F2F0E8` (Soft recessed input & pill well) | `#1A1D24` (Recessed instrument well) |
| **Primary Ink (`--text-primary`)** | `#141517` (Deep charcoal ink) | `#F4F5F8` (Crisp off-white) |
| **Muted Text (`--text-muted`)** | `#5E636E` (Balanced slate gray) | `#8C92A4` (Muted cool gray) |
| **Structural Border (`--border-ink`)** | `1.5px solid #1E2024` (Tactile neo-brutalist ink outline) | `1.5px solid #2E3440` (Crisp darkroom hairline) |
| **Tactile Shadow (`--shadow-hard`)** | `2px 2px 0px #1E2024` (Crisp physical card/button depth) | `2px 2px 0px rgba(0, 0, 0, 0.75)` |

### 5.2 Typography, Iconography & Motion

* **Display & Friendly UI Copy:** **`Space Grotesk`** (or **`Plus Jakarta Sans`**) — warm, approachable, high-legibility geometric headers (`700` weight, `-0.02em` tracking) and effortless body text (`400`/`500` weight).
* **Timestamps, Links & `Show Proof` Metrics:** **`JetBrains Mono`** (`font-variant-numeric: tabular-nums`) — used strictly for video timestamps (`0:04–0:07`), confidence badges (`98%`), and the technical readouts inside `Show Proof`.
* **Iconography:** **`@lucide/svelte`** (`^0.482.0`+, Svelte 5 native) paired with custom **Iconly-style** duotone SVG badges for the 5 verdict states and cycling social platform icons.
* **Animations & Shaders:**
* **Svelte 5 Native Physics (`svelte/motion`):** `Spring` drives the floating **RON** avatar's subtle hover bounce and the draggable Optical X-Ray Loupe; `Tween` drives smooth score transitions during the `"Hide the Fake Part"` test.
* **Dithercn Halftone Shader (`lib/dither`):** When hovering over a manipulated region or opening `Show Proof`, the fake area renders with a distinctive **1-bit Bayer halftone dither pattern** so the user visually sees the synthetic boundary.



---

## 6. Verified Tech Stack & System Architecture

### 6.1 Frontend & Client-Side Rust WASM Stack

* **Framework:** **SvelteKit 2 + Svelte 5 (Runes)** (`$state`, `$derived`, `$effect`, `$props`) + **TypeScript** + **Tailwind CSS v4**.
* **UI Components:** **`shadcn-svelte`** (Svelte 5 Runes-native) + **`bits-ui@^1.0.0`** + **`mode-watcher@^1.0.0`** + **`svelte-sonner@^1.0.0`** + **`@lucide/svelte`**.
* **Client-Side Signal Engine (Rust → WebAssembly):**
* Located in `/rust-forensics` (`Cargo.toml` with `wasm-bindgen = "0.2"`, `rustfft = "6.2"`), compiled via `wasm-pack build --target web` and loaded off the main thread in `src/lib/workers/forensics.worker.ts` using `vite-plugin-wasm`.
* Performs single-pass `Uint8Array` buffer processing in `<10ms` for:
1. Boundary-Differential Error Level Analysis ($\Delta_{\text{ELA}}$),
2. 2D Azimuthal Fast Fourier Transform ($\kappa_{\text{FFT}}$), and
3. 1-bit Bayer halftone dither mask generation.





### 6.2 Real-Time Database & Sync Layer: Convex (`convex-svelte`)

* **Packages:** `convex` + `convex-svelte` (`setupConvex(PUBLIC_CONVEX_URL)` in `src/routes/+layout.svelte`).
* **3 Core Convex Tables (`convex/schema.ts`):**
1. `scans`: Stores active and historical media checks (`mediaUrl`, `platform`, `verdictType`, `plainSummary`, `highlightedRegions`, `storyTimeline`, `proofDetails`).
2. `threatHashes`: Our **Truecaller-style Community Ledger**—stores perceptual hashes (`pHash` + audio spectral fingerprint) of previously dissected fakes so repeat viral clips are flagged in `<40ms`.
3. `buddySessions`: Real-time bridge syncing the Floating **RON** Companion / Chrome Extension with the main web app tab.



### 6.3 Serverless GPU & AI Backend: Modal + Meta Model API

Using your claimed **$100 Modal credits** and **$150 Meta Model API credits**, a single Python file (`modal_backend/app.py`) deployed via `modal deploy` powers the heavy lifting:

| Service / Model | Runtime Host | Exact Role in RON |
| --- | --- | --- |
| **Social Link Unpacker (`yt-dlp` + `ffmpeg`)** | **Modal** (`@modal.fastapi_endpoint`) | Extracts video frames, audio waveform, caption, and metadata from pasted TikTok, X, IG, and YouTube links. |
| **`Muse Glimmer` (Open-Weight)** | **Modal Serverless GPU** | Fast triage model powering the **Floating `RON` Companion** (`~600ms` initial screen/link check). Unlocks **$10K Open-Weight Prize**. |
| **`Muse Spark Open` (`meta-models/muse-spark-open-1026`)** | **Modal Serverless GPU (`vLLM`)** | Open-weight 816B/42B MoE specialist running deep cross-modal reasoning and computing the **Alien Space Score ($F_{\beta=0.7}$)**. Unlocks **$10K Open-Weight Prize**.

 |
| **`SAM 3.1` (`sam-3.1`)** | **Meta Model API** | Generates pixel-accurate object/face masks (`M1, M2...`) so RON highlights the exact edited object on screen. |
| **`Muse Voice Transcribe`** | **Meta Model API** | Extracts word-level timestamps & speaker turns to pinpoint the exact seconds of an AI voice clone. |
| **`Muse Wonder` (`muse-wonder-1.0`) & `Muse Spark` (`muse-spark-1.3`)** | **Meta Model API** | Lead multimodal orchestrator + live **Web Search Grounding** to build the **"Where This Came From" Story Timeline**. Unlocks **$5K Agentic Prize**.

 |
| **`Muse Image`** | **Meta Model API** | Generates the annotated visual **X-Ray Proof Plate** inside `Show Proof`. Unlocks **$5K Creative Prize**. |
| **TypeSafe `Jev` System-1 RLCD Adapter** | **Fast Parallel Classifier** | Combines the signal vector into calibrated probabilities across the 5 verdict badges with `±` confidence bands. |

---

## 7. 48-Hour Development Timeline (Nov 3, 12:15 AM GMT → Nov 5, 2:00 AM GMT)

| Phase & Time Window (GMT) | Deliverable | Key Verification Milestone |
| --- | --- | --- |
| **Phase 1: Foundation & UI Shell**<br>

<br>*(Tue Nov 3 · 00:30 – 06:00 GMT)* | Initialize SvelteKit 2 + Svelte 5 Runes + Tailwind v4 + `shadcn-svelte` + `mode-watcher` (Default Light Mode + Dark toggle) + Convex schema (`scans`, `threatHashes`, `buddySessions`). | App boots in Light Mode, toggles cleanly to Dark Mode, and connects to Convex. |
| **Phase 2: Main Checker + Simple Mode + `Show Proof**`<br>

<br>*(Tue Nov 3 · 10:00 – 18:00 GMT)* | Build the Universal Social Link & File Bar (cycling icons), Media Stage with glowing object/audio callouts, 1-Click `"Hide the Fake Part"` test, Story Timeline, and the `[ Show Proof ▾ ]` drawer with the Rust WASM / Worker X-Ray Loupe.

 | All 4 pre-loaded social link cases & file uploads run at 60 FPS in both Simple Mode and `Show Proof` Mode. |
| **Phase 3: Floating `RON` Companion**<br>

<br>*(Tue Nov 3 · 18:00 – 23:00 GMT)* | Build the `Document Picture-in-Picture` + `getDisplayMedia` floating window, the `/extension` Manifest V3 Chrome Extension, and the In-App Social Feed Simulator tab. | Clicking `[ Float RON ]` pops out the always-on-top mini avatar; clicking its speech bubble teleports the post into the main app. |
| **Phase 4: Modal + Meta Model API Live Wiring**<br>

<br>*(Wed Nov 4 · 08:00 – 17:00 GMT)* | Deploy `modal_backend/app.py` (`yt-dlp` social link extractor + `Muse Spark Open` / `Muse Glimmer` on Modal) and connect live **Meta Model API** keys (`SAM 3.1`, `Muse Wonder`, `Muse Spark`, `Muse Voice Transcribe`, `Muse Image`). | Live pasted X/TikTok/YouTube links and uploaded files execute end-to-end through Meta + Modal endpoints (with instant fallback if rate-limited). |
| **Phase 5: Demo Video, Public Repo Audit & Submission**<br>

<br>*(Wed Nov 4 · 17:00 – 23:30 GMT)* | Verify public GitHub repo shows only Oct 26 – Nov 4 commits, record the 3-minute demo video, post on X for the **$20K Most Viral Prize**, and submit on Cerebral Valley (**2.5 hours before the 2:00 AM GMT cutoff**). | Submitted and verified before deadline. |

---

## 8. Builder Check Summary: Decisions & Sensible Defaults Made



Per your `brainstorming-SKILL.md` Builder Check protocol, I reviewed the entire specification from the perspective of the executing software engineer and settled the following implementation details as **my calls** so you can inspect or override them before we generate code:

1. Auto-Darkening Inside `Show Proof` (My Call): While the entire app defaults to **Light Mode** (`#FAF9F5`) with a manual Light/Dark switch in the top navbar, opening the **`[ Show Proof ▾ ]`** X-Ray Loupe automatically gives the media stage a dark `#090A0D` frame housing so glowing ELA/FFT heatmaps remain legible even in Light Mode.


2. Resilient Dual-Path for Social Links (My Call): Social platforms like TikTok and Instagram aggressively block datacenter IPs from scraping raw video streams. Our Modal endpoint (`yt-dlp`) will handle live extraction first, and if a platform blocks a live scrape during judging, it automatically falls back to oEmbed metadata + frame capture + 4 pre-cached real social post bundles so a judge **never** sees an error screen.


3. Rust WASM with Automatic TypeScript WebWorker Fallback (My Call): I will provide both the Rust `/rust-forensics` crate (`Cargo.toml` + `src/lib.rs`) *and* an identical SIMD-style TypeScript WebWorker fallback inside `forensics.worker.ts` so your Vite dev server runs immediately even before you run `wasm-pack build`.



---

