# StarGaze: hackPHS 2026 submission

**Point your phone at the night sky and StarGaze tells you what you're looking at, and the story behind it.**

Take or pick a photo of the night sky. StarGaze works out exactly where in the sky the photo points, marks the named stars on your photo, names the constellation, and tells you the myth behind it, including which culture the story comes from.

| | |
|---|---|
| Event | [hackPHS 2026](https://hackphs2026.devpost.com/), Princeton High School |
| Theme | "Into the Skies" |
| Mobile app (this repo) | https://github.com/bhargavkulkarni01/StarGazeApp |
| Backend API | https://github.com/bhargavkulkarni01/StarGazeAPI |
| Demo video | https://youtu.be/LP1d7pLKE6w |
| Team | [Bhargav Kulkarni](https://github.com/bhargavkulkarni01), [Angelos Giannikouris](https://github.com/ValveTextureFile), Krish Patel|

---

## How it fits "Into the Skies"

StarGaze is about the sky itself: the stars you can see from your own backyard.

- **It answers a question everyone asks when they look up:** "What star is that?" You don't need a telescope, a star chart, or to know where north is. A normal phone photo is enough.
- **It uses real astronomy, not guesses.** The photo is *plate-solved* against star catalogs with [Astrometry.net](https://nova.astrometry.net). That's the same method observatories use to find where a telescope is pointing. The app shows the real celestial coordinates of the photo's center (right ascension and declination), its field of view, and the deep-sky objects in frame.
- **It connects the sky to the people who named it.** For thousands of years, cultures around the world told stories about the same stars. Once StarGaze knows the constellation, it tells that constellation's myth (Greek, Roman, Arabic, Indian, Polynesian and more) and mentions the specific stars from *your* photo.
- **It gets people outside looking up.** The goal is to make the night sky feel personal: your photo, your stars, your story, ready to share with friends.

---

## What it does

1. **Capture.** Take a photo with the camera or pick one from the gallery. Optionally enter a rough field of view in degrees to speed up solving.
2. **Solve.** The photo is uploaded to our backend. A live progress log shows each stage ("Uploading image", "Solving", "Writing the myth") with a running timer, and you can cancel at any time.
3. **Explore.** Named stars are marked on your photo. Tap a marker to see its name and type. Catalog-only entries (like `HD 34085`) are counted but not drawn, so the photo stays readable. The app also shows:
    - the constellation the photo is centered on,
    - the sky coordinates of the center (RA in h/m/s, Dec in °/′/″), the roll angle and the field of view,
    - the galaxies, nebulae and clusters in the frame.
4. **Read and share.** A short myth about the constellation, written for your photo, which you can share from the app.

---

## How it works

```
 Phone (React Native app)                Backend (FastAPI)                     External services
 ────────────────────────                ─────────────────                     ─────────────────
 camera / gallery photo
        │  POST /analyze (photo, fov) ──► validate, hash, cache check
        │                                 background job:
        │                                   1. upload photo           ───────► Astrometry.net (plate solve)
        │                                   2. poll until solved      ◄───────  calibration, star annotations,
        │                                                                       objects in field
        │                                   3. center RA/Dec ──► constellation  (astropy)
        │                                   4. constellation + star names ───► Claude Haiku 5.5 (myth)
        │  GET /analyze/{job_id} (poll) ◄── status, stage text, result
        ▼
 star markers, coordinates, story
```

**Mobile app:** React Native 0.87 (TypeScript, no Expo) for iOS and Android, with `react-native-image-picker` for the camera and gallery. All the UI is in `App.tsx`.

**Backend:** Python, FastAPI, astropy, Pillow and the Anthropic SDK.
- Plate solving takes 30 seconds or more, so the API is asynchronous: the app starts a job and polls every 2.5 s, for up to 6 minutes.
- Results are cached by photo hash. Uploading the same photo again returns instantly, and duplicate uploads share one job.
- The calibration, annotations and objects-in-field requests to Astrometry.net run in parallel.
- API keys stay on the server, so the app never sees them.

---

## How and where we used AI

The hackPHS judging criteria say AI is "allowed yet regulated", so here is exactly where it was used.

### 1. AI inside the product: the myth generator

| | |
|---|---|
| Model | Anthropic **Claude Haiku 5.5** (`claude-haiku-5-5`), called through the Anthropic API |
| Where | `StarGazeAPI/backend/services/ai_services.py`, called from `run_job` in `backend/main.py` |
| Input | The constellation name (computed by astropy, not the AI) and up to 10 proper star names found in the photo |
| Output | A title line plus a ~100-word story in a storyteller tone that names the origin culture and weaves in only the stars that matter to the myth |
| Settings | Low effort, 2,000-token cap, 30 s timeout |

**What the AI does *not* do:** it does not identify stars or the constellation. That is done with deterministic astronomy: Astrometry.net plate solving plus astropy's `get_constellation` on the solved coordinates. The AI only gets facts that were already verified, which keeps it from inventing stars that aren't in the photo.

**When the AI fails:** if the Claude call errors out, the user still gets the full star map and coordinates, plus a fallback message instead of the story. Failed stories are not cached, so the next upload tries again.

### 2. AI as a development tool

- We used **Claude** (Anthropic's AI assistant) while building the backend API, the story-generation code, and the documentation. This is also disclosed in the backend README.
- This submission document was drafted with **Claude Code** from the project's source code and the hackPHS Devpost page, then reviewed by the team.


Everyone on the team reviewed, tested and integrated all AI-assisted code. The architecture, the theme idea, and the choice to use plate solving instead of AI to identify stars were our own decisions.

---

## Judging criteria

| Criterion | How StarGaze addresses it |
|---|---|
| **Innovativeness** | Combines professional plate solving (normally used on telescope images) with generative storytelling in a phone app. No telescope or star chart needed. |
| **Functionality** | Works end to end on the iOS Simulator, the Android Emulator and real devices. It includes a server health check, live progress, cancelling, clear error messages (such as "simulators don't have a camera"), result caching and backend tests (`backend/test_main.py`). |
| **Creativity** | Instead of only labelling dots, the app ties each photo to the human stories about those stars across cultures. |
| **Theme** | The whole project is about looking into the skies (see above). |
| **Technical** | Asynchronous job pipeline, parallel API calls, content-hash caching, coordinate math (RA/Dec formatting, field of view from pixel scale), cross-platform native app. AI usage is limited and fully disclosed. |

**Prize track:** [MLH] Best Use of GenAI. The app uses the Anthropic API, and keeps generative AI to the creative part of the product.

---

## Running it

### 1. Backend

```bash
cd StarGazeAPI/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # set ANTHROPIC_API_KEY and ASTROMETRY_API_KEY
uvicorn main:app --host 0.0.0.0 --port 8000
```

Check that `http://localhost:8000/health` returns `{"ok": true, "astrometry_key_set": true}`.

### 2. App (simulator or emulator)

Requires Node ≥ 22.11. iOS needs Xcode and CocoaPods; Android needs Android Studio, an emulator and JDK 17.

```bash
cd StarGazeApp
npm install
npm start                                   # Metro, keep it running

# iOS (new terminal)
bundle install && (cd ios && bundle exec pod install)
npm run ios

# Android (start an emulator in Android Studio first)
npm run android
```

**To test it:** drag a night-sky photo onto the simulator window to save it to the gallery, tap **Gallery**, pick the photo, and wait for the result. Simulators have no real camera, so use the gallery.

**Backend address:** the iOS Simulator uses `http://localhost:8000` and the Android Emulator uses `http://10.0.2.2:8000`. On a real phone, set `API_URL` in `App.tsx` to your computer's LAN IP.

---

## Challenges

- **Getting reliable star identification from phone photos.** Narrow star databases fail on wide phone shots. Astrometry.net solves "blind" at almost any scale, and an optional field-of-view hint makes it much faster.
- **Slow solves.** The public solver can take minutes and has a queue. We designed the app around async jobs, live stage updates and caching, so the app never just shows a spinner.
- **Keeping the AI accurate.** The model only gets facts that were already verified, so it can't invent stars that aren't in the photo.
- **Simulator networking.** The iOS Simulator and Android Emulator reach the host computer at different addresses (`localhost` vs `10.0.2.2`), and both platforms restrict plain HTTP.

## Privacy and limitations

- Photos are uploaded to nova.astrometry.net as private, non-public submissions. Don't use photos you can't share with a third party.
- Jobs live in server memory for an hour. Restarting the backend clears them.
- AI-written myths can contain mistakes, so treat them as storytelling, not as a scholarly source.

## Submission checklist (from the hackPHS rules)

- [x] Both repositories are **public** and stay public after the event (required for prizes)
- [ ] Devpost entry has the project description, repo links and team members
- [ ] Demo video linked, and public
- [ ] All work done during the hackathon window; only small bug fixes after time is up
- [ ] Submitted before the deadline: **Oct 11, 2026, 10:00am EDT**
