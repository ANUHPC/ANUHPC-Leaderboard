import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInp, summarizeInp } from './parse-inp.mjs';
test('Fortran numeric, logical and quoted values, preserving missing vs false', () => {
  const inp = parseInp('&user_inputs\nM = 31\nn = 0\np = 0\ndt = 1.25D-4\nviscous = .FALSE.\nsurface_tension = .TRUE.\nname = "test"\n&end/');
  assert.equal(inp.m,31); assert.equal(inp.dt,1.25e-4); assert.equal(inp.name,'test');
  const p = summarizeInp(inp);
  assert.equal(p.viscous,false); assert.equal(p.surfaceTension,true); assert.equal(p.bubbles,null);
  assert.equal(p.grid,'32'); assert.equal(p.equations,null);
  assert.equal(summarizeInp(parseInp('m = 31')).cells,null);
});
test('surface tension increases the supported 5-equation count; advanced models stay unknown', () => {
  const inp={m:239,n:59,p:0,model_eqns:2,num_fluids:2,surface_tension:false};
  assert.equal(summarizeInp(inp).equations,7);
  assert.equal(summarizeInp({...inp,surface_tension:true}).equations,8);
  assert.equal(summarizeInp({...inp,mhd:true}).equations,null);
});
