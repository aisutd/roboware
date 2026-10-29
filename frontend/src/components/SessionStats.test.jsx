import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionStats } from './SessionStats';

const orders = ['queued', 'picking', 'packing', 'shipping', 'delivered', 'failed'].map((status, i) => ({ id: `O${i}`, status }));
const values = (html) => [...html.matchAll(/class="stat-tile-value">([^<]*)/g)].map((m) => m[1]);

describe('session stats', () => {
  it('shows deliveries, average order time in whole seconds and active orders', () => {
    // 28.4 ticks at 0.6 s per tick = 17.04 s -> 17
    const html = renderToStaticMarkup(createElement(SessionStats, { stats: { delivered: 12, avg_cycle_time: 28.4 }, orders }));
    expect(values(html)).toEqual(['12', '17', '4']);
    expect(html).toContain('<small>s</small>');
  });
  it('shows a dash for the average before any order is delivered', () => {
    const html = renderToStaticMarkup(createElement(SessionStats, { stats: { delivered: 0, avg_cycle_time: null }, orders: [] }));
    expect(values(html)).toEqual(['0', '–', '0']);
    expect(html).not.toContain('<small>s</small>');
  });
});
