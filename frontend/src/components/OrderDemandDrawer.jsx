import { useState } from 'react';

const STAGES = ['picking', 'packing', 'shipping', 'delivered'];
const STAGE_COLORS = { queued: '#B8B0A2', assigned: '#736B5F', picking: '#FF5A26', packing: '#2563EB', shipping: '#10B981', delivered: '#8E8578', failed: '#EF4444' };

function Kpi({ label, value, color }) {
  return (
    <div className="clay-card-flat stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={{ color, fontSize: 15 }}>{value ?? '—'}</span>
    </div>
  );
}

export function OrderDemandDrawer({ orders, stats, productNames, onInject, disabled }) {
  const [collapsed, setCollapsed] = useState(false);
  const active = orders.filter((o) => o.status !== 'delivered' && o.status !== 'failed').length;
  return (
    <div className="clay-card hud" style={{ top: 20, right: 20, width: collapsed ? 'auto' : 360, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : 12 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em' }}>ORDERS <span className="badge">{active} ACTIVE</span></span>
        <button type="button" className="clay-btn clay-pill-sm" style={{ fontSize: 10 }} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▲ EXPAND' : '▼ HIDE'}
        </button>
      </div>
      {!collapsed && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            <Kpi label="Delivered" value={stats?.delivered} color="#10B981" />
            <Kpi label="Per 100 ticks" value={stats?.throughput_per_100} color="#FF5A26" />
            <Kpi label="Avg cycle" value={stats?.avg_cycle_time} color="#2563EB" />
            <Kpi label="Waits" value={stats?.wait_events} color="#F59E0B" />
            <Kpi label="Fallbacks" value={stats?.fallbacks} color="#9333EA" />
            <Kpi label="Failed" value={stats?.failed} color="#EF4444" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" className="clay-btn clay-pill-sm clay-btn-accent" style={{ flex: 1, fontSize: 11 }} disabled={disabled} onClick={() => onInject('normal')}>+ Order</button>
            <button type="button" className="clay-btn clay-pill-sm" style={{ flex: 1, fontSize: 11 }} disabled={disabled} onClick={() => onInject('rush')}>+ Rush order</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
            {orders.length === 0 && <span style={{ fontSize: 12, color: '#8E8578' }}>No orders yet.</span>}
            {orders.map((order) => {
              const reached = STAGES.filter((s) => order.timeline?.[s] !== undefined);
              return (
                <div key={order.id} className="clay-card-flat" style={{ padding: '8px 10px', opacity: order.status === 'delivered' ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span className="font-mono" style={{ fontSize: 11, fontWeight: 800 }}>
                      {order.id} {order.priority === 'rush' && <span className="badge badge-rush">RUSH</span>}
                      {order.robot_id && <span className="badge" style={{ marginLeft: 4 }}>{order.robot_id}</span>}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 800, color: STAGE_COLORS[order.status] }}>{order.status.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#4A4338', marginBottom: 6 }}>
                    {order.items.map((i) => `${i.qty}× ${productNames[i.sku] ?? i.sku}`).join(', ')}
                    {order.fail_reason && <span style={{ color: '#EF4444' }}> · {order.fail_reason.replace('_', ' ')}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {STAGES.map((s) => (
                      <span key={s} title={s} style={{ flex: 1, height: 4, borderRadius: 9999, background: reached.includes(s) ? STAGE_COLORS[s] : '#E2DDD3' }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
