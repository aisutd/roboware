import { describe, expect, it } from 'vitest';
import { initialSessionState, sessionReducer, streamUrl } from './sessionStream';

const frame = (tick, events = []) => ({
  type: 'frame', tick, finished: false, robots: [{ id: 'R1' }], orders: [], stations: [], stock: {}, stats: { tick },
  events, session: { id: 's1', status: 'running' },
});

describe('sessionReducer', () => {
  it('stores the layout from the snapshot and keeps it across frames', () => {
    let state = sessionReducer(initialSessionState, { ...frame(0), type: 'snapshot', layout: { width: 16 } });
    expect(state.layout.width).toBe(16);
    state = sessionReducer(state, frame(1));
    expect(state.layout.width).toBe(16);
    expect(state.tick).toBe(1);
    expect(state.session.status).toBe('running');
  });

  it('prepends events newest first and caps the history', () => {
    let state = sessionReducer(initialSessionState, { ...frame(0), type: 'snapshot', layout: {} });
    for (let i = 1; i <= 60; i += 1) state = sessionReducer(state, frame(i, [{ type: 'delivered', n: i }]));
    expect(state.recentEvents).toHaveLength(50);
    expect(state.recentEvents[0].n).toBe(60);
  });

  it('remembers each robot\'s latest pick, pack, delivery or charge for its happy face', () => {
    let state = sessionReducer(initialSessionState, { ...frame(0), type: 'snapshot', layout: {} });
    state = sessionReducer(state, frame(5, [{ type: 'picked', robot: 'R1' }, { type: 'order_created', order: 'O1' }]));
    state = sessionReducer(state, frame(9, [{ type: 'delivered', robot: 'R2' }, { type: 'fallback', robot: 'R1' }]));
    expect(state.robotCheers).toEqual({ R1: { type: 'picked', tick: 5 }, R2: { type: 'delivered', tick: 9 } });
    const unchanged = sessionReducer(state, frame(10));
    expect(unchanged.robotCheers).toBe(state.robotCheers);
    expect(sessionReducer(state, { ...frame(0), type: 'snapshot', layout: {} }).robotCheers).toEqual({});
  });

  it('tracks connection state and errors', () => {
    let state = sessionReducer(initialSessionState, { type: 'connected' });
    expect(state.connected).toBe(true);
    state = sessionReducer(state, { type: 'error', message: 'boom' });
    expect(state.error).toBe('boom');
    expect(sessionReducer(state, { type: 'reset' })).toEqual(initialSessionState);
  });
});

describe('streamUrl', () => {
  it('uses ws or wss to match the page', () => {
    expect(streamUrl('s1', { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/api/sessions/s1/stream');
    expect(streamUrl('s1', { protocol: 'https:', host: 'x.dev' })).toBe('wss://x.dev/api/sessions/s1/stream');
  });
});
