#!/usr/bin/env python3
"""Browser regression and adversarial checks. Requires Python playwright + Chromium.
Run against Vite: python scripts/audit-mfc.py http://127.0.0.1:5173/
The fixtures intercept requests inside the browser; no fixture results are published.
"""
import copy
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5173/').rstrip('/') + '/'
artifacts = Path(os.environ.get('MFC_AUDIT_DIR', '/tmp/mfc-audit'))
artifacts.mkdir(parents=True, exist_ok=True)
checks = []

def ok(name):
    checks.append(name)
    print('PASS', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '#/MFC')
    expect(page.get_by_role('button', name='Details for scc26-p3-cpu', exact=True)).to_be_visible()
    expect(page.get_by_role('heading', name='MFC · Simulation studies')).to_be_visible()
    expect(page.get_by_role('region', name='SCC26 practice tasks').get_by_role('link')).to_have_count(4)
    ok('real index renders and all four task guides are linked')
    for width in [320, 390, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'page overflow at {width}'
        page.screenshot(path=str(artifacts / f'page-{width}.png'), full_page=True)
    ok('no page overflow at 320, 390, 768 and 1440 pixels')
    page.keyboard.press('/')
    expect(page.get_by_role('searchbox', name='Search runs')).to_be_focused()
    page.get_by_role('searchbox').fill('scc26-p3')
    page.reload()
    expect(page.get_by_role('searchbox')).to_have_value('scc26-p3')
    expect(page.get_by_role('button', name='Details for scc26-p3-cpu', exact=True)).to_be_visible()
    page.get_by_role('searchbox').fill('no-such-run-xyz')
    expect(page.get_by_text('No runs match these filters.')).to_be_visible()
    page.get_by_role('button',name='Reset filters',exact=True).click()
    ok('search shortcut, URL persistence, empty state and reset')
    details = page.get_by_role('button', name='Details for scc26-p3-cpu', exact=True)
    details.click()
    dialog = page.get_by_role('dialog')
    expect(dialog).to_be_visible()
    expect(dialog.get_by_role('button',name='Video',exact=True)).to_be_visible()
    for _ in range(35):
        page.keyboard.press('Tab')
        assert page.evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)')
    page.keyboard.press('Shift+Tab')
    assert page.evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)')
    dialog.get_by_role('button',name='Video',exact=True).click()
    expect(dialog.locator('video')).to_have_count(1)
    assert dialog.locator('video').get_attribute('controls') is not None
    page.screenshot(path=str(artifacts / 'media.png'))
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    expect(details).to_be_focused()
    ok('details load, keyboard focus stays inside, Escape restores focus, video controls exist')
    page.get_by_role('button', name='Convergence', exact=True).click()
    # The live audit may already contain new measured points.
    expect(page.get_by_role('heading',name='Task 2 · Accuracy under refinement')).to_be_visible()
    page.goto(base + '#/HPL?cluster=xenon')
    expect(page.get_by_role('heading',name='HPL (CPU)',exact=True)).to_be_visible()
    page.goto(base + '#/HPL_NVIDIA?cluster=xenon')
    expect(page.get_by_role('heading',name='HPL NVIDIA (GPU)',exact=True)).to_be_visible()
    ok('convergence view and both HPL suite routes still render')

    fixture = {'clusters':[], 'suites':[], 'runs':[]}
    template = {'suite':'MFC','id':'xenon/MFC/audit/run','cluster':'xenon','group':'audit','run':'audit', 'status':'ok',
                'config':{'case':'advection_1d','gpu':'none','args':['--cfl','0.025'],'mfc_sha':'test','toolchain':'gcc'},
                'parameters':{'grid':'32','wenoOrder':5,'wenoEps':1e-16,'timeStepper':'RK3','equations':7,'surfaceTension':False},
                'verification':{'kind':'study','reason':'Browser fixture'}, 'ranking':{'eligible':False,'group':'advection_1d/CPU','reason':'Study'},
                'metric':{'value':3},'secondary':[{'key':'s_step','value':0.1}], 'raw':{},
                'convergence':{'N':32,'first':0,'last':100,'L1':1e-5,'L2':1e-5,'Linf':1e-5,'series':'one'}}
    for n in [32,64,128]:
        r = copy.deepcopy(template); r['id'] += str(n); r['run'] += str(n)
        r['convergence'].update(N=n,L1=1e-5*(32/n)**5,L2=1e-5*(32/n)**5,Linf=1e-5*(32/n)**5)
        fixture['runs'].append(r)
    page.route('**/data/index.json*', lambda route: route.fulfill(json=fixture))
    page.goto(base + '#/MFC?view=convergence')
    page.reload()
    expect(page.get_by_role('img',name='L2 error versus grid cells on logarithmic axes')).to_have_count(1)
    expect(page.get_by_role('cell',name='5.000',exact=True)).to_have_count(2)
    page.screenshot(path=str(artifacts/'convergence-fixture.png'),full_page=True)
    fixture['runs'][2]['convergence']['series']='different-cfl'
    page.reload()
    expect(page.get_by_role('img',name='L2 error versus grid cells on logarithmic axes')).to_have_count(2)
    expect(page.get_by_role('cell',name='5.000',exact=True)).to_have_count(1)
    fixture['runs'][1]['convergence']['N']=32
    page.reload()
    expect(page.get_by_text('Repeated resolutions:',exact=False)).to_be_visible()
    expect(page.get_by_role('cell',name='5.000',exact=True)).to_have_count(0)
    ok('measured log plot, order calculation, separate series and duplicate-resolution guard')

    for r in fixture['runs']:
        r.pop('convergence',None); r['ranking']['eligible']=True; r['verification']['kind']='benchmark'
    fixture['runs'][1]['parameters']['equations']=8
    page.goto(base+'#/MFC?sort=grind'); page.reload()
    expect(page.get_by_role('option',name='Grind (matching benchmarks only)')).to_be_disabled()
    page.get_by_role('checkbox',name='Compare audit32',exact=True).check(); page.get_by_role('checkbox',name='Compare audit64',exact=True).check()
    expect(page.get_by_text('Grind is not directly comparable:',exact=False)).to_be_visible()
    fixture['runs'][1]['parameters']['equations']=7
    page.reload()
    expect(page.get_by_role('option',name='Grind (matching benchmarks only)')).to_be_enabled()
    fixture['runs'][1]['cluster']='raijin'
    page.goto(base+'#/MFC?view=benchmarks'); page.reload()
    expect(page.get_by_role('heading',name='xenon · advection_1d · CPU')).to_be_visible()
    expect(page.get_by_role('heading',name='raijin · advection_1d · CPU')).to_be_visible()
    ok('mixed equation counts block sorting; matching counts allow it; clusters stay separate')

    r = fixture['runs'][0]
    r['run']='<img src=x onerror=window.__mfc_xss=1>'
    r['raw']={'evil.mp4':'javascript:alert(1)','escape.png':'raw/../index.html','encoded.png':'raw/%2e%2e/index.html','good.png':'raw/audit/missing.png'}
    r['detail']={'case':{'file':'case.py','raw':'<script>window.__mfc_xss=1</script>'}}
    fixture['runs']=[r]
    page.route('**/data/runs/**/run.json*',lambda route: route.fulfill(json=r))
    page.goto(base+'#/MFC'); page.reload()
    page.get_by_role('button',name='Details for '+r['run'],exact=True).click()
    dialog=page.get_by_role('dialog')
    expect(dialog.get_by_role('button',name='case.py',exact=True)).to_be_visible()
    assert page.evaluate('window.__mfc_xss') is None
    assert not dialog.locator('a[href^="javascript:"]').count()
    assert not dialog.get_by_role('link',name='escape.png',exact=True).count()
    assert not dialog.get_by_role('link',name='encoded.png',exact=True).count()
    dialog.get_by_role('button',name='case.py',exact=True).click()
    expect(dialog.locator('pre')).to_contain_text('<script>')
    dialog.get_by_role('button',name='Video',exact=True).click()
    expect(dialog.get_by_text('Preview unavailable in this browser.',exact=False)).to_be_visible()
    page.keyboard.press('Escape')
    ok('HTML is inert text, unsafe/traversal artifact URLs rejected, missing media has fallback')

    r['detail']={'out':{'file':'run.out','parsed':{'steps':{}}}}
    page.get_by_role('button',name='Details for '+r['run'],exact=True).click()
    expect(page.get_by_role('dialog').get_by_role('alert')).to_contain_text('Invalid run record')
    page.keyboard.press('Escape')
    fixture['runs']=[None,{'suite':'MFC','id':None}]; fixture['clusters']={}; fixture['suites']={}
    page.reload()
    expect(page.get_by_role('alert')).to_contain_text('Invalid MFC run record')
    page.unroute('**/data/index.json*')
    page.route('**/data/index.json*',lambda route: route.fulfill(status=503,body='Unavailable'))
    page.reload()
    expect(page.get_by_role('alert')).to_contain_text('HTTP 503')
    page.unroute('**/data/index.json*')
    page.route('**/data/index.json*',lambda route: route.fulfill(json={'runs':[],'clusters':[],'suites':[]}))
    page.get_by_role('button',name='Retry',exact=True).click()
    expect(page.get_by_text('No MFC results for this cluster yet.')).to_be_visible()
    ok('malformed records fail visibly; HTTP failure and retry recover')
    assert not errors, errors
    ok('no uncaught browser errors throughout audit')
    browser.close()
(artifacts/'results.json').write_text(json.dumps({'base':base,'checks':checks},indent=2)+'\n')
print(f'{len(checks)} audit groups passed; artifacts in {artifacts}')
