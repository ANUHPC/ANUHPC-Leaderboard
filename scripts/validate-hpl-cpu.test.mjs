import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('CPU HPL templates validate on their own cluster, launchpad included', async () => {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'cpu-validation-'));
  try {
    for(const d of ['scripts','suites','clusters']) await fs.cp(d,path.join(tmp,d),{recursive:true});
    const dat=await fs.readFile('input/_TEMPLATES/HPL/HPL.dat');
    const launchpad=await fs.readFile('input/_TEMPLATES/HPL/run.launchpad.sh','utf8');
    for(const [cluster,raw,pattern] of [
      ['launchpad',launchpad,null],
      ['xenon',await fs.readFile('input/_TEMPLATES/HPL/run.xenon.sh','utf8'),null],
      ['launchpad',launchpad.replace('--cpus-per-task=16','--cpus-per-task=32'),/128 cores per node/],
      ['launchpad',launchpad.replace('--ntasks-per-node=4','--ntasks-per-node=2').replace('--cpus-per-task=16','--cpus-per-task=32'),/skip them all/],
      ['launchpad',launchpad.replace('--partition=all','--partition=cpu'),/does not exist on launchpad/],
    ]) {
      const dir=`input/${cluster}/HPL/test/run`;
      await fs.rm(path.join(tmp,'input'),{recursive:true,force:true});
      await fs.mkdir(path.join(tmp,dir),{recursive:true});
      await fs.writeFile(path.join(tmp,dir,'HPL.dat'),dat);
      await fs.writeFile(path.join(tmp,dir,'run.sh'),raw);
      const out=spawnSync(process.execPath,['scripts/validate-job.mjs',dir],{cwd:tmp,encoding:'utf8'});
      if(pattern) { assert.equal(out.status,1,out.stdout);assert.match(out.stdout+out.stderr,pattern); }
      else assert.equal(out.status,0,out.stdout+out.stderr);
    }
  } finally {await fs.rm(tmp,{recursive:true,force:true});}
});
