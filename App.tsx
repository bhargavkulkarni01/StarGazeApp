import React, { ReactNode, useEffect, useRef, useState } from "react";
import {
  Animated, Easing, Image, Platform, SafeAreaView, ScrollView, Share, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, useWindowDimensions, View,
} from "react-native";
import { Asset, launchCamera, launchImageLibrary } from "react-native-image-picker";

// iOS simulator shares the Mac's network, so localhost works. The Android emulator reaches the
// host at 10.0.2.2. On a real phone, use your computer's LAN IP, e.g. http://192.168.1.20:8000
const API_URL =
  Platform.select({ ios: "http://localhost:8000", android: "http://10.0.2.2:8000" }) ?? "http://localhost:8000";
const POLL_MS = 2500, MAX_WAIT_MS = 6 * 60 * 1000;

const C = {
  bg: "#0a0e18", panel: "#0f1524", text: "#ebe5d6", dim: "#8f97aa", faint: "#5b6479",
  line: "rgba(235,229,214,0.14)", brass: "#c8a55f", red: "#d9776a", green: "#7fae8a",
};
const SERIF = Platform.select({ ios: "Georgia", android: "serif" }) ?? "serif";
const MONO = Platform.select({ ios: "Menlo", android: "monospace" }) ?? "monospace";
const HAIR = StyleSheet.hairlineWidth;

// ------------------------------------------------------------------ types & helpers
type Star = { name: string; names: string[]; type: string | null; proper: boolean; x: number; y: number };
type Result = {
  location: { ra: number; dec: number; roll: number; fov: number };
  constellation: string;
  image_size: { width: number; height: number };
  stars: Star[];
  objects_in_field: string[];
  story: string;
};
type Job = { status: "processing" | "success" | "failed"; stage?: string; result?: Result; error?: string; detail?: string };
type Phase = "idle" | "working" | "done" | "error";

const CATALOG = /^(Tycho-?2|TYC|HIP|HD|HR|SAO|BD|GC|PGC|UGC|2MASS|Gaia|UCAC\d*|USNO|GSC|IRAS|PSR|WDS)\b/i;
const isNamed = (st: Star) => !!st.name?.trim() && st.proper !== false && !CATALOG.test(st.name.trim());
const kind = (t: string | null) => {
  const k = (t ?? "").toLowerCase();
  if (k.includes("bright") || k === "star") return "Star";
  if (k === "ngc" || k === "ic") return k.toUpperCase() + " object";
  return "Object";
};
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (sec: number) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
const hms = (deg: number) => {
  const t = Math.round(((deg % 360) + 360) % 360 / 15 * 3600) % 86400;
  return `${pad(Math.floor(t / 3600))}h ${pad(Math.floor((t % 3600) / 60))}m ${pad(t % 60)}s`;
};
const dms = (deg: number) => {
  const t = Math.round(Math.abs(deg) * 3600);
  return `${deg < 0 ? "−" : "+"}${pad(Math.floor(t / 3600))}° ${pad(Math.floor((t % 3600) / 60))}′ ${pad(t % 60)}″`;
};
const parseFov = (v: string) => { const n = parseFloat(v); return n > 0 && n <= 180 ? n : null; };
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
  const id = setTimeout(res, ms);
  signal.addEventListener("abort", () => { clearTimeout(id); rej(new Error("aborted")); }, { once: true });
});
const parseStory = (raw: string) => {
  const clean = (l: string) => l.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const first = lines.findIndex((l) => l.length > 0);
  const title = clean(lines[first] ?? "");
  const paragraphs = lines.slice(first + 1).join("\n").replace(/\*\*/g, "").split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
  return paragraphs.length === 0 || title.length > 90 ? { title: "", paragraphs: [clean(raw)] } : { title, paragraphs };
};

