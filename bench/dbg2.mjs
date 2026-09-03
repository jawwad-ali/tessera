import * as Y from 'yjs'
import {createHash} from 'crypto'
const h = b => createHash('sha256').update(Buffer.from(b)).digest('hex').slice(0,16)

// ---- 1. Is encodeStateAsUpdate a VALID divergence checksum across replicas? ----
console.log('=== 1. checksum stability across delivery order ===')
function mk(cid){ const d=new Y.Doc(); d.clientID=cid; return d }
const A=mk(100), B=mk(200), C=mk(300)
A.getMap('s').set('a',1); B.getMap('s').set('b',2); C.getMap('s').set('c',3)
const uA=Y.encodeStateAsUpdate(A), uB=Y.encodeStateAsUpdate(B), uC=Y.encodeStateAsUpdate(C)
// deliver in 3 different orders into 3 fresh docs
const orders=[[uA,uB,uC],[uC,uB,uA],[uB,uA,uC]]
const res = orders.map((o,i)=>{ const d=mk(900+i); o.forEach(u=>Y.applyUpdate(d,u))
  return {sv:h(Y.encodeStateVector(d)), v1:h(Y.encodeStateAsUpdate(d)), v2:h(Y.encodeStateAsUpdateV2(d)),
          json:h(Buffer.from(JSON.stringify(d.getMap('s').toJSON()))), keys:JSON.stringify([...d.getMap('s').keys()])} })
res.forEach((r,i)=>console.log(` order${i}: sv=${r.sv} v1=${r.v1} v2=${r.v2} jsonHash=${r.json} keys=${r.keys}`))
console.log(' v1 identical across orders? ', new Set(res.map(r=>r.v1)).size===1)
console.log(' v2 identical across orders? ', new Set(res.map(r=>r.v2)).size===1)
console.log(' toJSON identical?           ', new Set(res.map(r=>r.json)).size===1, ' <- render order hazard')

// ---- 2. does the LOCAL clientID of the observer perturb the checksum? ----
console.log('\n=== 2. does observing doc own clientID / own edits change the checksum? ===')
const O1=mk(1), O2=mk(4000000000)
;[uA,uB,uC].forEach(u=>{Y.applyUpdate(O1,u);Y.applyUpdate(O2,u)})
console.log(' O1(cid=1)  v1=',h(Y.encodeStateAsUpdate(O1)))
console.log(' O2(cid=4e9) v1=',h(Y.encodeStateAsUpdate(O2)), ' equal:', h(Y.encodeStateAsUpdate(O1))===h(Y.encodeStateAsUpdate(O2)))

// ---- 3. TRUE DIVERGENCE: identical state vectors, different content (clientID collision) ----
console.log('\n=== 3. clientID collision: identical SV, different content? ===')
const X=mk(777), Z=mk(777)
X.getMap('s').set('fromX','x'); Z.getMap('s').set('fromZ','z')
const ux=Y.encodeStateAsUpdate(X), uz=Y.encodeStateAsUpdate(Z)
Y.applyUpdate(X,uz); Y.applyUpdate(Z,ux)
console.log(' X keys',[...X.getMap('s').keys()],'sv',h(Y.encodeStateVector(X)),'v1',h(Y.encodeStateAsUpdate(X)))
console.log(' Z keys',[...Z.getMap('s').keys()],'sv',h(Y.encodeStateVector(Z)),'v1',h(Y.encodeStateAsUpdate(Z)))
console.log(' SV equal:', h(Y.encodeStateVector(X))===h(Y.encodeStateVector(Z)), ' content equal:', h(Y.encodeStateAsUpdate(X))===h(Y.encodeStateAsUpdate(Z)))
console.log(' => a state-vector comparison MISSES this; a content hash catches it')

// ---- 4. debug tooling on a real update ----
console.log('\n=== 4. parseUpdateMeta / decodeUpdate / obfuscate ===')
const D=mk(555); const sh=D.getMap('shapes')
D.transact(()=>{ const s=new Y.Map(); sh.set('note1',s); s.set('text', new Y.Text('salary is 90k')); s.set('x',12.5) })
const up=Y.encodeStateAsUpdate(D)
console.log(' parseUpdateMeta:', JSON.stringify(Y.parseUpdateMeta(up), (k,v)=> typeof v==='object'&&v instanceof Map ? [...v] : v))
const dec = Y.decodeUpdate(up)
console.log(' decodeUpdate -> structs:', dec.structs.length, ' first:', dec.structs[0].constructor.name, JSON.stringify(dec.structs[0].id))
console.log(' struct summary:', dec.structs.map(s=>`${s.constructor.name}${s.parentSub?'['+s.parentSub+']':''}:${s.content?s.content.constructor.name:''}`).join(' '))
const obf = Y.obfuscateUpdate(up)
const OD=mk(1); Y.applyUpdate(OD, obf)
console.log(' obfuscated doc JSON:', JSON.stringify(OD.getMap('shapes').toJSON()).slice(0,160))
console.log(' obfuscated root keys:', [...OD.share.keys()])
console.log(' original bytes contain "salary"?', Buffer.from(up).includes(Buffer.from('salary')), ' obfuscated?', Buffer.from(obf).includes(Buffer.from('salary')))

// ---- 5. diff two divergent docs (the actual workflow) ----
console.log('\n=== 5. "what does A have that B lacks" workflow ===')
const P=mk(11), Q=mk(22)
P.getMap('s').set('p1',1); P.getMap('s').set('p2',2); Q.getMap('s').set('q1',1)
Y.applyUpdate(Q, Y.encodeStateAsUpdate(P))   // Q now has everything of P; P lacks Q's
const missing = Y.diffUpdate(Y.encodeStateAsUpdate(Q), Y.encodeStateVector(P))
console.log(' diffUpdate(Q, sv(P)) =', missing.byteLength, 'bytes; meta:', JSON.stringify(Y.parseUpdateMeta(missing),(k,v)=>v instanceof Map?[...v]:v))
console.log(' structs in the diff:', Y.decodeUpdate(missing).structs.map(s=>`${s.constructor.name} client=${s.id.client} clock=${s.id.clock} key=${s.parentSub}`).join(' | '))
console.log(' encodeStateVectorFromUpdate(diff):', [...Y.decodeStateVector(Y.encodeStateVectorFromUpdate(missing))])
