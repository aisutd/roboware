import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GettingStarted } from './GettingStarted';
import { NewSessionDialog } from './NewSessionDialog';

const noop = () => {};
describe('guided simulation setup', () => {
  it('defaults to no-training navigation while preserving all advanced settings', () => {
    const html = renderToStaticMarkup(createElement(NewSessionDialog, { open: true, onClose: noop, onCreated: noop }));
    expect(html).toMatch(/name="routing_mode" checked="" value="astar"/);
    expect(html).toContain('4 robots');
    expect(html).toContain('No training needed');
    expect(html.match(/class="setup-crew-pet"/g)).toHaveLength(4);
    expect(html).toContain('<details class="advanced-options">');
    for (const label of ['Rush order share', 'Repeatable order pattern', '% 1-item orders', '% 2-item', '% 3-item', 'Stop condition', 'Keep learning during the session']) expect(html).toContain(label);
  });
  it('restores the fleet and stop settings when returning from training', () => {
    const html = renderToStaticMarkup(createElement(NewSessionDialog, {
      open: true, onClose: noop, onCreated: noop, initialModelId: 'model-from-training', initialLayoutId: 'custom-layout',
      initialDraft: { robot_count: 7, stop_value: 600, routing_mode: 'q_only', seed: 1337 },
    }));
    expect(html).toContain('7 robots');
    expect(html).toContain('600 steps');
    expect(html).toMatch(/name="routing_mode" checked="" value="q_only"/);
    expect(html).toContain('Pick a trained model');
    expect(html).toContain('value="1337"');
  });
  it('explains simulation boundaries and exposes all six workflow steps inline', () => {
    const html = renderToStaticMarkup(createElement(GettingStarted, { onNavigate: noop, onConfigure: noop }));
    expect(html.match(/<li>/g)).toHaveLength(6);
    expect(html).toContain('does not connect to or control physical robots');
    expect(html).toContain('Train AI, if needed');
    expect(html).toContain('Analyze performance');
  });
});
