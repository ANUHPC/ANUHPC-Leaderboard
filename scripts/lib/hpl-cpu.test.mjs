import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateCpuHpl, cpuRanks } from './hpl-cpu.mjs';
const dat=fs.readFileSync('input/_TEMPLATES/HPL/HPL.dat','utf8');
const sb=(o)=>k=>o[k]??null;
test('2 x 2 template validates against four ranks',()=>assert.deepEqual(validateCpuHpl(dat,4),{errors:[],warnings:[]}));
test('a grid larger than the ranks would be skipped, so it fails',()=>assert.match(validateCpuHpl(dat,2).errors.join(),/skip them all/));
test('idle ranks warn rather than fail',()=>{const r=validateCpuHpl(dat,64);assert.deepEqual(r.errors,[]);assert.match(r.warnings.join(),/idle/);});
test('unknown rank count still checks the file',()=>{
 const lines=dat.split('\n');lines[12]='-1 threshold';lines[3]='7 device out';
 const r=validateCpuHpl(lines.join('\n'),null);assert.match(r.errors.join(),/residual/);assert.match(r.errors.join(),/device out/);
});
test('reject malformed grids',()=>{for(const raw of ['',dat.replace(/^2 +Ps/m,'x Ps')]) assert.ok(validateCpuHpl(raw,4).errors.length);});
test('ranks come from a literal -np, then --ntasks, then nodes x tasks-per-node',()=>{
 assert.equal(cpuRanks('mpirun -np 8 ./xhpl',sb({nodes:'1','ntasks-per-node':'4'})),8);
 assert.equal(cpuRanks('mpirun -np "${SLURM_NTASKS}" ./xhpl',sb({ntasks:'6'})),6);
 assert.equal(cpuRanks('mpirun ./xhpl',sb({nodes:'2','ntasks-per-node':'2'})),4);
 assert.equal(cpuRanks('mpirun ./xhpl',sb({})),null);
});
