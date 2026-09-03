import * as Y from 'yjs'
const MB=n=>(n/1048576).toFixed(2), KB=n=>(n/1024).toFixed(0)
const sc=d=>{let n=0;d.store.clients.forEach(a=>n+=a.length);return n}
let sv=7; const rnd=()=>{sv=(sv*1664525+1013904223)>>>0; return sv/4294967296}
// realistic 6-month board: many sessions, each with its own clientID, float drags, deletes, strokes
const SESSIONS=250, SHAPES_PER=12, DRAGS_PER=8, FRAMES=60, DEL_PER=4
const d=new Y.Doc(); const m=d.getMap('shapes')
let raw=0, n=0; d.on('update',u=>{raw+=u.byteLength;n++})
let id=0
for(let s=0;s<SESSIONS;s++){
  d.clientID = 1000000 + s*7919
  const mine=[]
  for(let i=0;i<SHAPES_PER;i++){ const k='s'+(id++); const sh=new Y.Map()
    d.transact(()=>{ m.set(k,sh); sh.set('type','rect'); sh.set('x',rnd()*4000); sh.set('y',rnd()*3000)
      sh.set('w',80); sh.set('h',60); sh.set('fill','#36f'); sh.set('stroke','#111'); sh.set('idx','a'+i) })
    mine.push(k) }
  for(let k=0;k<DRAGS_PER;k++){ const sh=m.get(mine[k]); let x=rnd()*4000,y=rnd()*3000
    for(let f=0;f<FRAMES;f++){ x+=(rnd()-0.5)*24; y+=(rnd()-0.5)*24; d.transact(()=>{sh.set('x',x);sh.set('y',y)}) } }
  for(let k=0;k<DEL_PER;k++) d.transact(()=>m.delete(mine[k]))
}
console.log(`live shapes ${m.size} | clientIDs ${d.store.clients.size} | structs ${sc(d)} | updates ${n}`)
console.log('')
const v1=Y.encodeStateAsUpdate(d), v2=Y.encodeStateAsUpdateV2(d)
console.log(`raw append-only log            ${MB(raw).padStart(7)} MB   (${n} rows)`)
console.log(`encodeStateAsUpdate      [V1]  ${MB(v1.byteLength).padStart(7)} MB   lossless   ${(raw/v1.byteLength).toFixed(1)}x`)
console.log(`encodeStateAsUpdateV2    [V2]  ${MB(v2.byteLength).padStart(7)} MB   lossless   ${(raw/v2.byteLength).toFixed(1)}x   = ${KB(v2.byteLength)} KB`)
// lossy rebuild
const f=new Y.Doc(); const fm=f.getMap('shapes')
f.transact(()=>{ m.forEach((v,k)=>{const nn=new Y.Map(); fm.set(k,nn); v.forEach((vv,kk)=>nn.set(kk,vv))}) })
const fv2=Y.encodeStateAsUpdateV2(f)
console.log(`rebuilt-from-values      [V2]  ${MB(fv2.byteLength).padStart(7)} MB   LOSSY      ${(raw/fv2.byteLength).toFixed(1)}x   = ${KB(fv2.byteLength)} KB`)
// same board written the RIGHT way (commit-on-pointerup, single transform key)
let sv2=7; const rnd2=()=>{sv2=(sv2*1664525+1013904223)>>>0; return sv2/4294967296}
const g=new Y.Doc(); const gm=g.getMap('shapes'); let graw=0,gn=0; g.on('update',u=>{graw+=u.byteLength;gn++})
let gid=0
for(let s=0;s<SESSIONS;s++){ g.clientID=1000000+s*7919; const mine=[]
  for(let i=0;i<SHAPES_PER;i++){ const k='s'+(gid++); const sh=new Y.Map()
    g.transact(()=>{ gm.set(k,sh); sh.set('type','rect'); sh.set('t',{x:rnd2()*4000,y:rnd2()*3000,w:80,h:60})
      sh.set('fill','#36f'); sh.set('stroke','#111'); sh.set('idx','a'+i) }); mine.push(k) }
  for(let k=0;k<DRAGS_PER;k++){ const sh=gm.get(mine[k]); let x=rnd2()*4000,y=rnd2()*3000
    for(let fr=0;fr<FRAMES;fr++){ x+=(rnd2()-0.5)*24; y+=(rnd2()-0.5)*24 }
    g.transact(()=>sh.set('t',{x,y,w:80,h:60})) }
  for(let k=0;k<DEL_PER;k++) g.transact(()=>gm.delete(mine[k])) }
const gv1=Y.encodeStateAsUpdate(g), gv2=Y.encodeStateAsUpdateV2(g)
console.log('')
console.log(`SAME BOARD, ephemeral-until-committed + single transform key:`)
console.log(`  raw log ${MB(graw)} MB (${gn} rows) | structs ${sc(g)} | V1 ${KB(gv1.byteLength)} KB | V2 ${KB(gv2.byteLength)} KB`)
console.log('')
const tl=(bytes,isv2)=>{const t=[];for(let i=0;i<5;i++){const dd=new Y.Doc();const t0=process.hrtime.bigint()
  isv2?Y.applyUpdateV2(dd,bytes):Y.applyUpdate(dd,bytes);t.push(Number(process.hrtime.bigint()-t0)/1e6)};t.sort((a,b)=>a-b);return t[2].toFixed(0)}
console.log(`cold load: naive V1 ${tl(v1,false)}ms | naive V2 ${tl(v2,true)}ms | lossy-rebuilt V2 ${tl(fv2,true)}ms | disciplined V2 ${tl(gv2,true)}ms`)
const up=new Y.Doc(); Y.applyUpdate(up,v1)
console.log(`delete-set floor for an already-synced client: ${Y.diffUpdate(v1,Y.encodeStateVector(up)).byteLength} B`)
console.log(`state vector on connect: naive ${Y.encodeStateVector(d).length} B | lossy-rebuilt ${Y.encodeStateVector(f).length} B`)
