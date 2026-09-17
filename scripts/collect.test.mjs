import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
test('MFC metadata reaches run.json, index.json and downloadable artifacts', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'mfc-pipeline-'));
  try {
    for (const d of ['scripts','suites','clusters']) await fs.cp(d,path.join(tmp,d),{recursive:true});
    const dir=path.join(tmp,'output/xenon/MFC/test/run'); await fs.mkdir(dir,{recursive:true});
    const data={ 'case.py':'print("test")', 'job.yml':'suite: MFC\nbuild:\n  gpu: none\n',
      'simulation.inp':'m = 31\nn = 0\np = 0\nviscous = F\n', 'time_data.dat':'1 0.1 2', 'mfc-status.yml':'state: COMPLETED',
      'mfc-provenance.json':JSON.stringify({case_source:'custom',mfc_sha:'e2f0e267',case_sha256:createHash('sha256').update('print("test")').digest('hex')}) };
    for (const [name,body] of Object.entries(data)) await fs.writeFile(path.join(dir,name),body);
    execFileSync(process.execPath,['scripts/collect.mjs'],{cwd:tmp,env:{...process.env,WEBSITE_DATA_DIR:path.join(tmp,'site')},stdio:'pipe'});
    const read=async p=>JSON.parse(await fs.readFile(path.join(tmp,'site/data',p),'utf8'));
    const r=await read('runs/xenon/MFC/test/run/run.json'), index=await read('index.json');
    assert.equal(r.parameters.grid,'32'); assert.equal(r.verification.kind,'custom');
    assert.deepEqual(index.runs[0].parameters,r.parameters); assert.deepEqual(index.runs[0].verification,r.verification);
    assert.equal(await fs.readFile(path.join(tmp,'site',r.raw['simulation.inp']),'utf8'),data['simulation.inp']);
  } finally { await fs.rm(tmp,{recursive:true,force:true}); }
});
