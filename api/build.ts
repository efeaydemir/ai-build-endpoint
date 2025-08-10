// api/build.ts — v7: program + ROBLOX TOOLBOX SEARCH + offset server-side
export const config = { runtime: "edge" };

const MODEL = "llama-3.1-8b-instant";

const SYSTEM = `
Return STRICT JSON program for a Roblox builder.
Allowed ops:
PLAZA{size,color}, ROADGRID{w,h,gap,width}, RIVER{length,width}, BRIDGE{length,width,arch},
TOWER{floors,radius}, PYRAMID{base,levels}, DOME{radius}, HOUSES{rows,cols,minH,maxH},
TREES{count,ringR}, LINE{from:[x,z],to:[x,z],width,height,block,color},
RING{r,height,step,block,color}, DISC{r,thickness,block,color}, SPIRAL{r,turns,step,height,block,color},
MODEL{key,pos:[x,y,z],yaw}, ASSET{assetId|url,pos:[x,y,z],yaw}, LABEL{text}
Return ONLY:
{"label":"2-3 words","palette":["#RRGGBB","#RRGGBB","#RRGGBB"],"program":[ ...<=20 steps... ]}
Keep it coherent & small. No prose.
`;

const clamp = (n:number, lo:number, hi:number)=>Math.max(lo, Math.min(hi, n));
const palDefault = ["#D0D0D0","#8A8FFF","#6CE1FF"];
const safeColor = (s?:string)=> /^#?[0-9a-fA-F]{6}$/.test(String(s||"")) ? (s![0]==="#"?s:"#"+s) : "#D0D0D0";
const MAX_ACTIONS = 400;

function extractAssetIdsFromPrompt(p:string): number[] {
  const ids = new Set<number>();
  const rx = /\b(?:rbxassetid:\/\/|https?:\/\/www\.roblox\.com\/(?:library|catalog)\/)?(\d{6,14})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(p)) !== null) { const id = Number(m[1]); if (id) ids.add(id); }
  return Array.from(ids).slice(0, 12);
}

async function searchToolbox(keyword:string): Promise<number[]> {
  const k = encodeURIComponent(keyword.trim());
  const ids: number[] = [];
  // resmi katalog araması
  try {
    const r = await fetch(`https://catalog.roblox.com/v1/search/items/details?Category=Models&Limit=6&Keyword=${k}`);
    if (r.ok) {
      const j:any = await r.json();
      const arr = Array.isArray(j.data)? j.data: [];
      for (const it of arr) if (it && it.id) ids.push(Number(it.id));
    }
  } catch {}
  // eski fallback (bazı bölgelerde çalışır)
  if (ids.length === 0) {
    try {
      const r = await fetch(`https://search.roblox.com/catalog/json?Category=Models&Keyword=${k}`);
      if (r.ok) {
        const arr:any[] = await r.json();
        for (const it of (arr||[])) if (it and it.AssetId) ids.push(Number(it.AssetId));
      }
    } catch {}
  }
  return ids.slice(0, 6);
}

type Act = { type:string; [k:string]:any };

