import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
test('index generation retains MFC settings, verification and measured errors', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfc-index-'));
    try {
        await fs.mkdir(path.join(root, 'scripts'));
        await fs.copyFile('scripts/generate-index.mjs', path.join(root,'scripts/generate-index.mjs'));
        const dir=path.join(root,'public/data/runs/xenon/MFC/test/n32'); await fs.mkdir(dir,{recursive:true});
        const data={parameters:{grid:'32',surfaceTension:false}, verification:{kind:'study'}, convergence:{N:32,L2:1e-6},status:'ok',ranking:{eligible:false},metric:{value:1}};
        await fs.writeFile(path.join(dir,'run.json'),JSON.stringify(data));
        execFileSync(process.execPath,['scripts/generate-index.mjs'],{cwd:root});
        const index=JSON.parse(await fs.readFile(path.join(root,'public/data/index.json'),'utf8'));
        for (const key of ['parameters','verification','convergence']) assert.deepEqual(index.runs[0][key],data[key]);
        assert.equal(index.runs[0].rank,null);
    } finally { await fs.rm(root,{recursive:true,force:true}); }
});
