import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WarehouseMapCanvas } from './WarehouseMapCanvas';

// Synthetic test fixture only; never used by the application or as live telemetry.
const layout = { width: 16, height: 10, cells: Array.from({ length: 10 }, () => Array(16).fill('aisle')), products: [], pick_faces: [] };
const robot = { id: 'R1', x: 15, y: 9, heading: 90, status: 'to_dock', color: '#8eafe4', battery: 72, path: [[15, 8]], target: [15, 8], carrying: [{ qty: 2 }] };

describe('warehouse renderer integration', () => {
  it('retains all logical cells, exact robot positioning, payload and selection semantics', () => {
    const html = renderToStaticMarkup(createElement(WarehouseMapCanvas, { layout, robots: [robot], selectedRobotId: 'R1' }));
    expect(html.match(/class="tile-base tile-cell/g)).toHaveLength(160);
    expect(html).toContain('left:906px;top:546px;width:44px;height:44px');
    // Robots are a pixel pet in their own colour and stay upright whatever their heading.
    // This one is travelling to the dock heading down, so it walks and glances down.
    expect(html).toContain('class="robot-art robot-pet pet-walking"');
    expect(html).toContain('data-face="walk"');
    expect(html).toContain('<rect x="3" y="1.25" width="1" height="1"');
    expect(html).toMatch(/<path d="M2 0h1v1h-1z[^"]*" style="fill:#8eafe4">/);
    // The selection ring takes the robot's own colour.
    expect(html).toContain('class="robot-puck selected" style="--robot:#8eafe4;');
    expect(html).not.toContain('rotate(');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Robot R1, to_dock, battery 72%"');
    expect(html).toContain('title="2 item(s)"');
    expect(html).toContain('M 928 568 L 928 508');
  });
  it('hides the grid and coordinate labels by default and shows them when the grid is on', () => {
    const rackLayout = { ...layout, cells: layout.cells.map((row, y) => (y === 0 ? ['rack', ...row.slice(1)] : row)) };
    const hidden = renderToStaticMarkup(createElement(WarehouseMapCanvas, { layout: rackLayout }));
    expect(hidden).toContain('map-grid-hidden');
    expect(hidden).not.toContain('class="coord-label"');
    expect(hidden).not.toContain('class="tile-location"');
    const shown = renderToStaticMarkup(createElement(WarehouseMapCanvas, { layout: rackLayout, initialShowGrid: true }));
    expect(shown).not.toContain('map-grid-hidden');
    expect(shown.match(/class="coord-label"/g)).toHaveLength(26);
    expect(shown).toContain('class="tile-location">A1</span>');
  });
  it('keeps heatmaps and policy arrows when route rendering is disabled', () => {
    const heatmap = { values: Array.from({ length: 160 }, () => [0, 1, 2, 3]) };
    const html = renderToStaticMarkup(createElement(WarehouseMapCanvas, { layout, robots: [robot], heatmap, layers: { qHeatmap: true, paths: false } }));
    expect(html.match(/class="heat-fill"/g)).toHaveLength(160);
    expect(html.match(/class="heat-arrow"/g)).toHaveLength(160);
    expect(html).not.toContain('class="trajectory-path"');
  });
});

describe('dozing robots', () => {
  const idle = { id: 'R2', x: 0, y: 0, heading: 0, status: 'idle', color: '#2563eb', battery: 90, path: [], carrying: [] };
  it('fade, close their eyes and puff a zzZ when they have nothing to do', () => {
    const html = renderToStaticMarkup(createElement(WarehouseMapCanvas, { layout, robots: [idle] }));
    expect(html).toContain('pet-snooze');
    expect(html).toContain('data-face="snooze"');
    expect(html.match(/class="pet-z z\d"/g)).toHaveLength(3);
    expect(html).toContain('color-mix(in srgb, #2563eb 40%, #46515c)');
  });
  it('wake up as soon as they get an order', () => {
    const html = renderToStaticMarkup(createElement(WarehouseMapCanvas, { layout, robots: [{ ...idle, status: 'to_pick', order_id: 'ORD-0001' }] }));
    expect(html).not.toContain('pet-snooze');
    expect(html).not.toContain('pet-zzz');
  });
});
