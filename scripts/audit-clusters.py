#!/usr/bin/env python3
"""Browser checks for suite availability; fixtures never reach the published data."""
import copy
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5174/').rstrip('/') + '/'
fixture = json.loads((Path(__file__).resolve().parents[1] / 'public/data/index.json').read_text())
checks = []

def passed(name):
    checks.append(name)
    print('PASS', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/data/index.json*', lambda route: route.fulfill(json=fixture))
    page.goto(base + '#/HPL?cluster=raijin')
    nav = page.get_by_role('navigation', name='Leaderboard navigation')
    expect(nav.get_by_role('button', name='Raijin')).to_have_attribute('aria-pressed', 'true')
    hpl = next(s for s in fixture['suites'] if s['name'] == 'HPL')
    expect(nav.get_by_role('button', name='All clusters')).to_contain_text(str(hpl['count']))
    expect(nav.get_by_role('button', name='Xenon')).to_contain_text(str(hpl['countByCluster']['xenon']))
    passed('HPL cluster controls use suite counts')

    nav.get_by_role('link', name='HPL NVIDIA (GPU)').click()
    expect(page).to_have_url(base + '#/HPL_NVIDIA?cluster=xenon')
    expect(nav.get_by_role('button', name='Raijin')).to_have_count(0)
    expect(nav.get_by_label('Available cluster')).to_have_text('Xenon')
    expect(page.get_by_text('Not Run On This Cluster', exact=True)).to_have_count(0)
    nav.get_by_role('link', name='HPL (CPU)').click()
    expect(nav.get_by_role('button', name='Xenon')).to_have_attribute('aria-pressed', 'true')
    passed('switches resolve a supported destination and preserve valid cluster')

    for suite in ['HPL_NVIDIA', 'MFC']:
        page.goto(base + '#/' + suite + '?cluster=raijin&q=keep-me')
        expect(page).to_have_url(base + '#/' + suite + '?cluster=xenon&q=keep-me')
        expect(nav.get_by_role('button', name='Raijin')).to_have_count(0)
        expect(nav.get_by_label('Available cluster')).to_have_text('Xenon')
        page.reload()
        expect(nav.get_by_label('Available cluster')).to_have_text('Xenon')
    page.goto(base + '#/HPL?cluster=unknown&q=keep-me')
    expect(page).to_have_url(base + '#/HPL?q=keep-me')
    expect(nav.get_by_role('button', name='All clusters')).to_have_attribute('aria-pressed', 'true')
    passed('stale bookmarks repair only the cluster parameter and survive reload')

    page.goto(base + '#/HPL?cluster=raijin')
    nav.get_by_role('button', name='Xenon').click()
    page.go_back()
    expect(nav.get_by_role('button', name='Raijin')).to_have_attribute('aria-pressed', 'true')
    passed('cluster selection supports browser back')

    for suite in ['HPL', 'HPL_NVIDIA', 'MFC']:
        page.goto(base + '#/' + suite)
        expect(nav.get_by_role('link', name='HPL (CPU)')).to_be_visible()
        for width in [320, 390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            assert nav.evaluate('(el) => el.scrollWidth <= innerWidth'), (suite, width, 'navigation overflow')
            # The suite tabs scroll internally; keyboard users can reach each link.
            link = nav.get_by_role('link', name='MFC (Multi-component Flow Code)')
            link.focus()
            expect(link).to_be_focused()
    passed('navigation fits mobile and desktop; all suites remain keyboard-accessible')

    # A forged high score with a failed or missing residual cannot lead the board.
    original_runs = fixture['runs']
    sample = copy.deepcopy(next(r for r in original_runs if r['suite'] == 'HPL' and r.get('best')))
    injected = []
    for name, status, eligible, score in [('verified-gpu', 'ok', True, 100000), ('failed-gpu', 'failed-residual', False, 999999), ('unchecked-gpu', 'unverified-residual', False, 888888)]:
        row = copy.deepcopy(sample)
        row.update(id='xenon/HPL_NVIDIA/audit/' + name, suite='HPL_NVIDIA', cluster='xenon', group='audit', run=name, status=status, ranking={'eligible': eligible})
        row['metric']['value'] = score
        row['best']['gflops'] = score
        injected.append(row)
    fixture['runs'] = original_runs + injected
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.goto(base + '#/HPL_NVIDIA')
    page.reload()
    expect(page.get_by_text('verified-gpu', exact=True)).to_be_visible()
    expect(page.get_by_text('failed-gpu', exact=True)).to_have_count(0)
    expect(page.get_by_text('unchecked-gpu', exact=True)).to_have_count(0)
    page.locator('select').filter(has=page.locator('option[value="fail"]')).select_option('fail')
    expect(page.get_by_text('xenon/HPL_NVIDIA/audit/failed-gpu', exact=True)).to_be_visible()
    expect(page.get_by_text('xenon/HPL_NVIDIA/audit/unchecked-gpu', exact=True)).to_be_visible()
    expect(page.get_by_text('verified-gpu', exact=True)).to_have_count(0)
    fixture['runs'] = original_runs
    passed('failed and unverified residuals are excluded from performance rankings')

    # Hardware support alone must not add an empty cluster to this application.
    gpu = next(s for s in fixture['suites'] if s['name'] == 'HPL_NVIDIA')
    gpu['clusters'] = ['xenon', 'future']
    gpu['countByCluster']['future'] = 0
    fixture['clusters'].append({'name': 'future', 'label': 'Future', 'count': 27})
    page.goto(base + '#/HPL_NVIDIA?cluster=future')
    page.reload()
    expect(page).to_have_url(base + '#/HPL_NVIDIA?cluster=xenon')
    expect(nav.get_by_role('button', name='Future')).to_have_count(0)
    expect(nav.get_by_role('button', name='All clusters')).to_have_count(0)
    expect(nav.get_by_label('Available cluster')).to_have_text('Xenon')
    passed('clusters with no runs for this application stay hidden')

    # Its first recorded run makes the cluster selectable automatically.
    gpu['countByCluster']['future'] = 1
    page.reload()
    expect(nav.get_by_role('button', name='Future')).to_be_visible()
    expect(nav.get_by_role('button', name='Raijin')).to_have_count(0)
    nav.get_by_role('button', name='Future').click()
    expect(page).to_have_url(base + '#/HPL_NVIDIA?cluster=future')
    passed('the first application run reveals its cluster')

    gpu['countByCluster'] = {}
    gpu['count'] = 0
    fixture['runs'] = [r for r in fixture['runs'] if r['suite'] != 'HPL_NVIDIA']
    page.reload()
    expect(page).to_have_url(base + '#/HPL_NVIDIA')
    expect(nav.get_by_label('Available cluster')).to_have_count(0)
    expect(nav.get_by_role('button', name='All clusters')).to_have_count(0)
    expect(nav.get_by_role('button', name='Future')).to_have_count(0)
    passed('applications without recorded runs have no cluster row')

    assert not errors, errors
    passed('no browser runtime errors')
    browser.close()

print(f'{len(checks)} cluster audit groups passed')
