import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WarehouseMapCanvas } from './WarehouseMapCanvas';

// Synthetic test fixture only; never used by the application or as live telemetry.
const layout = { width: 16, height: 10, cells: Array.from({ length: 10 }, () => Array(16).fill('aisle')), products: [], pick_faces: [] };
const robot = { id: 'R1', x: 15, y: 9, heading: 90, status: 'to_dock', color: '#8eafe4', battery: 72, path: [[15, 8]], target: [15, 8], carrying: [{ qty: 2 }] };

describe('warehouse renderer integration', () => {
  it('retains all logical cells, exact robot positioning, heading, payload and selection semantics', () => {
    const html = renderToStaticMarkup(createElement(WarehouseMapCanvas, { layout, robots: [robot], selectedRobotId: 'R1' }));
    expect(html.match(/class="tile-base tile-cell/g)).toHaveLength(160);
    expect(html).toContain('left:906px;top:546px;width:44px;height:44px');
    expect(html).toContain('rotate(90deg)');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Robot R1, to_dock, battery 72%"');
    expect(html).toContain('title="2 item(s)"');
    expect(html).toContain('M 928 568 L 928 508');
  });
  it('keeps heatmaps and policy arrows when route rendering is disabled', () => {
    const heatmap = { values: Array.from({ length: 160 }, () => [0, 1, 2, 3]) };
    const html = renderToStaticMarkup(createElement(WarehouseMapCanvas, { layout, robots: [robot], heatmap, layers: { qHeatmap: true, paths: false } }));
    expect(html.match(/class="heat-fill"/g)).toHaveLength(160);
    expect(html.match(/class="heat-arrow"/g)).toHaveLength(160);
    expect(html).not.toContain('class="trajectory-path"');
  });
});
