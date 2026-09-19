#!/usr/bin/env python3
"""Check XY hit testing, overlapping runs, touch/keyboard use and detail links."""
import copy
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5174/').rstrip('/') + '/'
root = Path(__file__).resolve().parents[1]
fixture = json.loads((root / 'public/data/index.json').read_text())
sample = next(r for r in fixture['runs'] if r['suite'] == 'HPL' and r.get('status') == 'ok')
rows = []
for name, cluster, n, nb, score in [
    ('lower & exact', 'xenon', 10000, 128, 100),
    ('upper', 'xenon', 10000, 256, 200),
    ('overlap', 'xenon', 10000, 256, 100),
    ('another-cluster', 'raijin', 20000, 128, 300),
]:
    row = copy.deepcopy(sample)
    row.update(id=f'{cluster}/HPL/chart-audit/{name}', suite='HPL', cluster=cluster, group='chart-audit', run=name,
               best={'N': n, 'NB': nb, 'gflops': score, 'timeSec': 2}, status='ok', ranking={'eligible': True})
    row['metric']['value'] = score
    rows.append(row)
fixture['runs'] = rows
for s in fixture['suites']:
    s['countByCluster'] = {'xenon': 3, 'raijin': 1} if s['name'] == 'HPL' else {}
    s['count'] = sum(s['countByCluster'].values())
checks = []
def ok(name):
    checks.append(name)
    print('PASS', name, flush=True)

