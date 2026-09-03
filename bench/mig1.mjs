import * as Y from 'yjs'
const mk=c=>{const d=new Y.Doc(); d.clientID=c; return d}
const sync=(a,b)=>{ const ua=Y.encodeStateAsUpdate(a,Y.encodeStateVector(b)), ub=Y.encodeStateAsUpdate(b,Y.encodeStateVector(a))
  Y.applyUpdate(a,ub,'net'); Y.applyUpdate(b,ua,'net') }
const J=d=>JSON.stringify(d.getMap('shapes').toJSON())

console.log('=== M1. same-key DELETE vs concurrent SET on a Y.Map: who wins? ===')
for (const [mc, oc] of [[1000,50],[50,1000]]) {
  const M=mk(mc), O=mk(oc)
  M.transact(()=>{const s=new Y.Map(); M.getMap('shapes').set('s1',s); s.set('x',10)})
  Y.applyUpdate(O, Y.encodeStateAsUpdate(M))
  // partition: M (migrator) deletes the legacy key; O (stale client) writes it
  M.getMap('shapes').get('s1').delete('x')
  O.getMap('shapes').get('s1').set('x',99)
  sync(M,O)
  console.log(` migrator cid=${mc} vs stale cid=${oc}: M=${J(M)} O=${J(O)}  converged=${J(M)===J(O)}`)
}
console.log(' => NOT delete-wins; it is the ordinary clientID tie-break on that key chain\n')

console.log('=== M2. naive RENAME x,y -> pos, with one offline stale client ===')
{
const SRV=mk(500), OLD=mk(600)
SRV.transact(()=>{ const sh=SRV.getMap('shapes')
  for(const id of ['s1','s2']){ const s=new Y.Map(); sh.set(id,s); s.set('x',10); s.set('y',20); s.set('fill','red') } })
Y.applyUpdate(OLD, Y.encodeStateAsUpdate(SRV))
// OLD goes offline and drags s1 using the v1 schema
OLD.transact(()=>{ const s=OLD.getMap('shapes').get('s1'); s.set('x',333); s.set('y',444) })
// SRV runs the migration while OLD is offline
SRV.transact(()=>{ SRV.getMap('shapes').forEach(s=>{ s.set('pos',{x:s.get('x'),y:s.get('y')}); s.delete('x'); s.delete('y') })
  SRV.getMap('meta').set('schema',2) }, 'migration')
console.log(' server after migration :', J(SRV))
sync(SRV,OLD)
console.log(' server after reconnect :', J(SRV))
console.log(' stale  after reconnect :', J(OLD))
console.log(' converged:', J(SRV)===J(OLD), ' bytes-equal:', Buffer.from(Y.encodeStateAsUpdate(SRV)).equals(Buffer.from(Y.encodeStateAsUpdate(OLD))))
console.log(' => s1 carries BOTH pos(10,20) and resurrected x/y(333,444). The user drag is silently LOST')
console.log('    (pos won because 600>500 lost the x-key race? check: x present =', 'x' in JSON.parse(J(SRV)).s1, ')')
}

console.log('\n=== M3. same rename, but ADDITIVE (write pos, never delete x/y) ===')
{
const SRV=mk(500), OLD=mk(600)
SRV.transact(()=>{ const sh=SRV.getMap('shapes'); const s=new Y.Map(); sh.set('s1',s); s.set('x',10); s.set('y',20) })
Y.applyUpdate(OLD, Y.encodeStateAsUpdate(SRV))
OLD.transact(()=>{ const s=OLD.getMap('shapes').get('s1'); s.set('x',333); s.set('y',444) })
SRV.transact(()=>{ const s=SRV.getMap('shapes').get('s1'); s.set('pos',{x:s.get('x'),y:s.get('y')}) },'migration')
sync(SRV,OLD)
console.log(' result:', J(SRV), 'converged:', J(SRV)===J(OLD))
console.log(' => still wrong: pos={10,20} but x/y={333,444}. Two sources of truth, no conflict detected.')
}

console.log('\n=== M4. VALUE-SHAPE change on ONE key: {x,y} object -> [x,y] array ===')
{
const NEW=mk(1000), OLD=mk(50)
NEW.transact(()=>{const s=new Y.Map(); NEW.getMap('shapes').set('s1',s); s.set('t',{x:1,y:2})})
Y.applyUpdate(OLD, Y.encodeStateAsUpdate(NEW))
OLD.getMap('shapes').get('s1').set('t',{x:9,y:9})   // old client, object form
NEW.getMap('shapes').get('s1').set('t',[7,7])       // new client, array form
sync(NEW,OLD)
console.log(' converged value:', J(NEW), ' equal:', J(NEW)===J(OLD))
console.log(' => the higher clientID decides which SCHEMA the shape has. Renderer must accept both, forever.')
}

console.log('\n=== M5. is a migration transaction idempotent / re-runnable? ===')
{
const A=mk(10), B=mk(20)
const boot=d=>d.transact(()=>{const s=new Y.Map(); d.getMap('shapes').set('s1',s); s.set('x',5); s.set('y',6)})
boot(A); Y.applyUpdate(B, Y.encodeStateAsUpdate(A))
const migrate=(d)=>d.transact(()=>{d.getMap('shapes').forEach(s=>{ if(s.has('x')){ s.set('pos',{x:s.get('x'),y:s.get('y')}); s.delete('x'); s.delete('y')} })},'mig')
migrate(A); migrate(B)   // two instances both run it, in partition
sync(A,B)
console.log(' both-migrated result:', J(A), 'converged:', J(A)===J(B), 'bytes-equal:', Buffer.from(Y.encodeStateAsUpdate(A)).equals(Buffer.from(Y.encodeStateAsUpdate(B))))
console.log(' structs after double migration:', (()=>{let n=0;A.store.clients.forEach(a=>n+=a.length);return n})())
}
