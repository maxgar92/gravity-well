// Headless test of the simulation: run AI-vs-AI games and report stats.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'src');
const assets = fs.readFileSync(path.join(src, 'assets.json'), 'utf8');
let code = fs.readFileSync(path.join(src, 'core.js'), 'utf8').replace('/*__ASSETS__*/null', assets) + '\n' + fs.readFileSync(path.join(src, 'sim.js'), 'utf8') + '\n' + fs.readFileSync(path.join(src, 'net.js'), 'utf8');
const stubs = `
const LOG=[]; function toast(m){LOG.push((G?G.t.toFixed(0):'')+'s '+m)}; function sfx(){}; function vibrate(){};
function tell(t,m){ if(t===ME) toast(m) }; function tsfx(){}; function tvib(){}; const SET={size:1}; let paused=false;
let ENDED=null; function sectorEnd(w){ENDED=w; G.over=true}; function onFighterLost(){}; function onFighterSpawn(){};
const INPUT={}; function playerControl(f){ aiFighter(f, STEP); }
`;
const harness = `
function stats(){
  const out = G.teams.map(T => { const c={}; for(const u of G.units) if(u.team===T.id) c[u.type]=(c[u.type]||0)+1; return TEAMS[T.id].name[0]+(T.alive?'':'✝')+' pl'+G.planets.filter(p=>p.owner===T.id).length+' dev'+T.dev+' '+JSON.stringify(c).replace(/["{}]/g,''); });
  return out.join(' | ');
}
function run(minutes, demo, size){
  newGame(1, size, demo);
  const t0=Date.now(); let nanCheck=0; let deaths={};
  const KSRC={}; const oCol=shotCollide; shotCollide=function(s){ const before=G.units.filter(u=>u.type==='fighter').map(u=>u.id); const r=oCol(s); if(r){ const after=new Set(G.units.filter(u=>u.type==='fighter').map(u=>u.id)); for(const id of before) if(!after.has(id)){ const k=s.tur?'turret':(s.k?'missile':'gun'); KSRC[k]=(KSRC[k]||0)+1; } } return r; }; globalThis.KSRC=KSRC;
  const origKill = killUnit; killUnit = function(u,by,cause){ if(!u.dead){ const k=u.type+':'+(cause||(by>=0?'combat':'other')); if(cause==='crash'&&u.ai){ let near='?',nd=1e9; for(const p of G.planets){const d=Math.hypot(u.x-p.x,u.y-p.y)-p.r; if(d<nd){nd=d;near=p.id;}} const pp=G.planets[near]; const [ox,oy]=portPos(pp); const dport=Math.hypot(u.x-ox,u.y-oy); (globalThis.CRASHLOG=globalThis.CRASHLOG||[]).push(u.ai.goal+' alt'+nd.toFixed(0)+' dport'+dport.toFixed(0)+' spd'+Math.hypot(u.vx,u.vy).toFixed(0)+' hp'+u.hp.toFixed(0)+' tgtpl'+u.ai.tpl+' near'+near); } deaths[k]=(deaths[k]||0)+1;} return origKill(u,by,cause); };
  for(let i=0;i<minutes*60*60;i++){
    step(STEP);
    if (G.over) break;
    if(i%(60*60*2)===0) console.log(' t='+(G.t/60).toFixed(1)+'m', stats());
    if(i%600===0) for(const u of G.units){ if(!isFinite(u.x)||!isFinite(u.y)||!isFinite(u.hp)) { console.log('NaN!', u.type, u.id, JSON.stringify(u).slice(0,300)); process.exit(1);} }
  }
  console.log('FIGHTER KILLED BY', JSON.stringify(KSRC)); console.log((globalThis.CRASHLOG||[]).slice(0,25).join(' ## ')); console.log('DEATHS', JSON.stringify(deaths)); console.log('END t='+(G.t/60).toFixed(1)+'m over='+G.over+' ended='+ENDED, stats(), 'ms='+(Date.now()-t0));
}
module.exports={run, get G(){return G}, get LOG(){return LOG}};
`;
const m = new Function('module', 'require', stubs + code + harness + '\nreturn module.exports;')({exports:{}}, require);
const mins = +process.argv[2] || 20, demo = process.argv[3] !== 'human', size = +(process.argv[4] ?? 1);
m.run(mins, demo, size);
if (!demo) console.log(m.LOG.slice(0, 60).join('\n'));
