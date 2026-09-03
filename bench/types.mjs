import * as Y from 'yjs'
const d=new Y.Doc(); const m=d.getMap('shapes'); const s=new Y.Map(); m.set('s1',s)
console.log('=== what does a Y.Map accept as a value? (no schema enforcement anywhere) ===')
const tries = [
 ['string x', ()=>s.set('x','banana')],
 ['NaN',      ()=>s.set('x',NaN)],
 ['Infinity', ()=>s.set('x',Infinity)],
 ['null',     ()=>s.set('x',null)],
 ['undefined',()=>s.set('x',undefined)],
 ['huge nested obj', ()=>s.set('x',{a:{b:{c:new Array(50).fill('z')}}})],
 ['10MB string', ()=>s.set('big','z'.repeat(10*1024*1024))],
 ['-0',       ()=>s.set('x',-0)],
 ['BigInt',   ()=>s.set('x',1n)],
 ['Date',     ()=>s.set('x',new Date(0))],
 ['function', ()=>s.set('x',()=>1)],
 ['Symbol',   ()=>s.set('x',Symbol('q'))],
 ['Map',      ()=>s.set('x',new Map())],
]
for(const [name,fn] of tries){ try{ fn(); const v=s.get('x')!==undefined?s.get('x'):s.get('big')
   console.log(`  ${name.padEnd(16)} ACCEPTED -> typeof ${typeof v}${name==='10MB string'?'':' value '+String(JSON.stringify(v)).slice(0,50)}`) }
  catch(e){ console.log(`  ${name.padEnd(16)} THREW: ${e.message}`) } }
console.log('\n=== round-trip fidelity through the wire ===')
const chk = (name,val) => { const a=new Y.Doc(); a.getMap('m').set('k',val)
  const b=new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); const out=b.getMap('m').get('k')
  console.log(`  ${name.padEnd(12)} in=${String(val)} out=${String(out)} sameType=${typeof val===typeof out} strictEqual=${Object.is(val,out)}`) }
chk('NaN',NaN); chk('Infinity',Infinity); chk('-0',-0); chk('undefined',undefined); chk('null',null)
chk('BigInt',1n); chk('Date',new Date(0)); chk('int',42); chk('float',1.5)
