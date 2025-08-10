// api/build.ts — v3: DSL + few-shot + clamp
export const config = { runtime: "edge" };

const MODEL = "llama-3.1-8b-instant";

/** Sıkı yönerge + örnekler (few-shot) */
const SYSTEM = `
You write a STRICT JSON "program" for a Roblox builder.
Allowed blocks (OPs): PLAZA, ROADS, RIVER, GATE, HOUSES, TREES, TOWER, PYRAMID, DOME, BRIDGE, LABEL.
Return ONLY:
{
  "program":[
    {"op":"PLAZA","size":16,"color":"#D0D0D0"},
    {"op":"ROADS","w":20,"h":20,"gap":8,"width":2},
    {"op":"TOWER","floors":3,"radius":4}
  ],
  "label":"2-3 words",
  "palette":["#RRGGBB","#RRGGBB","#RRGGBB"]
}
No prose. No extra keys. Keep counts small.

Examples:

USER: "orta çağ kalesi kapısı"
PROGRAM: {"program":[
  {"op":"PLAZA","size":18,"color":"#C2B280"},
  {"op":"GATE","width":10,"height":9,"thickness":2},
  {"op":"TOWER","floors":4,"radius":5},
  {"op":"ROADS","w":22,"h":18,"gap":8,"width":2}
],"label":"Old Gate","palette":["#C2B280","#8A7B66","#6B6B6B"]}

USER: "doğa parkı, nehir ve köprü"
PROGRAM: {"program":[
  {"op":"PLAZA","size":16,"color":"#98C379"},
  {"op":"RIVER","length":40,"width":5},
  {"op":"BRIDGE","length":10,"width":3,"arch":2},
  {"op":"TREES","count":18,"ringR":14}
],"label":"Green Park","palette":["#98C379","#2C6E49","#6B8E23"]}

USER: "uzay temalı şehir"
PROGRAM: {"program":[
  {"op":"PLAZA","size":18,"color":"#2D2F5F"},
  {"op":"ROADS","w":22,"h":18,"gap":8,"width":2},
  {"op":"TOWER","floors":3,"radius":4},
  {"op":"DOME","radius":6}
],"label":"Lunar Plaza","palette":["#2D2F5F","#7F89FF","#6CE1FF"]}
`;

const clamp = (n:number, lo:number, hi:number)=>Math.max(lo, Math.min(hi, n));
const palDefault = ["#D0D0D0","#8A8FFF","#6CE1FF"];

function safeColor(s?:string){ 
  if(!s) return "#D0D0D0";
  const m = /^#?[0-9a-fA-F]{6}$/.exec(s); 
  return m ? (s.startsWith("#")?s:"#"+s) : "#D0D0D0";
}

type Act = { type:string; [k:string]:any };

