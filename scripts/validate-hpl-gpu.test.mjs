import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('GPU submissions are cluster-scoped and job.yml cannot bypass Slurm checks', async () => {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'gpu-validation-'));
  try {
    for(const d of ['scripts','suites','clusters']) await fs.cp(d,path.join(tmp,d),{recursive:true});
    const dat=await fs.readFile('input/_TEMPLATES/HPL_NVIDIA/HPL.dat');
    const script=await fs.readFile('input/_TEMPLATES/HPL_NVIDIA/run.xenon.sh','utf8');
    for(const [cluster,raw,pattern] of [['xenon',script,null],['raijin',script,/available only on xenon/],['xenon',script.replace('--gres=gpu:a100:4','--gres=gpu:a100:2'),/one GPU per MPI rank/]]) {
      const dir=`input/${cluster}/HPL_NVIDIA/test/run`;
      await fs.mkdir(path.join(tmp,dir),{recursive:true});
      await fs.writeFile(path.join(tmp,dir,'HPL.dat'),dat);
      await fs.writeFile(path.join(tmp,dir,'run.sh'),raw);
      await fs.writeFile(path.join(tmp,dir,'job.yml'),'suite: HPL_NVIDIA\n');
      const out=spawnSync(process.execPath,['scripts/validate-job.mjs',dir],{cwd:tmp,encoding:'utf8'});
      if(pattern) { assert.equal(out.status,1);assert.match(out.stdout+out.stderr,pattern); }
      else assert.equal(out.status,0,out.stderr);
    }
  } finally {await fs.rm(tmp,{recursive:true,force:true});}
});
