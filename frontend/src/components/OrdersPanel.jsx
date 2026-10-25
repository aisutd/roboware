import { Plus } from 'lucide-react';
import { Window } from './Window';

const STAGES = ['picking', 'packing', 'shipping', 'delivered'];
const STAGE_COLORS = {
  queued: 'var(--ink-3)', assigned: 'var(--ink-2)', picking: 'var(--orange)', packing: 'var(--blue)',
  shipping: 'var(--green)', delivered: 'var(--ink-3)', failed: 'var(--red)',
};

export function OrdersPanel({ orders, productNames, onInject, disabled }) {
  const active = orders.filter((o) => o.status !== 'delivered' && o.status !== 'failed').length;
  return (
    <Window
      title={`Orders (${active})`}
      className="operations-orders"
      actions={(
        <>
          <button type="button" className="clay-btn clay-pill-sm" disabled={disabled} onClick={() => onInject('normal')}><Plus size={12} /> Order</button>
          <button type="button" className="clay-btn clay-pill-sm" disabled={disabled} onClick={() => onInject('rush')}><Plus size={12} /> Rush</button>
        </>
      )}
      bodyStyle={{ paddingTop: 4 }}
    >
      {orders.length === 0 && <p className="muted" style={{ paddingTop: 8 }}>No orders yet.</p>}
      {orders.map((order) => {
        const reached = STAGES.filter((s) => order.timeline?.[s] !== undefined);
        return (
          <div key={order.id} className="order-row" data-status={order.status}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <strong>{order.id}</strong>
              {order.priority === 'rush' && <span className="badge badge-rush">Rush</span>}
              {order.robot_id && <span className="muted" style={{ fontSize: 12 }}>{order.robot_id}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: STAGE_COLORS[order.status], textTransform: 'capitalize' }}>{order.status}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>
              {order.items.map((i) => `${i.qty}× ${productNames[i.sku] ?? i.sku}`).join(', ')}
              {order.fail_reason && <span style={{ color: 'var(--red)' }}> ({order.fail_reason.replace('_', ' ')})</span>}
            </div>
            <div className="stage-track" role="img" aria-label={`Order ${order.id}: ${order.status}. Reached stages: ${reached.join(', ') || 'none'}`}>
              {STAGES.map((s) => <span key={s} title={s} style={reached.includes(s) ? { background: STAGE_COLORS[s] } : undefined} />)}
            </div>
            <div className="order-stage-labels">{STAGES.map((stage) => <span key={stage} className={order.status === stage ? 'current-stage' : ''}>{stage === 'shipping' ? 'Ship' : stage === 'delivered' ? 'Done' : stage === 'picking' ? 'Pick' : 'Pack'}</span>)}</div>
          </div>
        );
      })}
    </Window>
  );
}
