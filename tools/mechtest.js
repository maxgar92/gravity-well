const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'src');
const assets = fs.readFileSync(path.join(src, 'assets.json'), 'utf8');
const code = fs.readFileSync(path.join(src, 'core.js'), 'utf8').replace('/*__ASSETS__*/null', assets) + '\n' + fs.readFileSync(path.join(src, 'sim.js'), 'utf8') + '\n' + fs.readFileSync(path.join(src, 'net.js'), 'utf8');
const stubs = `const LOG=[]; function toast(m){LOG.push(m)}; function sfx(){}; function vibrate(){}; let ENDED='none'; function sectorEnd(w){ENDED=w;G.over=true}; function onFighterLost(t){ if(t===ME) LOG.push('[lost]')}; function onFighterSpawn(t){ if(t===ME) LOG.push('[newfighter]')};
function tell(t,m){ if(t===ME) LOG.push(m); else if (NET.role==='host' && G.teams[t].ctl==='remote') netTeamEvent(t,['m',m,'','']); }; function tsfx(){}; function tvib(){}; const SET={size:1}; let paused=false; const TELL_REMOTE=[];
const INPUT={left:false,right:false,thrust:false,fire:false,mis:false}; function playerControl(f){ const c=f.ctl; c.turn=(INPUT.right?1:0)-(INPUT.left?1:0); c.thrust=INPUT.thrust; c.fire=INPUT.fire; c.mis=INPUT.mis; }`;
const tests = `
function fresh(){ newGame(1,1,false); LOG.length=0; return fighterOf(0); }
function emptyPlanet(){ return G.planets.find(p=>planetEmpty(p) && p.owner<0); }
function run(sec){ for(let i=0;i<sec*60;i++){ step(STEP); } }
function hover(f,p,alt,ang,vin,head){ f.st='f'; f.x=p.x+Math.cos(ang)*(p.r+alt); f.y=p.y+Math.sin(ang)*(p.r+alt); f.vx=-Math.cos(ang)*vin; f.vy=-Math.sin(ang)*vin; f.a=head; f.lift=-9; }
const R={};
// 1. soft landing, correct orientation -> claim
let f=fresh(); let p=emptyPlanet(); let a=0.7; hover(f,p,40,a,10,a); run(3);
R.softLand={st:f.st, owner:p.owner, hp:f.hp.toFixed(0), log:LOG.slice()};
// 2. landing with bad orientation -> damaged but landed
f=fresh(); p=emptyPlanet(); hover(f,p,30,a,10,a+Math.PI); run(3);
R.badOrient={st:f.st, hp:f.hp.toFixed(1), log:LOG.slice()};
// 3. too fast -> bounce damage (60 u/s)
f=fresh(); p=emptyPlanet(); hover(f,p,30,a,70,a); run(0.6);
R.bounce={st:f.st, hp:f.hp.toFixed(1), log:LOG.slice()};
// 4. crash at high speed
f=fresh(); p=emptyPlanet(); hover(f,p,40,a,200,a); run(1); 
R.crash={alive:!!U.get(f.id), log:LOG.slice()};
// 5. respawn after death
run(7); R.respawn={hasFighter:!!fighterOf(0), log:LOG.slice()};
// 6. docking at own port: place fighter just outside deck matching port velocity
f=fresh(); const home=G.planets.find(pp=>pp.owner===0); const port=U.get(home.s.port);
{ const [ox,oy]=portPos(home); const [wx,wy]=toWorld(ox,oy,home.pa,30,0); f.st='f'; f.x=wx; f.y=wy; const pvx=-(oy-home.y)*C.PORT_W, pvy=(ox-home.x)*C.PORT_W; const c=Math.cos(home.pa), s=Math.sin(home.pa); f.vx=pvx - c*15; f.vy=pvy - s*15; f.a=home.pa; f.lift=-9; f.hp=20; }
let docked=false; for(let i=0;i<180;i++){ step(STEP); if(f.st==='d'){docked=true;break;} }
run(3); R.dock={docked, st:f.st, hp:f.hp.toFixed(1), log:LOG.slice()};
// 7. takeoff from dock
INPUT.thrust=true; run(0.5); INPUT.thrust=false; R.undock={st:f.st, spdRel:'', hp:f.hp.toFixed(1)}; run(1); R.undock.after=f.st+' hp'+f.hp.toFixed(1);
// 8. hitting port body sideways at speed -> damage
f=fresh(); let home2=G.planets.find(pp=>pp.owner===0); { const home=home2; const [ox,oy]=portPos(home); const [wx,wy]=toWorld(ox,oy,home.pa,-40,0); f.st='f'; f.x=wx; f.y=wy; const c=Math.cos(home.pa), s=Math.sin(home.pa); const pvx=-(oy-home.y)*C.PORT_W, pvy=(ox-home.x)*C.PORT_W; f.vx=pvx+c*80; f.vy=pvy+s*80; f.a=home.pa; f.lift=-9; }
run(1); R.portHit={st:f.st, hp:f.hp.toFixed(1)};
// 9. upgrade install: dev ready, land on home planet with lab
f=fresh(); G.teams[0].dev=3; { const home=G.planets.find(pp=>pp.owner===0); const ang=-1.2; hover(f,home,25,ang,8,ang); } run(2);
R.upgrade={upg:f.upg, ammo:f.ammo, maxSh:fstats(f.upg).maxSh, log:LOG.slice()};
// 10. claim blocked by enemy installations
f=fresh(); const enemyHome=G.planets.find(pp=>pp.owner===1); hover(f,enemyHome,25,2.0,8,2.0); run(1.5);
R.enemyPlanet={st:f.st, owner:enemyHome.owner, log:LOG.slice()};
// 11. missiles: give upgrade and fire at enemy fighter
f=fresh(); f.upg=3; f.ammo=6; const e=fighterOf(1); e.st='f'; e.x=f.x+300; e.y=f.y-200; e.vx=e.vy=0; f.st='f'; f.lift=-9; f.a=Math.atan2(e.y-f.y,e.x-f.x); INPUT.mis=true; run(0.1); INPUT.mis=false; const ms=G.shots.filter(s=>s.k===2); R.missile={fired:ms.length, target:ms[0]&&ms[0].tg===e.id};
// 12. win condition
fresh(); for(const T of G.teams){ if(T.id===0) continue; for(const u of G.units.slice()) if(u.team===T.id && (u.type==='colony'||u.type==='freighter')) removeUnit(u); } run(1); R.win={ended:ENDED, alive:G.teams.map(t=>t.alive)};
// 13. lose condition
ENDED='none'; fresh(); for(const u of G.units.slice()) if(u.team===0 && (u.type==='colony'||u.type==='freighter')) removeUnit(u); run(1); R.lose={ended:ENDED};
// 14. save/restore roundtrip
fresh(); run(20); const snap=JSON.stringify(G); const t1=G.t; G=JSON.parse(snap); rebuildIndex(); run(5); R.restore={t1:t1.toFixed(1), t2:G.t.toFixed(1), units:G.units.length};
// 15. upgrade becomes ready while already landed on a lab planet
f=fresh(); LOG.length=0; G.teams[0].dev=2; run(0.5); R.upgradeWhileLanded={upg:f.upg, st:f.st, log:LOG.slice()};
// 16. alliances: team 0 + team 1 allied (10), teams 2 and 3 enemies
newGame(1,1,false,{slots:[{ctl:'local',ally:10},{ctl:'ai',ally:10},{ctl:'ai',ally:2},{ctl:'ai',ally:3}]}); LOG.length=0; ENDED='none';
{ const t0=G.units.find(u=>u.team===0&&u.type==='base'); const hp0=t0.hp; addShot(1,t0.x,t0.y,0,0,0.5,50,0); step(STEP); const allyHit=t0.hp<hp0;
  const t2=G.units.find(u=>u.team===2&&u.type==='base'); const hp2=t2.hp; addShot(1,t2.x,t2.y,0,0,0.5,5,0); step(STEP); const foeHit=t2.hp<hp2;
  R.ally={allyShotHurts:allyHit, enemyShotHurts:foeHit, foe01:foe(0,1), foe02:foe(0,2)}; }
// AI of the allied team never targets team 0
{ let targeted=0; for(let i=0;i<60*60*3;i++){ step(STEP); const f1=fighterOf(1); if(f1&&f1.ai.goal==='attack'){ const t=U.get(f1.ai.tid); if(t&&t.team===0) targeted++; } if(G.over) break; } R.allyAI={timesAllyTargetedMe:targeted}; }
// victory of the alliance when 2 and 3 fall
newGame(1,1,false,{slots:[{ctl:'local',ally:10},{ctl:'ai',ally:10},{ctl:'ai',ally:2},{ctl:'ai',ally:3}]}); ENDED='none';
for(const u of G.units.slice()) if((u.team===2||u.team===3)&&(u.type==='colony'||u.type==='freighter')) removeUnit(u); run(1); R.allyWin={ended:ENDED};
// 17. remote fighter on the host: follows reported state, lands and claims, takes reported damage
newGame(1,1,false,{online:true,slots:[{ctl:'local'},{ctl:'remote',pname:'Juan'},{ctl:'ai'},{ctl:'ai'}]}); NET.role='host'; LOG.length=0;
{ const f=fighterOf(1); const p=emptyPlanet(); f.rem={id:f.id,st:'f',x:p.x+400,y:p.y,vx:-20,vy:0,a:0,thr:1,fi:0,mi:0,t:G.t}; f.st='f'; step(STEP);
  const follows=Math.abs(f.x-(p.x+400))<5;
  f.rem={id:f.id,st:'l',pl:p.id,la:0,x:p.x+108,y:p.y,vx:0,vy:0,a:0,thr:0,fi:0,mi:0,t:G.t}; step(STEP);
  const hp=f.hp; hullDamage(f,10,-1);
  R.remote={follows, st:f.st, owner:p.owner, hpAfterDamage:f.hp, hpBefore:hp, msgsForJuan:NET.teamEv[1].map(e=>e[1])}; }
// 18. disconnect -> AI takes over and the game continues
{ const T=G.teams[1]; T.ctl='ai'; T.human=false; const f=fighterOf(1); f.rem=null; run(2); R.dropToAI={ctl:T.ctl, fighterStillThere:!!fighterOf(1), over:G.over}; }
// 19. snapshot roundtrip host -> client
newGame(1,1,false,{online:true,slots:[{ctl:'local'},{ctl:'remote',pname:'Ana'},{ctl:'ai'},{ctl:'ai'}]}); NET.role='host'; run(30);
{ const sent=[]; NET.conns=new Map([['x',{open:true,team:1,conn:{open:true,send:s=>sent.push(s)}}]]);
  const initJSON=JSON.stringify(G); hostSnapshot(); hostSnapshot(); hostSnapshot();
  const hostG=G; const hostCounts={units:G.units.length, shots:G.shots.length};
  // cliente
  NET.role='client'; G=migrateGame(JSON.parse(initJSON)); ME=1; rebuildIndex(); NET.myF=0; NET.resync=true; NET.shotMap=new Map(); NET.phase='game';
  for(const u of G.units) { u.cx=0; u.cy=0; u.ta=u.a; }
  for(const raw of sent){ const m=recvFrom('h',raw); if(m) applySnapshot(m); }
  const clientG=G; let maxErr=0; for(const u of hostG.units){ const c=clientG.units.find(v=>v.id===u.id); if(!c){maxErr=1e9;break;} if(UT[u.type].ship && u.id!==NET.myF) maxErr=Math.max(maxErr, Math.hypot(c.x+c.cx-u.x, c.y+c.cy-u.y)); }
  R.snapshot={bytes:sent.map(s=>s.length), hostUnits:hostCounts.units, clientUnits:clientG.units.length, hostShots:hostCounts.shots, clientShots:clientG.shots.length, maxShipErr:Math.round(maxErr), ownFighterAdopted:NET.myF===fighterOf(1).id};
  // el cliente simula su nave y la reporta
  const reports=[]; NET.host={open:true, send:s=>reports.push(s)}; INPUT.thrust=true; for(let i=0;i<40;i++) clientFrame(1/60); INPUT.thrust=false;
  const f=U.get(NET.myF); R.clientFly={st:f.st, reports:reports.length, last:recvFrom('h2',reports[reports.length-1])};
  NET.role=null; G=hostG; rebuildIndex(); }
console.log(JSON.stringify(R,null,1));
`;
new Function(stubs + code + tests)();
