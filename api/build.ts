// /api/build.ts — vG-MEGA-3.1
// Wikipedia-powered open vocabulary + seed-driven variety + LLM fallback.
// Runtime: Edge (Vercel). 100% JSON output. CORS enabled.

export const config = { runtime: "edge" };

const GEMINI_MODEL = (process.env as any).GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_KEY   = (process.env as any).GEMINI_API_KEY || "";
const LLM_TEMP     = 0.25;
const LLM_TOK      = 900;

// ---------- utils ----------
function clamp(n: number, a: number, b: number) { n = Number(n || 0); return Math.max(a, Math.min(b, n)); }
function hash32(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function rngSeed(seedStr: string) {
  let s = hash32(seedStr) || 1;
  return () => {
    // Xorshift32
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
function pick<T>(rand: () => number, arr: T[]) { return arr[Math.max(0, Math.min(arr.length - 1, Math.floor(rand() * arr.length)))]; }
function withCORS(json: any, status = 200) {
  return new Response(JSON.stringify(json), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }
  });
}

// ---------- Wikipedia helpers ----------
async function wikiSearch(lang: string, q: string) {
  const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=1`;
  const r = await fetch(url, { method: "GET" });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const hit = j?.pages?.[0];
  return hit?.title || null;
}
async function wikiSummary(lang: string, title: string) {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const r = await fetch(url, { method: "GET" });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j) return null;
  return {
    title: j.title,
    desc: j.description || "",
    extract: j.extract || "",
    lang,
  };
}

// Try TR, EN fallback:
async function wikiLookup(q: string) {
  const langs = ["tr", "en"];
  for (const lang of langs) {
    const t = await wikiSearch(lang, q);
    if (t) {
      const s = await wikiSummary(lang, t);
      if (s) return s;
    }
  }
  return null;
}

// ---------- naive classifier from text ----------
type Cat =
  | "food" | "building" | "vehicle" | "animal" | "plant"
  | "tool" | "natural" | "structure_piece" | "symbolic" | "unknown";

function classify(text: string): Cat {
  const t = (text || "").toLowerCase();
  const has = (...k: string[]) => k.some(w => t.includes(w));
  if (has("food", "dish", "yemek", "burger", "pizza", "sandwich", "cake")) return "food";
  if (has("animal", "species", "animalia", "hayvan", "cat", "dog", "whale")) return "animal";
  if (has("tree", "plant", "flora", "bitki", "ağaç", "agac", "oak", "pine", "palm")) return "plant";
  if (has("vehicle", "car", "ship", "submarine", "tank", "plane", "aircraft", "arac")) return "vehicle";
  if (has("building", "architecture", "structure", "mimari", "igloo", "pagoda", "pavilion", "house", "ev")) return "building";
  if (has("waterfall", "volcano", "mountain", "river", "nehir", "dogal", "doğal")) return "natural";
  if (has("stairs", "basamak", "merdiven", "arch", "dome", "vault")) return "structure_piece";
  if (has("tool", "chair", "lamp", "ladder", "hammer", "tool", "arac gerec")) return "tool";
  if (has("logo", "symbol", "flag", "bayrak", "emblem")) return "symbolic";
  return "unknown";
}

// ---------- synthesis to our schema ----------
// Our contract: return either {intent: ...} OR {actions: [...]}

type Action =
  | { type: "PLACE_PRIMITIVE" | "PLACE_BLOCK" | "PLACE_PART"; shape?: "block"|"cylinder"|"sphere"|"wedge"; size: number[]; pos?: number[]; yaw?: number; color?: string; material?: string; }
  | { type: "PLACE_TERRAIN"; material: string; size: number[]; pos?: number[]; };

function matOf(cat: Cat) {
  if (cat==="food") return "smoothplastic";
  if (cat==="building" || cat==="structure_piece") return "concrete";
  if (cat==="natural" || cat==="plant") return "rock";
  return "smoothplastic";
}

function synthFood(q: string, rand: () => number): Action[] {
  // burger/sandwich/pizza etc. Use layered disks/plates.
  const base = rand() < 0.5 ? "burger" : (q.toLowerCase().includes("pizza") ? "pizza" : "burger");
  if (base === "pizza") {
    const r = clamp(8 + rand()*6, 8, 16);
    return [
      { type:"PLACE_PRIMITIVE", shape:"cylinder", size:[r*2,0.6,r*2], color:"#F5D6A1", material:"smoothplastic" }, // dough
      { type:"PLACE_PRIMITIVE", shape:"cylinder", size:[r*1.8,0.2,r*1.8], color:"#C43E2F", material:"smoothplastic", pos:[0,0.4,0] }, // sauce
      { type:"PLACE_PRIMITIVE", shape:"cylinder", size:[r*1.7,0.2,r*1.7], color:"#F6E27A", material:"smoothplastic", pos:[0,0.6,0] }, // cheese
    ];
  }
  // burger
  const d = clamp(8 + rand()*6, 8, 16);
  const h = 0.7;
  return [
    { type:"PLACE_PRIMITIVE", shape:"cylinder", size:[d, h, d], color:"#E6C07B", material:"smoothplastic", pos:[0,0,0] }, // bun bottom
    { type:"PLACE_PRIMITIVE", shape:"cylinder", size:[d*0.9, h*0.6, d*0.9], color:"#4A2E1E", material:"smoothplastic", pos:[0,h*0.6,0] }, // patty
    { type:"PLACE_PRIMITIVE", shape:"block",    size:[d*0.9, 0.2, d*0.9], color:"#F6E27A", material:"smoothplastic", pos:[0,h*0.9,0], yaw: rand()*180 }, // cheese
    { type:"PLACE_PRIMITIVE", shape:"block",    size:[d*0.9, 0.15, d*0.9], color:"#2FA64A", material:"smoothplastic", pos:[0,h*1.1,0] }, // lettuce
    { type:"PLACE_PRIMITIVE", shape:"cylinder", size:[d*1.02, h, d*1.02], color:"#E6C07B", material:"smoothplastic", pos:[0,h*1.8,0] }, // bun top
  ];
}

function synthStairs(rand: () => number): Action[] {
  const steps = Math.floor(8 + rand()*8); // 8..16
  const width = 6 + Math.floor(rand()*6); // 6..11
  const height = 6 + Math.floor(rand()*8); // 6..13
  const rise = height / steps;
  const run = 1.4 + rand()*0.6;
  const acts: Action[] = [];
  for (let i=1;i<=steps;i++){
    const y = i*rise - rise/2;
    const z = i*run - run/2;
    acts.push({ type:"PLACE_PART", shape:"wedge", size:[width, rise, run], pos:[0,y,z], color:"#D0D0D0", material:"concrete" });
  }
  return acts;
}

function synthFootprints(rand: () => number): Action[] {
  // two small ellipses repeated forward
  const steps = 10 + Math.floor(rand()*8);
  const stepL = 2.2 + rand()*0.6;
  const gap = 1.4 + rand()*0.4;
  const acts: Action[] = [];
  for (let i=0;i<steps;i++){
    const z = i*(gap+0.4);
    const off = (i%2===0)? -0.8 : 0.8;
    acts.push({ type:"PLACE_PRIMITIVE", shape:"cylinder", size:[0.9,0.1,1.3], pos:[off,0.05,z], color:"#5A4A3A", material:"ground" });
    acts.push({ type:"PLACE_PRIMITIVE", shape:"cylinder", size:[0.5,0.1,0.7], pos:[off,0.05,z+0.6], color:"#5A4A3A", material:"ground" });
  }
  return acts;
}

function synthTree(rand: () => number): Action[] {
  const style = pick(rand, ["oak","pine","palm","birch","willow","cactus"]);
  const acts: Action[] = [];
  if (style==="palm"){
    acts.push({ type:"PLACE_PRIMITIVE", shape:"cylinder", size:[1.2, 12, 1.2], color:"#8B5A2B", material:"woodplanks", pos:[0,6,0] });
    for (let i=0;i<6;i++){
      const yaw = i*(360/6);
      acts.push({ type:"PLACE_PRIMITIVE", shape:"wedge", size:[6,0.5,2], color:"#2BA84A", material:"plastic", pos:[0,12,0], yaw });
    }
  } else if (style==="pine"){
    acts.push({ type:"PLACE_PRIMITIVE", shape:"cylinder", size:[1.2, 8, 1.2], color:"#8B5A2B", material:"woodplanks", pos:[0,4,0] });
    acts.push({ type:"PLACE_PRIMITIVE", shape:"cone" as any, size:[8,10,8], color:"#2BA84A", material:"plastic", pos:[0,10,0] }); // cone will map to wedge stack on Roblox side if not supported
  } else if (style==="cactus"){
    acts.push({ type:"PLACE_PRIMITIVE", shape:"cylinder", size:[2,10,2], color:"#2BA84A", material:"plastic", pos:[0,5,0] });
    acts.push({ type:"PLACE_PRIMITIVE", shape:"cylinder", size:[1.2,5,1.2], color:"#2BA84A", material:"plastic", pos:[-1,7,0], yaw:90 });
    acts.push({ type:"PLACE_PRIMITIVE", shape:"cylinder", size:[1.2,5,1.2], color:"#2BA84A", material:"plastic", pos:[ 1,6,0], yaw:90 });
  } else {
    // oak/birch/willow
    const trunkH = 6 + rand()*6;
    acts.push({ type:"PLACE_PRIMITIVE", shape:"cylinder", size:[1.3,trunkH,1.3], color:"#8B5A2B", material:"woodplanks", pos:[0,trunkH/2,0] });
    acts.push({ type:"PLACE_PRIMITIVE", shape:"sphere",   size:[6,6,6], color:"#2BA84A", material:"plastic", pos:[0,trunkH+2,0] });
  }
  return acts;
}

function synthFromCategory(cat: Cat, q: string, rand: () => number) {
  // Produce either intent or actions
  if (cat === "food") return { actions: synthFood(q, rand) };
  if (cat === "structure_piece") {
    if (q.toLowerCase().includes("stairs") || q.toLowerCase().includes("merdiven") || q.toLowerCase().includes("basamak"))
      return { actions: synthStairs(rand) };
    if (q.toLowerCase().includes("arch")) return {
      intent: { set: { type:"arch", scale:"small" }, intent:"setpiece" }
    };
    return { actions: synthStairs(rand) };
  }
  if (cat === "plant") return { actions: synthTree(rand) };
  if (cat === "building") {
    // minimal house plan; Roblox will randomize further
    const floors = (rand() < 0.5) ? 1 : 2;
    const w = 14 + Math.floor(rand()*10);
    const d = 10 + Math.floor(rand()*8);
    return {
      intent: {
        intent: "structure",
        plan: {
          kind: "house",
          floors,
          footprint: { width: w, depth: d },
          wall: { height: floors===2 ? 10 : 8, thickness: 0.6, material: "smoothplastic", color: "#EDEDED" },
          door: { wall: "front", width: 3, height: 6, offset: 0 },
          windows: [
            { wall:"front",  count:3, width:2.4, height:3, bottom:3, spacing:4, offset:0 },
            { wall:"left",   count:2, width:2.0, height:2.5, bottom:3, spacing:4, offset:0 },
            { wall:"right",  count:2, width:2.0, height:2.5, bottom:3, spacing:4, offset:0 },
          ],
          roof: { type: (rand()<0.5?"gable":"flat"), height: (floors===2?3:2), overhang: 1, material: "concrete", color:"#D0D0D0" }
        }
      }
    };
  }
  if (cat === "natural") {
    if (q.toLowerCase().includes("waterfall"))
      return { intent: { intent:"waterfall", waterfall:{ width: 24, height: 20, poolDepth: 4 } } };
    // generic rock patch
    return { actions: [{ type:"PLACE_TERRAIN", material:"rock", size:[24,3,24] }] };
  }
  if (cat === "tool") {
    // chair/ladder as props; let Roblox handle furniture by keyword too.
    return { actions: [
      { type:"PLACE_PRIMITIVE", shape:"block", size:[2,0.4,2], color:"#C8A57A", material:"wood", pos:[0,1,0] },
      { type:"PLACE_PRIMITIVE", shape:"block", size:[2,2,0.3], color:"#C8A57A", material:"wood", pos:[0,2,-0.85] },
    ]};
  }
  if (cat === "symbolic") {
    // text plate
    return { actions: [
      { type:"PLACE_PRIMITIVE", shape:"block", size:[12,0.6,1], color:"#333333", material:"metal" },
      { type:"PLACE_PRIMITIVE", shape:"block", size:[10.5,0.2,0.4], color:"#EEEEEE", material:"smoothplastic", pos:[0,0.41,0.1] }
    ]};
  }
  // unknown -> footprints or abstract sculpture to never be empty
  if (q.toLowerCase().includes("feet") || q.toLowerCase().includes("foot"))
    return { actions: synthFootprints(rand) };
  // abstract sculpture
  const s = 6 + rand()*10;
  return { actions: [
    { type:"PLACE_PRIMITIVE", shape:"sphere", size:[s, s, s], color:"#66CCFF", material:"neon" },
    { type:"PLACE_PRIMITIVE", shape:"cylinder", size:[s*0.4, s*1.6, s*0.4], color:"#BBBBBB", material:"metal", pos:[-s*0.2,s*0.8,0], yaw: rand()*180 }
  ]};
}

// ---------- LLM fallback (optional) ----------
async function llmIntent(prompt: string, seed: string) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const SYS = [
    "You output ONLY JSON. No extra text.",
    "Use the given SEED to decide among multiple valid styles so that identical prompts vary across calls.",
    "Return either {intent:...} or {actions:[...]} in the game schema.",
    "Schema: primitive/terrain/structure/furniture/lights/waterfall/setpiece, or actions (PLACE_PRIMITIVE/PLACE_TERRAIN)."
  ].join("\n");
  const contents = [
    { role:"user",  parts:[{text: SYS}] },
    { role:"model", parts:[{text: "OK"}] },
    { role:"user",  parts:[{text: `[SEED:${seed}] ${prompt}`}] }
  ];
  const body = { contents, generationConfig: { temperature: LLM_TEMP, maxOutputTokens: LLM_TOK, responseMimeType: "application/json" } };
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  let j: any = null; try { j = JSON.parse(txt); } catch {}
  const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------- main handler ----------
export default async (req: Request) => {
  if (req.method === "OPTIONS") return withCORS({ ok:true });

  if (req.method !== "POST") {
    return withCORS({ ok:true, version:"vG-MEGA-3.1", wiki:true, llm: Boolean(GEMINI_KEY), model:GEMINI_MODEL });
  }

  try {
    const { obs } = await req.json();
    const prompt: string = String(obs?.prompt || "").slice(0, 600).trim();
    const seedIn: string = String(obs?.seed || "");
    const seed = seedIn || `${Date.now()}-${Math.random()}`;
    const rand = rngSeed(seed + "|" + prompt);

    if (!prompt) return withCORS({ reason:"EMPTY" });

    // 1) Wikipedia path
    const wiki = await wikiLookup(prompt);
    if (wiki) {
      const cat = classify(`${wiki.title} ${wiki.desc} ${wiki.extract}`);
      const synth = synthFromCategory(cat, prompt, rand);
      // Always clamp ranges for terrain size:
      if ((synth as any)?.actions) {
        for (const a of (synth as any).actions as Action[]) {
          if ((a as any).size) {
            a.size = [
              clamp((a as any).size[0], 1, 250),
              clamp((a as any).size[1], 1, 120),
              clamp((a as any).size[2], 1, 250),
            ];
          }
        }
      }
      return withCORS({ ...synth, seed, from:"wiki", title: wiki.title, lang: wiki.lang });
    }

    // 2) LLM fallback
    const llm = await llmIntent(prompt, seed);
    if (llm && (llm.intent || llm.actions)) {
      return withCORS({ ...llm, seed, from:"llm" });
    }

    // 3) final synth (never empty)
    const finalSynth = synthFromCategory("unknown", prompt, rand);
    return withCORS({ ...finalSynth, seed, from:"synth" });

  } catch (e: any) {
    return withCORS({ reason:"exception", detail:String(e?.stack || e) }, 200);
  }
};
