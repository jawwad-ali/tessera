import * as Y from 'yjs'
const structs = d => { let n=0; d.store.clients.forEach(a=>n+=a.length); return n }
const kb = b => (b/1024).toFixed(1)
const seed = (d,n) => { const sh=d.getMap('shapes'); d.transact(()=>{ for(let i=0;i<n;i++){const s=new Y.Map(); sh.set('s'+i,s)
  s.set('type','rect'); s.set('x',i*10); s.set('y',i*7); s.set('w',80); s.set('h',60); s.set('fill','#3b82f6'); s.set('idx','a'+i)} }); return sh }
let sv=999; const rnd=()=>{ sv=(sv*1664525+1013904223)>>>0; return sv/4294967296 }
const N=1000, DRAGS=1000, FRAMES=60

function build(writer){ const d=new Y.Doc(); const sh=seed(d,N); sv=999
  const log=[]
  d.on('update', u=>log.push(u))
  for(let k=0;k<DRAGS;k++){ const s=sh.get('s'+(k%N)); let x=rnd()*4000,y=rnd()*3000
    for(let f=0;f<FRAMES;f++){ x+=(rnd()-0.5)*24; y+=(rnd()-0.5)*24; writer(d,s,x,y,f,FRAMES) } }
  return {d, log}
}
function timeload(bytes, v2){ const t=[]; for(let i=0;i<7;i++){ const d=new Y.Doc(); const t0=process.hrtime.bigint()
    v2?Y.applyUpdateV2(d,bytes):Y.applyUpdate(d,bytes); const t1=process.hrtime.bigint(); t.push(Number(t1-t0)/1e6) }
  t.sort((a,b)=>a-b); return t[3].toFixed(1) }

const cases = {
 'A naive: per-frame 2 keys': (d,s,x,y)=>d.transact(()=>{s.set('x',x);s.set('y',y)}),
 'B single transform key   ': (d,s,x,y)=>d.transact(()=>{s.set('t',{x,y})}),
 'C commit on pointerup    ': (d,s,x,y,f,F)=>{ if(f===F-1) d.transact(()=>{s.set('x',x);s.set('y',y)}) },
}
console.log(`${N} shapes, ${DRAGS} drags x ${FRAMES} frames (float coords)\n`)
console.log('case                        structs      v1KB     v2KB   rawlogKB  loadV1ms loadV2ms  svBytes  wireMsgs')
for(const [name,w] of Object.entries(cases)){
  const {d,log}=build(w)
  const v1=Y.encodeStateAsUpdate(d), v2=Y.encodeStateAsUpdateV2(d)
  const raw=log.reduce((n,u)=>n+u.byteLength,0)
  console.log(`${name} ${String(structs(d)).padStart(8)} ${kb(v1.byteLength).padStart(9)} ${kb(v2.byteLength).padStart(8)} ${kb(raw).padStart(10)} ${timeload(v1,false).padStart(9)} ${timeload(v2,true).padStart(8)} ${String(Y.encodeStateVector(d).length).padStart(8)} ${String(log.length).padStart(9)}`)
}
