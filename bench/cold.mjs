import * as Y from 'yjs'
const seed=(dd,n)=>{const sh=dd.getMap('shapes'); dd.transact(()=>{for(let i=0;i<n;i++){const s=new Y.Map(); sh.set('s'+i,s)
  s.set('type','rect');s.set('x',i*3.7);s.set('y',i*2.1);s.set('w',80);s.set('h',60);s.set('fill','#3b82f6');s.set('idx','a'+i)}}); return sh}
const med=a=>{a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)].toFixed(1)}
console.log('COLD OPEN BUDGET (main-thread, uninterruptible) — Node 24, yjs 13.6.32')
console.log('shapes | blobKB | applyUpdate | toJSON walk | forEach+get walk | total')
for(const n of [1000,5000,20000,50000]){
  const src=new Y.Doc(); seed(src,n)
  const blob=Y.encodeStateAsUpdate(src)
  const ta=[],tj=[],tf=[]
  for(let i=0;i<5;i++){
    const d=new Y.Doc(); let t0=process.hrtime.bigint(); Y.applyUpdate(d,blob); ta.push(Number(process.hrtime.bigint()-t0)/1e6)
    t0=process.hrtime.bigint(); const j=d.getMap('shapes').toJSON(); tj.push(Number(process.hrtime.bigint()-t0)/1e6)
    t0=process.hrtime.bigint(); const store=new Map()
    d.getMap('shapes').forEach((v,k)=>store.set(k,{type:v.get('type'),x:v.get('x'),y:v.get('y'),w:v.get('w'),h:v.get('h'),fill:v.get('fill'),idx:v.get('idx')}))
    tf.push(Number(process.hrtime.bigint()-t0)/1e6)
  }
  const A=+med(ta),J=+med(tj),F=+med(tf)
  console.log(`${String(n).padStart(6)} | ${String((blob.byteLength/1024).toFixed(0)).padStart(6)} | ${String(A).padStart(11)} | ${String(J).padStart(11)} | ${String(F).padStart(16)} | ${(A+F).toFixed(1)}ms`)
}
console.log('\n(applyUpdate runs inside ONE Y.transact — it cannot be sliced across frames.')
console.log(' A warm load pays it TWICE: y-indexeddb hydrate, then the server diff.)')