function expand(program:any[], palette:string[]) {
  const acts:Act[] = [];
  const pal = palette?.length?palette:palDefault;

  const addPlaza=(size:number,color?:string)=>{
    const c = safeColor(color||pal[0]);
    acts.push({type:"PLACE_BLOCK", block:"Concrete", pos:[0,1,0], size:[size,1,size], color:c});
    const k=size/2-2;
    for (const [x,z] of [[k,k],[-k,k],[k,-k],[-k,-k]] as const)
      acts.push({type:"PLACE_MODEL", key:"StreetLamp", pos:[x,1,z], yaw:0});
  };
  const addRoadGrid=(w:number,h:number,gap:number,width:number)=>{
    for (let x=-w; x<=w; x+=gap) acts.push({type:"PLACE_BLOCK", block:"Slate", pos:[x,1,0], size:[width,0.4,h*2+width], color:pal[2]});
    for (let z=-h; z<=h; z+=gap) acts.push({type:"PLACE_BLOCK", block:"Slate", pos:[0,1,z], size:[w*2+width,0.4,width], color:pal[2]});
  };
  // (diğer op genişleticileri kısaltılmış – önceki sürümlerdekiyle aynı RING, DISC, SPIRAL, TOWER, PYRAMID, DOME, HOUSES, TREES, RIVER, BRIDGE, LINE)
  const addRing=(r:number,h:number,step:number,block:string,color?:string)=>{ const c=Math.max(6,Math.floor((Math.PI*2*r)/Math.max(1,step))); for(let i=0;i<c;i++){ const a=(i/c)*Math.PI*2,x=Math.cos(a)*r,z=Math.sin(a)*r; acts.push({type:"PLACE_BLOCK",block:block||"Neon",pos:[x,h||1,z],size:[2,2,2],color:safeColor(color||pal[1])}); if(acts.length>MAX_ACTIONS)break; } };
  const addDisc=(r:number,t:number,block:string,color?:string)=>{ const s=2; for(let x=-r;x<=r;x+=s){ for(let z=-r;z<=r;z+=s){ if(x*x+z*z<=r*r){ acts.push({type:"PLACE_BLOCK",block:block||"Concrete",pos:[x,1,z],size:[s,t||1,s],color:safeColor(color||pal[0])}); if(acts.length>MAX_ACTIONS)break; } } if(acts.length>MAX_ACTIONS)break; } };
  const addSpiral=(r:number,tr:number,step:number,h:number,block:string,color?:string)=>{ const tot=Math.max(12,Math.floor(tr*360/Math.max(1,step))); for(let i=0;i<=tot;i++){ const t=i/tot,ang=t*tr*Math.PI*2,rr=r*t,x=Math.cos(ang)*rr,z=Math.sin(ang)*rr,y=1+(h||0)*t; acts.push({type:"PLACE_BLOCK",block:block||"Neon",pos:[x,y,z],size:[2,2,2],color:safeColor(color||pal[1])}); if(acts.length>MAX_ACTIONS)break; } };
  const addTower=(flo:number,rad:number)=>{ for(let f=1;f<=flo;f++){ const y=f*2,cnt=24; for(let i=0;i<cnt;i++){ const a=(i/cnt)*Math.PI*2,x=Math.cos(a)*rad,z=Math.sin(a)*rad; acts.push({type:"PLACE_BLOCK",block:"Neon",pos:[x,y,z],size:[2,2,2],color:pal[1]}); } acts.push({type:"PLACE_BLOCK",block:"Neon",pos:[0,y+1,0],size:[2,2,2],color:pal[2]}); } };
  const addPyramid=(b:number,lv:number)=>{ let s=b; for(let i=0;i<lv;i++){ acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[0,1+i,0],size:[s,1,s],color:"#C2B280"}); s-=2; if(s<=2)break; } };
  const addDome=(r:number)=>{ addRing(r,2,3,"Neon",pal[1]); addRing(Math.max(2,r-3),4,3,"Neon",pal[2]); };
  const addHouses=(rows:number,cols:number,minH:number,maxH:number)=>{ const sp=6,sx=-((cols-1)*sp)/2,sz=12; for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){ const h=Math.round(Math.max(1,Math.min(4,minH))+(c%2)*(Math.max(2,Math.min(8,maxH))-Math.max(1,Math.min(4,minH)))); const x=sx+c*sp,z=sz+r*sp; acts.push({type:"PLACE_BLOCK",block:"SmoothPlastic",pos:[x,1,z],size:[4,h,4],color:pal[0]}); acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[x,h+1,z],size:[4,1,4],color:"#6B4F2A"}); if(acts.length>MAX_ACTIONS)break; } };
  const addTrees=(count:number,ringR:number)=>{ for(let i=0;i<count;i++){ const a=(i/count)*Math.PI*2,x=Math.cos(a)*ringR,z=Math.sin(a)*ringR; acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[x,1,z],size:[1,3,1],color:"#6B4F2A"}); acts.push({type:"PLACE_BLOCK",block:"Grass",pos:[x,3.5,z],size:[3,3,3],color:"#3BAA3B"}); if(acts.length>MAX_ACTIONS)break; } };
  const addRiver=(len:number,w:number)=>{ acts.push({type:"TERRAIN_BOX",material:"Grass",min:[-len/2,0,-w/2],max:[len/2,0.2,w/2]}); };
  const addBridge=(len:number,w:number,arch:number)=>{ for(let x=-Math.floor(len/2);x<=Math.floor(len/2);x+=2){ const y=Math.max(1,Math.round(Math.sin((x/len)*Math.PI)*arch)+1); acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[x,y,0],size:[2,1,w],color:pal[0]}); if(acts.length>MAX_ACTIONS)break; } };

  for (const s of (program||[])) {
    if (acts.length > MAX_ACTIONS) break;
    switch (s.op) {
      case "PLAZA": addPlaza(clamp(s.size??16,12,30), s.color); break;
      case "ROADGRID": addRoadGrid(clamp(s.w??20,10,40), clamp(s.h??20,10,40), clamp(s.gap??8,6,20), clamp(s.width??2,2,6)); break;
      case "RIVER": addRiver(clamp(s.length??40,20,80), clamp(s.width??8,3,14)); break;
      case "BRIDGE": addBridge(clamp(s.length??12,6,24), clamp(s.width??3,2,6), clamp(s.arch??2,0,6)); break;
      case "TOWER": addTower(clamp(s.floors??3,1,8), clamp(s.radius??4,2,10)); break;
      case "PYRAMID": addPyramid(clamp(s.base??16,8,32), clamp(s.levels??6,3,12)); break;
      case "DOME": addDome(clamp(s.radius??6,4,14)); break;
      case "HOUSES": addHouses(clamp(s.rows??2,1,3), clamp(s.cols??4,2,8), clamp(s.minH??2,1,4), clamp(s.maxH??4,2,8)); break;
      case "TREES": addTrees(clamp(s.count??16,6,60), clamp(s.ringR??14,8,30)); break;
      case "LINE": // from:[x,z], to:[x,z]
        { const p1=s.from||[0,0], p2=s.to||[10,0]; const w=clamp(s.width??2,1,8), h=clamp(s.height??1,1,8); const b=s.block||"Slate";
          const dx=p2[0]-p1[0], dz=p2[1]-p1[1]; const len=Math.max(1,Math.floor(Math.sqrt(dx*dx+dz*dz))); const steps=Math.ceil(len/2);
          for (let i=0;i<=steps;i++){ const t=i/steps, x=p1[0]+dx*t, z=p1[1]+dz*t; acts.push({type:"PLACE_BLOCK",block:b,pos:[x,1,z],size:[w,h,w],color:safeColor(s.color||pal[1])}); if(acts.length>MAX_ACTIONS)break; }
        } break;
      case "RING": { const c=Math.max(6,Math.floor((Math.PI*2*(s.r||8))/Math.max(1,s.step||3))); for(let i=0;i<c;i++){ const a=(i/c)*Math.PI*2,x=Math.cos(a)*(s.r||8),z=Math.sin(a)*(s.r||8); acts.push({type:"PLACE_BLOCK",block:s.block||"Neon",pos:[x,s.height||1,z],size:[2,2,2],color:safeColor(s.color||pal[1])}); if(acts.length>MAX_ACTIONS)break; } } break;
      case "DISC": addDisc(clamp(s.r??8,2,30), clamp(s.thickness??1,1,6), s.block||"Concrete", s.color); break;
      case "SPIRAL": addSpiral(clamp(s.r??10,4,40), clamp(s.turns??2,1,6), clamp(s.step??6,2,20), clamp(s.height??8,0,40), s.block||"Neon", s.color); break;
      case "MODEL": acts.push({type:"PLACE_MODEL", key:String(s.key||"StreetLamp"), pos:Array.isArray(s.pos)?s.pos:[0,1,0], yaw:Math.floor(Number(s.yaw||0))}); break;
      case "ASSET": acts.push({type:"PLACE_ASSET", assetId: s.assetId ?? s.url, pos:Array.isArray(s.pos)?s.pos:[0,1,0], yaw:Math.floor(Number(s.yaw||0))}); break;
      case "LABEL": acts.push({type:"LABEL", text:String(s.text||"AI World"), pos:[0,5,0]}); break;
    }
  }
  return acts;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ok:true,msg:"POST { obs:{ prompt:'...' } } bekleniyor"}), { status:200, headers:{"Content-Type":"application/json"}});
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0, 250);

    // 1) LLM'den küçük program
    let plan:any = { label:"AI World", palette: palDefault, program:[] };
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method:"POST",
        headers:{ "Authorization":`Bearer ${process.env.GROQ_API_KEY!}`, "Content-Type":"application/json" },
        body: JSON.stringify({ model: MODEL, temperature: 0.25, response_format:{ type:"json_object" }, messages:[
          {role:"system", content: SYSTEM},
          {role:"user", content: prompt }
        ]})
      });
      if (r.ok) { const j = await r.json(); plan = JSON.parse(j.choices?.[0]?.message?.content || "{}"); }
    } catch {}

    let program:any[] = Array.isArray(plan.program) ? plan.program.slice(0,20) : [];
    const palette = Array.isArray(plan.palette)&&plan.palette.length ? plan.palette : palDefault;
    const label = typeof plan.label === "string" ? plan.label.slice(0,24) : "AI World";

    // 2) Prompt kısa bir kelimeyse (ör. "stone"), Toolbox'tan ara ve ekle
    const words = prompt.trim().split(/\s+/);
    const likelyKeyword = words.length <= 3 ? prompt.trim() : ""; // kısa istekleri arama kabul et
    if (likelyKeyword.length >= 3) {
      const found = await searchToolbox(likelyKeyword);
      if (found.length) {
        const gap = 10; const baseY = 1;
        for (let i=0;i<Math.min(6, found.length); i++){
          const col = i % 3, row = Math.floor(i/3);
          program.push({ op:"ASSET", assetId: found[i], pos:[(col-1)*gap, baseY, 12 + row*gap], yaw:0 });
        }
      }
    }

    // 3) Actions
    const actions = expand(program, palette);
    actions.push({ type:"LABEL", text: label, pos:[0,5,0] });

    return new Response(JSON.stringify({ actions, reason:"v7 program+toolbox" }), { status:200, headers:{"Content-Type":"application/json"}});
  } catch (e:any) {
    return new Response(JSON.stringify({ actions:[{type:"LABEL",text:"AI error",pos:[0,4,0]}], reason:"exception", detail:String(e)}), { status:200, headers:{"Content-Type":"application/json"}});
  }
};
