// api/build.ts — vINT-1.5 (intent router: primitive | terrain | structure | waterfall | setpiece)
export const config = { runtime: "edge" };

const MODEL = "gemini-1.5-pro-latest"; // istersen flash-latest de olur; pro daha “akıllı”
const TEMP = 0.1;
const TOK  = 700;

const SYS = [
  "You output ONLY JSON. No text. Choose an intent for a Roblox builder:",
  "- primitive: single shapes (stick, pole, pillar, plank, cube, sphere, wedge, wall, floor).",
  "- terrain: surface patches using Roblox Terrain (grass, sand, water, rock, mud, snow, ground, big water, lake, ocean).",
  "- structure: small buildings (house/shed/pavilion) -> return {plan:{...}} (footprint/wall/door/windows/roof).",
  "- waterfall: a waterfall against a rock wall -> return {waterfall:{width,height,poolDepth}}.",
  "- setpiece: themed compositions (e.g., galactic base / sci-fi base) -> return {set:{type:'galactic_base',scale:'small|medium|large'}}.",
  "Always include minimal numeric params. Stud units. Keep sizes reasonable."
].join("\n");

// few-shots
const EXS = [
  { role:"user",  parts:[{ text:"stick" }] },
  { role:"model", parts:[{ text: JSON.stringify({ intent:"primitive", shape:"cylinder", size:[1,6,1], yaw:0, material:"wood", color:"#C08A55" }) }] },

  { role:"user",  parts:[{ text:"add big water" }] },
  { role:"model", parts:[{ text: JSON.stringify({ intent:"terrain", material:"water", size:[60,6,60], group:"big_water" }) }] },

  { role:"user",  parts:[{ text:"waterfall" }] },
  { role:"model", parts:[{ text: JSON.stringify({ intent:"waterfall", waterfall:{ width:24, height:20, poolDepth:4 } }) }] },

  { role:"user",  parts:[{ text:"galactic base" }] },
  { role:"model", parts:[{ text: JSON.stringify({ intent:"setpiece", set:{ type:"galactic_base", scale:"large" } }) }] },

  { role:"user",  parts:[{ text:"small white house with flat roof and many windows" }] },
  { role:"model", parts:[{ text: JSON.stringify({
      intent:"structure",
      plan:{
        kind:"house",
        floors:1,
        footprint:{ width:18, depth:14 },
        wall:{ height:8, thickness:0.6, material:"smoothplastic", color:"#EDEDED" },
        door:{ wall:"front", width:3, height:6.5, offset:0 },
        windows:[{ wall:"front", bottom:3, height:2.5, width:2.2, count:4, spacing:3, offset:0 }],
        roof:{ type:"flat", height:1, overhang:1, material:"concrete", color:"#D0D0D0" },
        palette:{ glass:"#88BFFF" }
      }
  }) }] }
];

async function genIntent(prompt: string) {
  const key = (process.env as any).GEMINI_API_KEY;
  if (!key) return { ok:false, status:500, body:{ reason:"NO_KEY" } };

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { role:"system", parts:[{ text: SYS }] },
    contents: [ ...EXS, { role:"user", parts:[{ text: prompt }] } ],
    generationConfig: {
      temperature: TEMP,
      max_output_tokens: TOK,
      response_mime_type: "application/json"
    }
  };

  const r   = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) return { ok:false, status:r.status, body:{ reason:"GEMINI_FAIL", detail: txt.slice(0,400) } };

  let j:any=null; try { j = JSON.parse(txt) } catch {}
  const jsonText = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) return { ok:false, status:200, body:{ reason:"NO_TEXT" } };

  let data:any=null; try { data = JSON.parse(jsonText) } catch {}
  if (!data || !data.intent) return { ok:false, status:200, body:{ reason:"BAD_JSON", detail: jsonText.slice(0,400) } };

  // gentle clamps
  if (Array.isArray(data.size)) {
    data.size = [
      Math.max(1, Math.min(200, Number(data.size[0] || 20))),
      Math.max(1, Math.min(60,  Number(data.size[1] || 2))),
      Math.max(1, Math.min(200, Number(data.size[2] || 20)))
    ];
  }
  if (data.waterfall) {
    data.waterfall.width     = Math.max(6,  Math.min(120, Number(data.waterfall.width || 24)));
    data.waterfall.height    = Math.max(8,  Math.min(80,  Number(data.waterfall.height || 20)));
    data.waterfall.poolDepth = Math.max(2,  Math.min(12, Number(data.waterfall.poolDepth || 4)));
  }
  if (data.plan) {
    const p = data.plan;
    p.floors = Math.max(1, Math.min(3, Number(p.floors || 1)));
    p.footprint = { width: Math.max(8, Math.min(60, Number(p?.footprint?.width || 18))),
                    depth: Math.max(8, Math.min(60, Number(p?.footprint?.depth || 14))) };
    const wh = Math.max(4, Math.min(16, Number(p?.wall?.height || 8)));
    const wt = Math.max(0.3, Math.min(1.5, Number(p?.wall?.thickness || 0.6)));
    p.wall = { height: wh, thickness: wt, material: String(p?.wall?.material || "smoothplastic"), color: String(p?.wall?.color || "#EDEDED") };
    p.roof = p.roof || { type:"flat", height:1, overhang:1, material:"concrete", color:"#D0D0D0" };
    p.door = p.door || { wall:"front", width:3, height:6, offset:0 };
    p.windows = Array.isArray(p.windows) ? p.windows : [];
  }

  return { ok:true, status:200, body:data };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    const hasKey = Boolean((process.env as any).GEMINI_API_KEY);
    return new Response(JSON.stringify({ ok:true, env:{ GEMINI_API_KEY: hasKey }, version:"vINT-1.5", runtime:"edge" }), {
      status:200, headers:{ "Content-Type":"application/json" }
    });
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0,400).trim();
    if (!prompt) return new Response(JSON.stringify({ reason:"EMPTY" }), { status:200, headers:{ "Content-Type":"application/json" } });
    const { ok, status, body } = await genIntent(prompt);
    return new Response(JSON.stringify(body), { status: ok ? 200 : status, headers:{ "Content-Type":"application/json" } });
  } catch (e:any) {
    return new Response(JSON.stringify({ reason:"exception", detail:String(e?.stack || e) }), { status:200, headers:{ "Content-Type":"application/json" } });
  }
};
