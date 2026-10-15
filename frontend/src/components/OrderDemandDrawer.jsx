import { useState } from 'react';
import { coordToLabel } from '../services/simulationEngine';

export const OrderDemandDrawer = ({
  stats,
  orders,
  onInjectOrder,
  autoDemandWave,
  onToggleAutoDemand,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const getStageColor = (stage) => {
    switch (stage) {
      case 'PICKING':
        return '#FF5A26';
      case 'PACKING':
        return '#2563EB';
      case 'DELIVERING':
        return '#10B981';
      case 'COMPLETED':
        return '#8E8578';
      case 'QUEUED':
      default:
        return '#B8B0A2';
    }
  };

  return (
    <div
      className="clay-card"
      style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        zIndex: 50,
        width: isCollapsed ? 'auto' : '340px',
        padding: '14px 16px',
        transition: 'all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      {/* Drawer Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isCollapsed ? '0' : '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#10B981',
              boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)',
            }}
          />
          <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em', color: '#23201A' }}>
            DEMAND PIPELINE
          </span>
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'JetBrains Mono',
              fontWeight: 700,
              backgroundColor: '#EAE5DC',
              padding: '1px 6px',
              borderRadius: '9999px',
              color: '#736B5F',
            }}
          >
            {orders.filter((o) => o.stage !== 'COMPLETED').length} ACTIVE
          </span>
        </div>

        {/* Collapse / Expand Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="clay-btn clay-pill-sm"
          style={{ padding: '3px 7px', fontSize: '10px', color: '#8E8578' }}
          title={isCollapsed ? 'Expand Demand Drawer' : 'Collapse Demand Drawer'}
        >
          {isCollapsed ? '▲ EXPAND' : '▼ HIDE'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* 3 KPI Pills */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              marginBottom: '12px',
            }}
          >
            {/* KPI 1: Successful Deliveries */}
            <div
              className="clay-card-flat"
              style={{
                padding: '8px 10px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <span style={{ fontSize: '9px', fontWeight: 700, color: '#8E8578', letterSpacing: '0.03em' }}>
                DELIVERIES
              </span>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: '15px', fontWeight: 800, color: '#10B981', marginTop: '2px' }}>
                {stats.successfulDeliveries}
              </span>
            </div>

            {/* KPI 2: Collisions Avoided */}
            <div
              className="clay-card-flat"
              style={{
                padding: '8px 10px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <span style={{ fontSize: '9px', fontWeight: 700, color: '#8E8578', letterSpacing: '0.03em' }}>
                AVOIDED
              </span>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: '15px', fontWeight: 800, color: '#F59E0B', marginTop: '2px' }}>
                {stats.collisionsAvoided}
              </span>
            </div>

            {/* KPI 3: Charger Utilization */}
            <div
              className="clay-card-flat"
              style={{
                padding: '8px 10px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <span style={{ fontSize: '9px', fontWeight: 700, color: '#8E8578', letterSpacing: '0.03em' }}>
                DOCK UTIL
              </span>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: '15px', fontWeight: 800, color: '#2563EB', marginTop: '2px' }}>
                {stats.chargerUtilization}%
              </span>
            </div>
          </div>

          {/* Controls Bar: Inject Order & Auto-Demand Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', gap: '8px' }}>
            <button
              onClick={onInjectOrder}
              className="clay-btn clay-pill-sm clay-btn-accent"
              style={{
                padding: '5px 12px',
                fontSize: '11px',
                flex: 1,
                gap: '5px',
              }}
              title="Spawn a new random warehouse fulfillment order"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              + Inject Live Order
            </button>

            <button
              onClick={onToggleAutoDemand}
              className={`clay-btn clay-pill-sm ${autoDemandWave ? 'clay-btn-active' : ''}`}
              style={{
                padding: '5px 10px',
                fontSize: '11px',
                gap: '5px',
                backgroundColor: autoDemandWave ? '#EDE7DC' : '#FAF8F5',
              }}
              title="Toggle automatic wave generation of incoming orders"
            >
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: autoDemandWave ? '#10B981' : '#B8B0A2',
                }}
              />
              Auto-Wave: {autoDemandWave ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Live Order Queue List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
            {orders.slice().reverse().map((order) => {
              const isDone = order.stage === 'COMPLETED';

              return (
                <div
                  key={order.id}
                  className="clay-card-flat"
                  style={{
                    padding: '8px 10px',
                    opacity: isDone ? 0.6 : 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontFamily: 'JetBrains Mono', fontSize: '11px', fontWeight: 800, color: '#23201A' }}>
                        {order.id}
                      </span>
                      {order.assignedRobotId && (
                        <span
                          style={{
                            fontFamily: 'JetBrains Mono',
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: '4px',
                            backgroundColor: '#23201A',
                            color: '#FFFFFF',
                          }}
                        >
                          {order.assignedRobotId}
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 800,
                        color: getStageColor(order.stage),
                        letterSpacing: '0.04em',
                      }}
                    >
                      {order.stage}
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#4A4338', marginBottom: '6px' }}>
                    {order.item}
                  </div>

                  {/* 3-Stage Progress Timeline */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: '#8E8578' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: ['PICKING', 'PACKING', 'DELIVERING', 'COMPLETED'].includes(order.stage) ? '#FF5A26' : '#D1C9BE',
                        }}
                      />
                      <span>Pick ({coordToLabel(order.pickLocation?.x ?? 0, order.pickLocation?.y ?? 0)})</span>
                    </div>

                    <span style={{ color: '#DDD6C7' }}>→</span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: ['PACKING', 'DELIVERING', 'COMPLETED'].includes(order.stage) ? '#2563EB' : '#D1C9BE',
                        }}
                      />
                      <span>Pack ({coordToLabel(order.packLocation?.x ?? 0, order.packLocation?.y ?? 0)})</span>
                    </div>

                    <span style={{ color: '#DDD6C7' }}>→</span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: order.stage === 'COMPLETED' ? '#10B981' : '#D1C9BE',
                        }}
                      />
                      <span>Goal</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
