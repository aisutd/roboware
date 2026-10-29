import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrdersPanel } from './OrdersPanel';
import { RobotsPanel } from './RobotsPanel';

const robot = (id, battery, patch = {}) => ({ id, color: '#ff5a26', status: 'to_pick', battery, heading: 0, x: 0, y: 0, ...patch });

describe('robots tab', () => {
  it('lights one battery cell per 20% and shows details only for the selected robot', () => {
    const html = renderToStaticMarkup(createElement(RobotsPanel, {
      robots: [robot('R1', 100, { order_id: 'ORD-0007', target: [3, 1] }), robot('R2', 41), robot('R3', 5)],
      selectedRobotId: 'R1', onSelectRobot: () => {}, productNames: {},
    }));
    const lit = [...html.matchAll(/pixel-battery-cells">(.*?)<\/span><span class="pixel-battery-value/g)].map((m) => (m[1].match(/class="on"/g) ?? []).length);
    expect(lit).toEqual([5, 3, 1]);
    expect(html).toContain('battery-critical');
    expect(html.match(/class="fleet-chips"/g)).toHaveLength(1);
    expect(html).toContain('ORD-0007');
    expect(html).toContain('→ D2');
  });
});

describe('orders tab', () => {
  const order = (n, status, timeline) => ({ id: `ORD-${String(n).padStart(4, '0')}`, status, items: [{ sku: 'S', qty: 1 }], timeline });
  it('lists open orders newest first, then only the five most recently finished', () => {
    const finished = Array.from({ length: 7 }, (_, i) => order(i + 1, 'delivered', { picking: i, delivered: 10 + i }));
    const html = renderToStaticMarkup(createElement(OrdersPanel, {
      orders: [...finished, order(20, 'packing', { picking: 30, packing: 35 }), order(21, 'queued', {})],
      productNames: { S: 'Stapler' }, onInject: () => {},
    }));
    const ids = [...html.matchAll(/class="ticket-id">#(\d+)/g)].map((m) => Number(m[1]));
    expect(ids).toEqual([21, 20, 7, 6, 5, 4, 3]);
    expect(html).toContain('Orders <span class="win-count">2</span>');
  });
  it('lights the reached stages and marks the current one', () => {
    const html = renderToStaticMarkup(createElement(OrdersPanel, {
      orders: [order(1, 'packing', { picking: 3, packing: 8 })], productNames: {}, onInject: () => {},
    }));
    expect(html).toContain('stage-picking on');
    expect(html).toContain('stage-packing on current');
    expect(html).not.toContain('stage-shipping on');
  });
});

describe('who is on each order', () => {
  const order = (id, status, robotId) => ({ id, status, robot_id: robotId, items: [{ sku: 'S', qty: 1 }], timeline: { picking: 1 } });
  const robots = [robot('R2', 80, { color: '#2563eb', order_id: 'ORD-0002' })];

  it('shows the assigned robot\'s pet in a panel coloured like the robot, and a ghost while unassigned', () => {
    const html = renderToStaticMarkup(createElement(OrdersPanel, {
      orders: [order('ORD-0002', 'picking', 'R2'), order('ORD-0003', 'queued', null)],
      robots, selectedRobotId: 'R2', productNames: {}, onInject: () => {},
    }));
    expect(html).toContain('style="--robot:#2563eb"');
    expect(html).toMatch(/class="ticket-robot-panel"[^>]*>.*?robot-pet.*?class="ticket-robot-id">R2</);
    expect(html).toContain('ticket-selected');
    expect(html).toMatch(/ticket-robot-panel empty[^>]*title="Waiting for a free robot"/);
    expect(html).toContain('class="ticket-ghost"');
  });

  it('tags each robot card with its order in the order\'s stage colour', () => {
    const html = renderToStaticMarkup(createElement(RobotsPanel, {
      robots, selectedRobotId: 'R2', onSelectRobot: () => {}, productNames: {}, orders: [order('ORD-0002', 'packing', 'R2')],
    }));
    expect(html).toMatch(/class="fleet-order stage-packing on"[^>]*>.*?#0002/);
  });
});

describe('collapsible panels and completed orders', () => {
  const order = (id, status) => ({ id, status, items: [{ sku: 'S', qty: 1 }], timeline: { picking: 1, delivered: 9 } });
  it('folds a panel behind its title toggle and keeps the body out of keyboard reach', () => {
    const open = renderToStaticMarkup(createElement(OrdersPanel, { orders: [], productNames: {}, onInject: () => {} }));
    expect(open).toContain('aria-expanded="true"');
    const folded = renderToStaticMarkup(createElement(OrdersPanel, { orders: [], productNames: {}, onInject: () => {}, collapsed: true }));
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).toContain('is-collapsed');
    expect(folded).toMatch(/class="win-collapse"[^>]*inert=""/);
    // The add-order buttons stay usable while folded.
    expect(folded).toMatch(/class="win-actions"><button type="button" class="px-btn px-small px-icon-btn"[^>]*aria-label="Add an order"/);
  });
  it('stamps delivered orders COMPLETED, and only those', () => {
    const html = renderToStaticMarkup(createElement(OrdersPanel, {
      orders: [order('ORD-0001', 'delivered'), order('ORD-0002', 'packing')], productNames: {}, onInject: () => {},
    }));
    expect(html.match(/class="ticket-stamp">Completed</g)).toHaveLength(1);
  });
});