def center(locator):
    b = locator.bounding_box()
    assert b
    return b['x'] + b['width']/2, b['y'] + b['height']/2

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1050})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/data/index.json*', lambda route: route.fulfill(json=fixture))
    def detail(route):
        if '/missing/' in route.request.url:
            route.fulfill(status=404, body='Not found')
            return
        row = rows[0]
        route.fulfill(json={**row, 'out': {'runs': [row['best']], 'summary': {'testsTotal': 1, 'testsPassed': 1, 'testsFailed': 0, 'testsSkipped': 0}}})
    page.route('**/data/runs/**/run.json', detail)
    page.goto(base + '#/HPL')
    chart = page.get_by_role('region', name='Performance vs matrix size', exact=True)
    nb = page.get_by_role('region', name='Performance vs block size', exact=True)
    lower = chart.locator('[data-point="10000/100"]')
    upper = chart.locator('[data-point="10000/200"]')
    lower.scroll_into_view_if_needed()
    x, y = center(lower)
    page.mouse.move(x+9, y+3)
    expect(chart.get_by_role('link', name='xenon · chart-audit/lower & exact', exact=True)).to_be_visible()
    expect(chart.get_by_role('link', name='xenon · chart-audit/overlap', exact=True)).to_be_visible()
    expect(chart.get_by_role('link', name='xenon · chart-audit/upper', exact=True)).to_have_count(0)
    expect(chart.locator('[data-testid="chart-crosshair"] line')).to_have_count(2)
    page.mouse.move(*center(upper))
    expect(chart.get_by_role('link', name='xenon · chart-audit/upper', exact=True)).to_be_visible()
    expect(chart.get_by_role('link', name='xenon · chart-audit/overlap', exact=True)).to_have_count(0)
    ok('XY hover selects the nearby run, with crosshairs and all exact overlaps')

    point = nb.locator('[data-point="128/100"]')
    page.mouse.move(*center(point))
    expect(nb.get_by_role('link', name='xenon · chart-audit/lower & exact', exact=True)).to_be_visible()
    page.mouse.move(*center(nb.locator('[data-point="128/300"]')))
    expect(nb.get_by_role('link', name='raijin · chart-audit/another-cluster', exact=True)).to_be_visible()
    ok('NB selection uses both axes and identifies the cluster')

    lower.click()
    page.mouse.move(0, 0)
    expect(chart.get_by_role('link', name='xenon · chart-audit/lower & exact', exact=True)).to_be_visible()
    chart.get_by_role('link', name='xenon · chart-audit/lower & exact', exact=True).click()
    expect(page).to_have_url(base+'#/HPL/xenon/chart-audit/lower%20%26%20exact')
    expect(page.get_by_role('heading', name='Run Details', exact=True)).to_be_visible()
    page.keyboard.press('Escape')
    expect(page).to_have_url(base+'#/HPL')
    upper.focus()
    page.keyboard.press('Enter')
    expect(chart.get_by_role('link', name='xenon · chart-audit/upper', exact=True)).to_be_visible()
    page.keyboard.press('Escape')
    expect(chart.get_by_role('link')).to_have_count(0)
    ok('pinned selection, encoded detail link and keyboard selection work')

    # Best-per-group must not hide the same group's submission on another cluster.
    table = page.get_by_role('table')
    expect(table.get_by_text('upper', exact=True)).to_be_visible()
    expect(table.get_by_text('another-cluster', exact=True)).to_be_visible()
    ok('best-per-group keeps the results from each cluster')

    for width in [320, 390, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 1000})
        page.wait_for_timeout(150)
        assert chart.evaluate('(el) => el.scrollWidth <= el.clientWidth'), width
        labels = chart.locator('svg text').all_text_contents()
        assert 'Matrix size (N)' in labels and 'GFLOP/s' in labels
        assert not any('.' in label for label in labels), labels
    ok('mobile charts fit their cards and use rounded, labelled axes')

    # A filter can reduce a multi-point chart to a single point or no chart.
    search = page.get_by_role('textbox', name='Search', exact=True)
    search.fill('another-cluster')
    expect(chart.locator('[data-point]')).to_have_count(1)
    search.fill('no-such-run')
    expect(chart).to_have_count(0)
    search.fill('')
    expect(chart.locator('[data-point]')).to_have_count(3)
    expect(chart.get_by_role('link')).to_have_count(0)
    ok('single/empty results and filter resets avoid stale hover or hook errors')
    # Nearly coincident targets must not steal focus/selection from their neighbour.
    rows[1]['best']['gflops'] = 100.5
    page.reload()
    expect(chart.locator('[data-point="10000/100.5"]')).to_be_visible()
    lower.scroll_into_view_if_needed()
    page.mouse.click(*center(lower))
    expect(chart.get_by_role('link', name='xenon · chart-audit/lower & exact', exact=True)).to_be_visible()
    expect(chart.get_by_role('link', name='xenon · chart-audit/upper', exact=True)).to_have_count(0)
    page.mouse.click(*center(chart.locator('[data-point="10000/100.5"]')))
    expect(chart.get_by_role('link', name='xenon · chart-audit/upper', exact=True)).to_be_visible()
    rows[1]['best']['gflops'] = 200
    ok('nearby SVG targets cannot override the closest XY selection')

    page.goto(base + '#/HPL/xenon/chart-audit/missing')
    expect(page.get_by_text('Error loading run details', exact=True)).to_be_visible()
    page.goto(base + '#/HPL/xenon/chart-audit/lower%20%26%20exact')
    expect(page.get_by_text('chart-audit / lower & exact', exact=True)).to_be_visible()
    expect(page.get_by_text('Error loading run details', exact=True)).to_have_count(0)
    ok('a failed detail request does not poison the next successful selection')

    touch = browser.new_page(viewport={'width': 390, 'height': 900}, has_touch=True)
    touch.route('**/data/index.json*', lambda route: route.fulfill(json=fixture))
    touch.on('pageerror', lambda e: errors.append(str(e)))
    touch.goto(base + '#/HPL')
    touch_chart = touch.get_by_role('region', name='Performance vs matrix size', exact=True)
    touch_chart.locator('[data-point="10000/100"]').tap()
    expect(touch_chart.get_by_role('link', name='xenon · chart-audit/lower & exact', exact=True)).to_be_visible()
    expect(touch_chart.get_by_role('button', name='Clear', exact=True)).to_be_visible()
    touch_chart.get_by_role('button', name='Clear', exact=True).tap()
    expect(touch_chart.get_by_role('link')).to_have_count(0)
    touch.close()
    ok('touch selects overlapping runs and clears a pinned point')

    assert not errors, errors
    browser.close()
print(f'{len(checks)} chart audit groups passed')