async function errText(res: Response) {
  try { const j = await res.json(); if (j?.detail) return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
  return `The server answered with an error (${res.status}).`;
}
async function analyze(asset: Asset, fov: number | null, signal: AbortSignal, onStage: (s: string) => void): Promise<Result> {
  const fd = new FormData();
  fd.append("image", { uri: asset.uri, name: asset.fileName || "sky.jpg", type: asset.type || "image/jpeg" } as any);
  if (fov) fd.append("fov", String(fov));
  const start = await fetch(`${API_URL}/analyze`, { method: "POST", body: fd, signal });
  if (!start.ok) throw new Error(await errText(start));
  const { job_id } = await start.json();
  if (!job_id) throw new Error("The server didn't return a job id.");
  const t0 = Date.now();
  for (;;) {
    await sleep(POLL_MS, signal);
    const r = await fetch(`${API_URL}/analyze/${encodeURIComponent(job_id)}`, { signal });
    if (!r.ok) throw new Error(await errText(r));
    const j: Job = await r.json();
    if (j.stage) onStage(j.stage);
    if (j.status === "success" && j.result) return j.result;
    if (j.status === "failed") throw new Error(j.error || "The solver couldn't match this photo.");
    if (Date.now() - t0 > MAX_WAIT_MS) throw new Error("Solving took too long. Try a sharper photo, or give a field of view.");
  }
}

// ------------------------------------------------------------------ pieces
function Reveal({ children }: { children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(v, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [v]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

const Cap = ({ children, color, style }: { children: ReactNode; color?: string; style?: object }) => (
  <Text style={[s.cap, color ? { color } : null, style]}>{children}</Text>
);
const Rule = ({ style }: { style?: object }) => <View style={[{ height: HAIR, backgroundColor: C.line }, style]} />;

function Btn({ label, onPress, ghost, style }: { label: string; onPress: () => void; ghost?: boolean; style?: object }) {
  return (
    <TouchableOpacity accessibilityRole="button" activeOpacity={0.75} onPress={onPress}
      style={[s.btn, ghost ? s.btnGhost : s.btnSolid, style]}>
      <Text style={[s.btnText, ghost && { color: C.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// A chart-style reticle, cropped off the edge of the screen.
function Reticle({ size }: { size: number }) {
  const ring = (d: number, o: number, dashed?: boolean) => (
    <View style={{ position: "absolute", left: (size - d) / 2, top: (size - d) / 2, width: d, height: d, borderRadius: d / 2,
      borderWidth: 1, borderColor: `rgba(200,165,95,${o})`, borderStyle: dashed ? "dashed" : "solid" }} />
  );
  const tick = (a: object) => <View style={[{ position: "absolute", backgroundColor: "rgba(200,165,95,0.5)" }, a]} />;
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {ring(size, 0.45)}{ring(size * 0.74, 0.25, true)}{ring(size * 0.4, 0.45)}
      {tick({ left: 0, right: 0, top: size / 2, height: HAIR })}
      {tick({ top: 0, bottom: 0, left: size / 2, width: HAIR })}
      {tick({ left: size / 2 - 3, top: -6, width: 1, height: 12 })}
      {tick({ left: size / 2 - 3, bottom: -6, width: 1, height: 12 })}
      <View style={{ position: "absolute", left: size / 2 - 3, top: size / 2 - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: C.brass }} />
    </View>
  );
}

function Photo({ uri, w, h, size, marks, sel, onSel, scanning }: {
  uri: string; w: number; h: number; size?: { width: number; height: number };
  marks: { st: Star; i: number }[]; sel: number | null; onSel: (i: number | null) => void; scanning: boolean;
}) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!scanning) return;
    const loop = Animated.loop(Animated.timing(y, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [scanning, y]);
  return (
    <View style={[s.photo, { width: w, height: h }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {scanning && (
        <Animated.View pointerEvents="none" style={[s.scan, { transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, h - 1] }) }] }]} />
      )}
      {size && marks.map(({ st, i }, n) => {
        const x = (st.x / size.width) * w, yy = (st.y / size.height) * h;
        const active = sel === i, flip = x > w * 0.6, show = active || n < 10;
        return (
          <View key={i} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
            <TouchableOpacity onPress={() => onSel(active ? null : i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ position: "absolute", left: x - 8, top: yy - 8, width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
              <View style={[s.mark, active && s.markOn]} />
            </TouchableOpacity>
            {show && (
              <View pointerEvents="none" style={[{ position: "absolute", top: yy - 8, height: 16, flexDirection: flip ? "row-reverse" : "row", alignItems: "center" },
                flip ? { right: w - x + 8 } : { left: x + 8 }]}>
                <View style={{ width: 12, height: 1, backgroundColor: C.brass }} />
                <Text numberOfLines={1} style={[s.tag, active && { color: C.bg, backgroundColor: C.brass }]}>{st.name}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <View style={s.row}><Cap>{k}</Cap><Text style={s.rowVal}>{v}</Text></View>
);

// ------------------------------------------------------------------ app
export default function App() {
  const { width, height } = useWindowDimensions();
  const W = Math.min(width, 520) - 48;

  const [phase, setPhase] = useState<Phase>("idle");
  const [image, setImage] = useState<Asset | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [fov, setFov] = useState("");
  const [log, setLog] = useState<{ at: number; text: string }[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [server, setServer] = useState<"checking" | "online" | "offline">("checking");

  const token = useRef(0), ctrl = useRef<AbortController | null>(null), t0 = useRef(0);

  const checkServer = async () => {
    setServer("checking");
    const c = new AbortController(), id = setTimeout(() => c.abort(), 4000);
    try { await fetch(`${API_URL}/health`, { signal: c.signal }); setServer("online"); } // any HTTP answer = reachable
    catch { setServer("offline"); } finally { clearTimeout(id); }
  };
  useEffect(() => { checkServer(); return () => { token.current++; ctrl.current?.abort(); }; }, []);

  useEffect(() => {
    if (phase !== "working") return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const addLog = (text: string) => setLog((l) => (l.length && l[l.length - 1].text === text ? l
    : [...l, { at: Math.round((Date.now() - t0.current) / 1000), text }]));

  const start = async (asset: Asset) => {
    ctrl.current?.abort();
    const my = ++token.current, c = new AbortController();
    ctrl.current = c; t0.current = Date.now();
    setImage(asset); setResult(null); setError(""); setSel(null); setElapsed(0); setLog([]); setPhase("working");
    addLog("Uploading photo");
    try {
      const r = await analyze(asset, parseFov(fov), c.signal, (st) => { if (my === token.current) addLog(st.replace(/…$/, "")); });
      if (my !== token.current) return;
      if (!r?.constellation) throw new Error("The solver finished but found no constellation in this frame.");
      setResult(r); setPhase("done");
    } catch (e) {
      if (my !== token.current || (e instanceof Error && (e.message === "aborted" || e.name === "AbortError"))) return;
      setError(e instanceof TypeError
        ? `Can't reach the server at ${API_URL}. Make sure the backend is running, then try again.`
        : e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  };
  const cancel = () => { token.current++; ctrl.current?.abort(); setPhase("idle"); };
  const reset = () => { token.current++; ctrl.current?.abort(); setPhase("idle"); setImage(null); setResult(null); setSel(null); };

  const pick = async (camera: boolean) => {
    const opts = { mediaType: "photo" as const, selectionLimit: 1, quality: 0.9 as const, maxWidth: 2400, maxHeight: 2400 };
    const res = camera ? await launchCamera(opts) : await launchImageLibrary(opts);
    if (res.didCancel) return;
    if (res.errorCode) {
      setError(res.errorCode === "camera_unavailable" ? "No camera is available here (simulators don't have one). Choose a photo instead." : res.errorMessage || res.errorCode);
      setPhase("error"); setImage(null);
      return;
    }
    const a = res.assets?.[0];
    if (a?.uri) start(a);
  };

  // ---- derived layout
  const aspect = (result?.image_size.width ?? image?.width ?? 4) / (result?.image_size.height ?? image?.height ?? 3);
  const ph = Math.min(W / aspect, height * 0.5), pw = ph * aspect;
  const marks = (result?.stars ?? []).map((st, i) => ({ st, i })).filter(({ st }) => isNamed(st));
  const hidden = (result?.stars ?? []).filter((st) => st.name?.trim() && !isNamed(st)).length;
  const story = result ? parseStory(result.story) : null;
  const storyFailed = !!result?.story.startsWith("(Could not");
  const selStar = sel !== null ? result?.stars[sel] : undefined;

  const share = () => result && story && Share.share({
    message: `${result.constellation}\n\n${story.title ? story.title + "\n\n" : ""}${story.paragraphs.join("\n\n")}`,
  });

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={{ width: W, alignSelf: "center" }}>

          {/* masthead */}
          <View style={s.mast}>
            <Text style={s.wordmark}>Stargaze</Text>
            <TouchableOpacity onPress={checkServer} disabled={server === "checking"} style={s.status}>
              <View style={[s.dot, { backgroundColor: server === "online" ? C.green : server === "offline" ? C.red : C.faint }]} />
              <Cap color={C.dim}>{server === "online" ? "Server online" : server === "offline" ? "Server offline" : "Checking"}</Cap>
            </TouchableOpacity>
          </View>
          <Rule />

          {/* ---------------- idle */}
          {phase === "idle" && (
            <Reveal>
              <View style={{ height: 150, overflow: "hidden" }}>
                <View style={{ position: "absolute", right: -W * 0.28, top: -30 }}><Reticle size={W * 0.8} /></View>
              </View>
              <Cap color={C.brass}>Identify the sky</Cap>
              <Text style={s.headline}>Which stars{"\n"}are those?</Text>
              <Text style={s.lede}>
                Add a photo of the night sky. We'll work out where it's pointing, name the constellation, and tell you the story behind it.
              </Text>

              {server === "offline" && (
                <View style={s.notice}>
                  <Text style={s.noticeText}>Can't reach the server at {API_URL}. Start the backend, then check again.</Text>
                </View>
              )}

              <View style={{ marginTop: 28 }}>
                <Btn label="Choose a photo" onPress={() => pick(false)} />
                <Btn ghost label="Take a photo" onPress={() => pick(true)} style={{ marginTop: 10 }} />
              </View>


              <Rule style={{ marginTop: 34 }} />
              {[["01", "Wide and steady beats zoomed and shaky."], ["02", "Get away from streetlights. Dark skies show more stars."], ["03", "You need roughly ten visible stars to get a match."]].map(([n, t]) => (
                <View key={n}>
                  <View style={s.tip}><Cap color={C.brass}>{n}</Cap><Text style={s.tipText}>{t}</Text></View>
                  <Rule />
                </View>
              ))}
            </Reveal>
          )}

          {/* ---------------- working */}
          {phase === "working" && image?.uri && (
            <Reveal>
              <View style={s.between}><Cap color={C.brass}>Reading the sky</Cap><Cap color={C.dim}>{clock(elapsed)}</Cap></View>
              <View style={{ alignItems: "center", marginTop: 14 }}>
                <Photo uri={image.uri} w={pw} h={ph} marks={[]} sel={null} onSel={() => {}} scanning />
              </View>
              <Cap style={s.caption}>Fig. 1 — Your photograph</Cap>

              <View style={s.log}>
                {log.slice(-5).map((l, i, arr) => (
                  <Text key={l.at + l.text} style={[s.logLine, i === arr.length - 1 ? { color: C.text } : null]}>
                    {clock(l.at)}  {l.text}{i === arr.length - 1 ? " …" : ""}
                  </Text>
                ))}
              </View>
              <Text style={s.help}>Solving can take 30 seconds or more, depending on the queue.</Text>
              <Btn ghost label="Cancel" onPress={cancel} style={{ marginTop: 18 }} />
            </Reveal>
          )}

          {/* ---------------- error */}
          {phase === "error" && (
            <Reveal>
              <Cap color={C.red} style={{ marginTop: 34 }}>Couldn't read this sky</Cap>
              <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
              <View style={{ marginTop: 22 }}>
                {image && <Btn label="Try again" onPress={() => start(image)} />}
                <Btn ghost label="Choose another photo" onPress={reset} style={{ marginTop: 10 }} />
              </View>
            </Reveal>
          )}

          {/* ---------------- done */}
          {phase === "done" && result && story && image?.uri && (
            <Reveal>
              <Cap color={C.brass} style={{ marginTop: 30 }}>Identified</Cap>
              <Text style={s.name} adjustsFontSizeToFit numberOfLines={1}>{result.constellation}</Text>
              <Text style={s.coords}>RA {hms(result.location.ra)}   DEC {dms(result.location.dec)}</Text>

              <View style={{ alignItems: "center", marginTop: 22 }}>
                <Photo uri={image.uri} w={pw} h={ph} size={result.image_size} marks={marks} sel={sel} onSel={setSel} scanning={false} />
              </View>
              <Cap style={s.caption}>
                {selStar ? `${selStar.name} — ${kind(selStar.type)}`
                  : marks.length ? `Fig. 1 — ${marks.length} named ${marks.length === 1 ? "object" : "objects"}. Tap a mark.` : "Fig. 1 — No named stars in this frame."}
              </Cap>
               <View style={{ marginTop: 38 }}>
                <Cap color={C.brass}>The story</Cap>
                {storyFailed ? (
                  <View style={[s.errorBox, { marginTop: 14 }]}><Text style={s.errorText}>The story couldn't be written this time. {result.story}</Text></View>
                ) : (
                  <>
                    {!!story.title && <Text style={s.storyTitle}>{story.title}</Text>}
                    {story.paragraphs.map((p, i) => <Text key={i} style={s.storyText}>{p}</Text>)}
                  </>
                )}
              </View>

              <View style={{ marginTop: 30 }}>
                {!storyFailed && <Btn label="Share this story" onPress={share} />}
                <Btn ghost label="New photo" onPress={reset} style={{ marginTop: 10 }} />
              </View>

              <View style={{ marginTop: 26 }}>
                <Rule />
                <Row k="Right ascension" v={hms(result.location.ra)} />
                <Row k="Declination" v={dms(result.location.dec)} />
                <Row k="Field of view" v={`${result.location.fov.toFixed(1)}°`} />
                <Row k="Rotation" v={`${result.location.roll.toFixed(0)}°`} />
              </View>

              {marks.length > 0 && (
                <View style={{ marginTop: 30 }}>
                  <Cap>In your photo</Cap>
                  <Rule style={{ marginTop: 10 }} />
                  {marks.map(({ st, i }) => (
                    <TouchableOpacity key={i} onPress={() => setSel(sel === i ? null : i)}>
                      <View style={[s.obj, sel === i && { backgroundColor: "rgba(200,165,95,0.12)" }]}>
                        <Text style={s.objName}>{st.name}</Text><Cap color={C.dim}>{kind(st.type)}</Cap>
                      </View>
                      <Rule />
                    </TouchableOpacity>
                  ))}
                  {hidden > 0 && <Text style={s.help}>+ {hidden} fainter catalog {hidden === 1 ? "star" : "stars"} not labelled.</Text>}
                </View>
              )}
            </Reveal>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------ styles
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  mast: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 12, paddingBottom: 14 },
  wordmark: { color: C.text, fontFamily: SERIF, fontSize: 22, fontStyle: "italic", letterSpacing: 0.3 },
  status: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 7 },
  cap: { color: C.dim, fontFamily: MONO, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase" },

  headline: { color: C.text, fontFamily: SERIF, fontSize: 44, lineHeight: 48, marginTop: 10, letterSpacing: -0.5 },
  lede: { color: C.dim, fontSize: 16.5, lineHeight: 25, marginTop: 16 },
  notice: { marginTop: 20, borderLeftWidth: 2, borderLeftColor: C.red, paddingLeft: 12, paddingVertical: 2 },
  noticeText: { color: C.text, fontSize: 14, lineHeight: 20 },

  btn: { alignItems: "center", justifyContent: "center", paddingVertical: 16, borderRadius: 3 },
  btnSolid: { backgroundColor: C.text },
  btnGhost: { borderWidth: 1, borderColor: "rgba(235,229,214,0.35)" },
  btnText: { color: C.bg, fontSize: 15.5, fontWeight: "600", letterSpacing: 0.2 },

  seg: { flexDirection: "row", marginTop: 10, borderWidth: HAIR, borderColor: C.line, borderRadius: 3, overflow: "hidden" },
  segItem: { flex: 1, paddingVertical: 11, alignItems: "center" },
  segText: { color: C.text, fontFamily: MONO, fontSize: 13 },
  input: { marginTop: 10, color: C.text, borderWidth: HAIR, borderColor: C.line, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, backgroundColor: C.panel },
  help: { color: C.faint, fontSize: 13, lineHeight: 19, marginTop: 10 },
  tip: { flexDirection: "row", alignItems: "baseline", paddingVertical: 14 },
  tipText: { color: C.text, fontSize: 15, lineHeight: 21, flex: 1, marginLeft: 14 },

  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 26 },
  photo: { backgroundColor: C.panel, borderWidth: HAIR, borderColor: "rgba(235,229,214,0.3)", overflow: "hidden" },
  scan: { position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: C.brass, shadowColor: C.brass, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  caption: { marginTop: 10, textTransform: "none", letterSpacing: 0.4, fontSize: 11.5 },
  mark: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: C.brass },
  markOn: { width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(200,165,95,0.3)", borderColor: C.text },
  tag: { color: C.text, fontFamily: MONO, fontSize: 10.5, paddingHorizontal: 5, paddingVertical: 2, backgroundColor: "rgba(10,14,24,0.78)", overflow: "hidden", maxWidth: 150 },

  log: { marginTop: 22, borderLeftWidth: 1, borderLeftColor: C.line, paddingLeft: 14 },
  logLine: { color: C.faint, fontFamily: MONO, fontSize: 12.5, lineHeight: 22 },

  errorBox: { marginTop: 12, borderLeftWidth: 2, borderLeftColor: C.red, paddingLeft: 14, paddingVertical: 4 },
  errorText: { color: C.text, fontSize: 15.5, lineHeight: 23 },

  name: { color: C.text, fontFamily: SERIF, fontSize: 52, lineHeight: 58, marginTop: 6, letterSpacing: -1 },
  coords: { color: C.dim, fontFamily: MONO, fontSize: 11.5, marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, borderBottomWidth: HAIR, borderBottomColor: C.line },
  rowVal: { color: C.text, fontFamily: MONO, fontSize: 13.5 },
  obj: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, paddingHorizontal: 4 },
  objName: { color: C.text, fontSize: 16, flex: 1, paddingRight: 10 },

  storyTitle: { color: C.text, fontFamily: SERIF, fontSize: 27, lineHeight: 34, fontStyle: "italic", marginTop: 14 },
  storyText: { color: "#dcd6c6", fontFamily: SERIF, fontSize: 17.5, lineHeight: 29, marginTop: 16 },
  credit: { color: C.faint, fontFamily: MONO, fontSize: 10.5, textAlign: "center", marginTop: 44, letterSpacing: 0.4 },
});