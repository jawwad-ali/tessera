import * as Y from 'yjs'
const structs = d => { let n=0; d.store.clients.forEach(a=>n+=a.length); return n }
const kb = b => (b/1024).toFixed(1)
const rep = (name,d,base) => {
  const v1 = Y.encodeStateAsUpdate(d).byteLength, v2 = Y.encodeStateAsUpdateV2(d).byteLength, s = structs(d)
  const dv = base ? `   (+${s-base.s} structs, +${kb(v1-base.v1)}KB v1, +${kb(v2-base.v2)}KB v2)` : ''
  console.log(`${name.padEnd(40)} structs=${String(s).padStart(7)} v1=${kb(v1).padStart(8)}KB v2=${kb(v2).padStart(8)}KB${dv}`)
  return {s,v1,v2}
}
const seed = (d,n) => { const sh=d.getMap('shapes'); d.transact(()=>{ for(let i=0;i<n;i++){const s=new Y.Map(); sh.set('s'+i,s)
  s.set('type','rect'); s.set('x',i*10); s.set('y',i*7); s.set('w',80); s.set('h',60); s.set('fill','#3b82f6'); s.set('idx','a'+i)} }); return sh }

// deterministic pseudo-random float drag path (realistic pointer trace)
let seedv = 12345
const rnd = () => { seedv = (seedv*1664525+1013904223)>>>0; return seedv/4294967296 }
const N=200, DRAGS=100, FRAMES=60
console.log(`REALISTIC FLOAT COORDS — ${N} shapes, ${DRAGS} drags x ${FRAMES} frames\n`)

function run(label, writer, round) {
  const d=new Y.Doc(); const sh=seed(d,N); const base=rep('  baseline',d)
  seedv=12345
  for(let k=0;k<DRAGS;k++){ const s=sh.get('s'+(k%N))
    let x = rnd()*4000, y = rnd()*3000
    for(let f=0;f<FRAMES;f++){ x += (rnd()-0.5)*24; y += (rnd()-0.5)*24
      const X = round?Math.round(x):x, Yv = round?Math.round(y):y
      writer(d,s,X,Yv,f,FRAMES) } }
  rep(label,d,base)
}
run('A  per-frame 2 keys, FLOAT', (d,s,x,y)=>d.transact(()=>{s.set('x',x);s.set('y',y)}), false)
run('A2 per-frame 2 keys, ROUNDED int', (d,s,x,y)=>d.transact(()=>{s.set('x',x);s.set('y',y)}), true)
run('B  per-frame 1 key {x,y} FLOAT', (d,s,x,y)=>d.transact(()=>{s.set('t',{x,y})}), false)
run('B2 per-frame 1 key {x,y} ROUNDED', (d,s,x,y)=>d.transact(()=>{s.set('t',{x,y})}), true)
run('B3 per-frame 1 key [x,y] ROUNDED', (d,s,x,y)=>d.transact(()=>{s.set('t',[x,y])}), true)
run('C  commit on pointerup (2 keys) FLOAT', (d,s,x,y,f,F)=>{ if(f===F-1) d.transact(()=>{s.set('x',x);s.set('y',y)}) }, false)
run('C2 commit on pointerup (1 key) FLOAT', (d,s,x,y,f,F)=>{ if(f===F-1) d.transact(()=>{s.set('t',{x,y})}) }, false)

console.log('\n--- IS INTERLEAVING THE MECHANISM? one shape, 60 frames, int coords ---')
function diag(label, fn){ const d=new Y.Doc(); const s=new Y.Map(); d.getMap('shapes').set('s0',s)
  const before=structs(d); fn(d,s); console.log(`${label.padEnd(46)} +${structs(d)-before} structs  v1=${Y.encodeStateAsUpdate(d).byteLength}B v2=${Y.encodeStateAsUpdateV2(d).byteLength}B`) }
diag('x only, 60 separate transactions', (d,s)=>{for(let f=0;f<60;f++) d.transact(()=>s.set('x',f))})
diag('x then y, interleaved, same transaction', (d,s)=>{for(let f=0;f<60;f++) d.transact(()=>{s.set('x',f);s.set('y',f)})})
diag('x then y, interleaved, separate transactions', (d,s)=>{for(let f=0;f<60;f++){d.transact(()=>s.set('x',f));d.transact(()=>s.set('y',f))}})
diag('all 60 x writes, THEN all 60 y writes', (d,s)=>{for(let f=0;f<60;f++) d.transact(()=>s.set('x',f)); for(let f=0;f<60;f++) d.transact(()=>s.set('y',f))})
diag('2 shapes interleaved on same key x', (d,s)=>{const s2=new Y.Map(); d.getMap('shapes').set('s1',s2); for(let f=0;f<60;f++) d.transact(()=>{s.set('x',f); s2.set('x',f)})})