function expand(program:any[], palette:string[]) {
  const acts:Act[] = [];
  const pal = palette?.length?palette:palDefault;

  // PLAZA
  const addPlaza=(size:number,color:string)=>{
    acts.push({type:"PLACE_BLOCK",block:"Concrete",pos:[0,1,0],size:[size,1,size],color:safeColor(color||pal[0])});
    const k=size/2-2;
    for(const [x,z] of [[k,k],[-k,k],[k,-k],[-k,-k]] as const)
      acts.push({type:"PLACE_MODEL",key:"StreetLamp",pos:[x,1,z],yaw:0});
  };

  // ROADS
  const addRoads=(w:number,h:number,gap:number,width:number)=>{
    for(let x=-w;x<=w;x+=gap) acts.push({type:"PLACE_BLOCK",block:"Slate",pos:[x,1,0],size:[width,0.4,h*2+width],color:pal[2]});
    for(let z=-h;z<=h;z+=gap) acts.push({type:"PLACE_BLOCK",block:"Slate",pos:[0,1,z],size:[w*2+width,0.4,width],color:pal[2]});
  };

  // TOWER
  const addTower=(floors:number,radius:number)=>{
    for(let f=1;f<=floors;f++){
      const y=f*2; const count=24;
      for(let i=0;i<count;i++){
        const a=(i/count)*Math.PI*2, x=Math.cos(a)*radius, z=Math.sin(a)*radius;
        acts.push({type:"PLACE_BLOCK",block:"Neon",pos:[x,y,z],size:[2,2,2],color:pal[1]});
      }
      acts.push({type:"PLACE_BLOCK",block:"Neon",pos:[0,y+1,0],size:[2,2,2],color:pal[2]});
    }
  };

  // RIVER
  const addRiver=(length:number,width:number)=>{
    acts.push({type:"TERRAIN_BOX",material:"Grass",min:[-length/2,0,-width/2],max:[length/2,0.2,width/2]});
  };

  // GATE
  const addGate=(W:number,H:number,T:number)=>{
    const half=Math.floor(W/2), z=-Math.max(6,T);
    acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[-half,1,z],size:[2,H,T],color:pal[1]});
    acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[ half,1,z],size:[2,H,T],color:pal[1]});
    acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[0,H,z],size:[W,2,T],color:pal[1]});
  };

  // HOUSES
  const addHouses=(rows:number,cols:number,minH:number,maxH:number)=>{
    const spacing=6, startX=-((cols-1)*spacing)/2, startZ=12;
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
      const h = Math.round(clamp(minH,1,4) + (c%2)* (clamp(maxH,2,8)-clamp(minH,1,4)));
      const x=startX+c*spacing, z=startZ+r*spacing;
      acts.push({type:"PLACE_BLOCK",block:"SmoothPlastic",pos:[x,1,z],size:[4,h,4],color:pal[0]});
      // basit çatı
      acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[x,h+1,z],size:[4,1,4],color:"#6B4F2A"});
    }
  };

  // TREES
  const addTrees=(count:number,ringR:number)=>{
    for(let i=0;i<count;i++){
      const a=(i/count)*Math.PI*2, x=Math.cos(a)*ringR, z=Math.sin(a)*ringR;
      acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[x,1,z],size:[1,3,1],color:"#6B4F2A"});
      acts.push({type:"PLACE_BLOCK",block:"Grass",pos:[x,3.5,z],size:[3,3,3],color:"#3BAA3B"});
    }
  };

  // PYRAMID
  const addPyramid=(base:number,levels:number)=>{
    let s=base; for(let i=0;i<levels;i++){ acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[0,1+i,0],size:[s,1,s],color:"#C2B280"}); s-=2; if(s<=2)break; }
  };

  // DOME
  const addDome=(r:number)=>{
    for(let y=0;y<=r;y+=2){
      const ring = Math.max(1,Math.round((r - y)*1.5));
      for(let i=0;i<ring;i++){
        const a=(i/ring)*Math.PI*2, x=Math.cos(a)*(r-y), z=Math.sin(a)*(r-y);
        acts.push({type:"PLACE_BLOCK",block:"Neon",pos:[x,2+y,z],size:[2,2,2],color:pal[1]});
      }
    }
  };

  // BRIDGE
  const addBridge=(len:number,w:number,arch:number)=>{
    for(let x=-Math.floor(len/2); x<=Math.floor(len/2); x+=2){
      const y = Math.max(1, Math.round(Math.sin((x/len)*Math.PI)*arch)+1);
      acts.push({type:"PLACE_BLOCK",block:"Rock",pos:[x,y,0],size:[2,1,w],color:pal[0]});
    }
  };

  for(const step of program){
    switch(step.op){
      case "PLAZA": addPlaza(clamp(step.size??16,12,28), step.color); break;
      case "ROADS": addRoads(clamp(step.w??20,10,40), clamp(step.h??20,10,40), clamp(step.gap??8,6,20), clamp(step.width??2,2,6)); break;
      case "RIVER": addRiver(clamp(step.length??40,20,60), clamp(step.width??5,3,10)); break;
      case "GATE": addGate(clamp(step.width??10,6,16), clamp(step.height??8,6,16), clamp(step.thickness??2,1,4)); break;
      case "HOUSES": addHouses(clamp(step.rows??2,1,3), clamp(step.cols??4,2,6), clamp(step.minH??2,1,4), clamp(step.maxH??4,2,8)); break;
      case "TREES": addTrees(clamp(step.count??16,6,40), clamp(step.ringR??14,8,28)); break;
      case "TOWER": addTower(clamp(step.floors??3,1,6), clamp(step.radius??4,2,8)); break;
      case "PYRAMID": addPyramid(clamp(step.base??16,8,32), clamp(step.levels??6,3,12)); break;
      case "DOME": addDome(clamp(step.radius??6,4,12)); break;
      case "BRIDGE": addBridge(clamp(step.length??10,6,22), clamp(step.width??3,2,6), clamp(step.arch??2,0,5)); break;
    }
    if(acts.length>240) break;
  }

  return acts;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ok:true,msg:"POST { obs:{ prompt:'...' } } bekleniyor"}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt||"").slice(0,200);

    // 1) Groq'tan DSL programı iste
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{ "Authorization":`Bearer ${process.env.GROQ_API_KEY!}`,"Content-Type":"application/json"},
      body: JSON.stringify({
        model: MODEL, temperature: 0.2, response_format:{type:"json_object"},
        messages:[
          {role:"system", content:SYSTEM},
          {role:"user", content: prompt }
        ]
      })
    });

    let plan:any = { program:[], label:"AI Plaza", palette: palDefault };
    if(resp.ok){
      const j = await resp.json();
      plan = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    }

    // 2) Güvence: eksikler için varsayılanlar
    const program = Array.isArray(plan.program) ? plan.program : [{op:"PLAZA",size:16},{op:"ROADS",w:20,h:20,gap:8,width:2}];
    const palette = Array.isArray(plan.palette)&&plan.palette.length? plan.palette: palDefault;
    const label = typeof plan.label==="string" && plan.label.length<=24 ? plan.label : "AI Plaza";

    // 3) Programı ACTIONS'a genişlet
    const actions = expand(program, palette);
    actions.push({ type:"LABEL", text:label, pos:[0,5,0] });

    return new Response(JSON.stringify({ actions, reason:"v3 dsl+clamp" }), {status:200, headers:{"Content-Type":"application/json"}});
  } catch (e:any) {
    return new Response(JSON.stringify({ actions:[{type:"LABEL",text:"AI error",pos:[0,4,0]}], reason:"exception", detail:String(e)}), {status:200, headers:{"Content-Type":"application/json"}});
  }
};
