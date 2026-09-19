import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateGpuHpl } from './hpl-gpu.mjs';
const dat=fs.readFileSync('input/_TEMPLATES/HPL_NVIDIA/HPL.dat','utf8');
const cluster={partitions:{gpu:{nodes:['g1','g2']}},nodes:{g1:{gpus:4},g2:{gpus:4}}};
const defaults={nodes:'2','ntasks-per-node':'4',gres:'gpu:a100:4',partition:'gpu'};
const check=(d=dat,over={})=>validateGpuHpl(d,k=>({...defaults,...over})[k]??null,cluster);
test('eight-GPU template validates',()=>assert.deepEqual(check(),[]));
test('reject unsupported partition, mismatched rank/GPU counts and excessive GPU count',()=>{
 for(const over of [{partition:'cpu'},{gres:'gpu:2'},{nodes:'0'},{'ntasks-per-node':'5',gres:'gpu:5'},{ntasks:'4'}]) assert.ok(check(dat,over).length);
});
test('reject process grid mismatch and disabled residuals',()=>{
 const lines=dat.split('\n');lines[11]='1 Qs'; assert.match(check(lines.join('\n')).join(),/P × Q/);
 lines[11]='2 Qs';lines[12]='-1 threshold';assert.match(check(lines.join('\n')).join(),/residual/);
});
test('reject malformed dat rather than submitting a doomed run',()=>{
 for(const raw of ['',dat.replace('184320       Ns','garbage Ns'),dat.replace('512          NBs','0 NBs')]) assert.ok(check(raw).length);
});
