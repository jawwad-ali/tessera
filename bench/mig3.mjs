import * as Y from 'yjs'
const KB=b=>(b/1024).toFixed(1)
const sc=d=>{let n=0;d.store.clients.forEach(a=>n+=a.length);return n}
// cost of migrating a real board, and whether a migration can be rolled back
const N=2000
const d=new Y.Doc(); d.clientID=1; const m=d.getMap('shapes')
d.transact(()=>{for(let i=0;i<N;i++){const s=new Y.Map(); m.set('s'+i,s)
  s.set('type','rect');s.set('x',i*3.7);s.set('y',i*2.1);s.set('w',80);s.set('h',60);s.set('fill','#36f')}})
const before={v1:Y.encodeStateAsUpdate(d).byteLength, v2:Y.encodeStateAsUpdateV2(d).byteLength, s:sc(d)}
console.log(`before migration:  ${before.s} structs, ${KB(before.v1)}KB v1, ${KB(before.v2)}KB v2`)
// migration v1->v2: x,y -> pos, in ONE transaction under a migration clientID
d.clientID = 999999
let migBytes=0; const off=u=>{migBytes+=u.byteLength}
d.on('update',off)
d.transact(()=>{ m.forEach(s=>{ s.set('pos',{x:s.get('x'),y:s.get('y')}); s.delete('x'); s.delete('y') }) },'migration')
d.off('update',off)
const after={v1:Y.encodeStateAsUpdate(d).byteLength, v2:Y.encodeStateAsUpdateV2(d).byteLength, s:sc(d)}
console.log(`after  migration:  ${after.s} structs, ${KB(after.v1)}KB v1, ${KB(after.v2)}KB v2`)
console.log(`  migration update itself: ${KB(migBytes)}KB on the wire (one message to every client)`)
console.log(`  permanent cost: +${after.s-before.s} structs, +${KB(after.v1-before.v1)}KB v1, +${KB(after.v2-before.v2)}KB v2`)
// can it be rolled back?
let rbBytes=0; const off2=u=>{rbBytes+=u.byteLength}; d.on('update',off2)
d.transact(()=>{ m.forEach(s=>{ const p=s.get('pos'); s.set('x',p.x); s.set('y',p.y); s.delete('pos') }) },'rollback')
d.off('update',off2)
const rb={v1:Y.encodeStateAsUpdate(d).byteLength, v2:Y.encodeStateAsUpdateV2(d).byteLength, s:sc(d)}
console.log(`after  rollback :  ${rb.s} structs, ${KB(rb.v1)}KB v1, ${KB(rb.v2)}KB v2   (+${KB(rbBytes)}KB wire)`)
console.log(`  net vs pre-migration: +${rb.s-before.s} structs, +${KB(rb.v1-before.v1)}KB v1 — a round trip is NOT free`)
console.log(`  content identical to pre-migration? ${JSON.stringify(m.get('s0').toJSON())}`)
// what an epoch rebuild costs instead
const f=new Y.Doc(); const fm=f.getMap('shapes')
f.transact(()=>{ m.forEach((v,k)=>{const n2=new Y.Map(); fm.set(k,n2); v.forEach((vv,kk)=>n2.set(kk,vv))}) })
console.log(`epoch rebuild:     ${sc(f)} structs, ${KB(Y.encodeStateAsUpdate(f).byteLength)}KB v1, ${KB(Y.encodeStateAsUpdateV2(f).byteLength)}KB v2  (LOSSY, forces every client to reload)`)
