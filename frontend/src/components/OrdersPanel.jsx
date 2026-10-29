import { useLayoutEffect, useRef, useState } from 'react';
import { PET_BODY, PET_LEGS_A, PET_LEGS_B } from '../lib/pet';
import { STAGE_ICONS } from '../lib/pixelArt';
import { PixelIcon } from './PixelIcon';
import { RobotPet } from './RobotPet';
import { Window } from './Window';

// A new ticket "prints" in from the top in 8-bit steps with a bright flash.
const PRINT_IN = [
  { clipPath: 'inset(0 0 100% 0)', transform: 'translateY(-8px)', filter: 'brightness(2.2)' },
  { clipPath: 'inset(0 0 0 0)', transform: 'translateY(0)', filter: 'brightness(1.6)', offset: 0.75 },
  { clipPath: 'inset(0 0 0 0)', transform: 'translateY(0)', filter: 'brightness(1)' },
];
const NEW_BADGE_MS = 3200;

// A big blinking NEW flag that floats over the floor just left of the orders panel, beside `ticket`
// (the new ticket, or the Orders header while the panel is collapsed). It lives outside the scrolling
// panel (which would clip it) and follows its target every frame.
function flagNewTicket(ticket, rush) {
  const host = ticket.closest('.session') ?? document.body;
  const panel = ticket.closest('.hud-side');
  const flag = document.createElement('div');
  flag.className = `ticket-new-flag ${rush ? 'rush' : ''}`;
  flag.innerHTML = '<span class="ticket-new-flag-body">NEW</span>';
  flag.setAttribute('aria-hidden', 'true');
  host.appendChild(flag);
  const started = performance.now();
  const follow = (now) => {
    if (!ticket.isConnected || now - started > NEW_BADGE_MS) {
      flag.remove();
      return;
    }
    const box = ticket.getBoundingClientRect();
    const bounds = panel?.getBoundingClientRect();
    const visible = !bounds || (box.bottom > bounds.top + 8 && box.top < bounds.bottom - 8);
    flag.style.top = `${box.top + box.height / 2}px`;
    flag.style.left = `${(bounds?.left ?? box.left) - 10}px`;
    flag.style.visibility = visible ? 'visible' : 'hidden';
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
}

// Animates the ticket list: new tickets print in and raise a NEW flag; the others slide to their
// new places instead of jumping (FLIP). While the panel is collapsed the flag points at the Orders
// header instead. Nothing animates on the first render or with reduced motion.
function useTicketMotion(listRef, collapsed, headerRef) {
  const tops = useRef(new Map());
  const seen = useRef(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const firstPass = seen.current === null;
    if (firstPass) seen.current = new Set();
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const el of list.querySelectorAll('[data-order-id]')) {
      const id = el.dataset.orderId;
      const top = el.offsetTop;
      const previous = tops.current.get(id);
      const arrived = !firstPass && !seen.current.has(id);
      if (arrived && collapsed && headerRef.current) {
        flagNewTicket(headerRef.current, el.classList.contains('ticket-rush'));
      } else if (!firstPass && !collapsed && !calm && typeof el.animate === 'function') {
        if (arrived) {
          el.animate(PRINT_IN, { duration: 700, easing: 'steps(7, end)' });
          el.classList.add('ticket-new');
          setTimeout(() => el.classList.remove('ticket-new'), NEW_BADGE_MS);
          flagNewTicket(el, el.classList.contains('ticket-rush'));
        } else if (previous !== undefined && previous !== top) {
          el.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }],
            { duration: 340, easing: 'cubic-bezier(.2, .8, .2, 1)' });
        }
      }
      seen.current.add(id);
      tops.current.set(id, top);
    }
  });
}

const STAGES = [['picking', 'Pick'], ['packing', 'Pack'], ['shipping', 'Ship'], ['delivered', 'Done']];
const WAITING = { queued: 'Queued', assigned: 'Assigned' };
const FINISHED_SHOWN = 5;

const finished = (o) => o.status === 'delivered' || o.status === 'failed';
const lastUpdate = (o) => Math.max(0, ...Object.values(o.timeline ?? {}).filter(Number.isFinite));

function StageTrack({ order }) {
  const reached = new Set(STAGES.map(([s]) => s).filter((s) => order.timeline?.[s] !== undefined));
  return (
    <div className="ticket-track" role="img" aria-label={`Order ${order.id}: ${order.status}`}>
      {STAGES.map(([stage, label], i) => (
        <span key={stage} className="ticket-step-wrap">
          {i > 0 && <span className={`ticket-link ${reached.has(stage) ? 'on' : ''}`} />}
          <span className={`ticket-step stage-${stage} ${reached.has(stage) ? 'on' : ''} ${order.status === stage ? 'current' : ''}`} title={label}>
            <svg viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true"><path d={STAGE_ICONS[stage]} /></svg>
          </span>
        </span>
      ))}
    </div>
  );
}

// Right-hand panel naming the robot on the order: its live pixel pet and ID, or a grey ghost while unassigned.
function TicketRobot({ order, robot, name, cheer, tick, onSelectRobot }) {
  if (!robot && finished(order) && !order.robot_id) return null;
  if (!robot) {
    return (
      <span className="ticket-robot-panel empty" title={order.robot_id ? `${order.robot_id}` : 'Waiting for a free robot'}>
        <svg className="ticket-ghost" viewBox="-1 -3 14 14" shapeRendering="crispEdges" aria-hidden="true">
          <path d={`${PET_BODY}${PET_LEGS_A}${PET_LEGS_B}`} />
        </svg>
        <span className="ticket-robot-id">{order.robot_id ?? '…'}</span>
      </span>
    );
  }
  return (
    <button type="button" className="ticket-robot-panel" onClick={() => onSelectRobot?.(robot.id)} title={`${name ? `${name} (${robot.id})` : robot.id} is handling this order. Click to select it.`}>
      <span className="ticket-pet"><RobotPet robot={robot} cheer={cheer} tick={tick} /></span>
      <span className="ticket-robot-id">{name ?? robot.id}</span>
    </button>
  );
}

export function OrdersPanel({
  orders, productNames, onInject, disabled, robots = [], selectedRobotId, onSelectRobot, robotCheers, tick,
  collapsed = false, onToggle, robotNames = {},
}) {
  const robotsById = Object.fromEntries(robots.map((r) => [r.id, r]));
  // Newest first, so an arriving order prints in at the top and pushes the rest down.
  const open = orders.filter((o) => !finished(o)).reverse();
  const done = orders.filter(finished).sort((a, b) => lastUpdate(b) - lastUpdate(a)).slice(0, FINISHED_SHOWN);
  const listRef = useRef(null);
  const headerRef = useRef(null);
  useTicketMotion(listRef, collapsed, headerRef);
  // Orders already open when the panel was collapsed; anything else that arrives counts as unseen.
  const [seenWhenCollapsed, setSeenWhenCollapsed] = useState(() => (collapsed ? new Set(open.map((o) => o.id)) : null));
  const unseen = collapsed && seenWhenCollapsed ? open.filter((o) => !seenWhenCollapsed.has(o.id)) : [];
  const toggle = () => {
    setSeenWhenCollapsed(collapsed ? null : new Set(open.map((o) => o.id)));
    onToggle?.();
  };
  return (
    <Window
      title={(
        <>
          <PixelIcon name="ticket" /> Orders <span key={open.length} className="win-count">{open.length}</span>
          {unseen.length > 0 && (
            <span key={unseen.length} className={`win-alert ${unseen.some((o) => o.priority === 'rush') ? 'rush' : ''}`}>
              +{unseen.length} new
            </span>
          )}
        </>
      )}
      collapsible
      collapsed={collapsed}
      onToggle={toggle}
      headerRef={headerRef}
      className={`operations-orders ${unseen.length ? 'has-alert' : ''}`}
      actions={(
        <>
          <button type="button" className="px-btn px-small px-icon-btn" disabled={disabled} onClick={() => onInject('normal')} title="Add an order" aria-label="Add an order"><PixelIcon name="plus" /></button>
          <button type="button" className="px-btn px-small px-rush px-icon-btn" disabled={disabled} onClick={() => onInject('rush')} title="Add a rush order" aria-label="Add a rush order"><PixelIcon name="rush" /></button>
        </>
      )}
      bodyStyle={{ padding: 8 }}
    >
      {orders.length === 0 && <p className="muted" style={{ padding: 6 }}>No orders yet.</p>}
      <div className="ticket-list" ref={listRef}>
        {[...open, ...done].map((order) => {
          const robot = robotsById[order.robot_id];
          const mine = !finished(order) && robot && robot.id === selectedRobotId;
          return (
            <article key={order.id} className={`ticket ${order.priority === 'rush' ? 'ticket-rush' : ''} ${mine ? 'ticket-selected' : ''} ${order.waiting_stock ? 'ticket-awaiting' : ''}`}
              data-order-id={order.id} data-status={order.status} style={robot ? { '--robot': robot.color } : undefined}>
              <div className="ticket-main">
                <div className="ticket-head">
                  <span className="ticket-id">{order.id.replace('ORD-', '#')}</span>
                  {order.priority === 'rush' && <span className="ticket-badge">Rush</span>}
                  {order.waiting_stock && order.status === 'queued'
                    ? <span className="ticket-waiting" title="Out of stock. A delivery truck is bringing more."><PixelIcon name="truck" /> Awaiting truck</span>
                    : <span className="ticket-state">{order.status === 'failed' ? 'Failed' : WAITING[order.status] ?? ''}</span>}
                </div>
                <div className="ticket-items">
                  {order.items.map((i) => `${i.qty}× ${productNames[i.sku] ?? i.sku}`).join(', ')}
                  {order.fail_reason && <span className="ticket-fail"> ({order.fail_reason.replace('_', ' ')})</span>}
                </div>
                <StageTrack order={order} />
              </div>
              <TicketRobot order={order} robot={robot} name={robot ? robotNames[robot.id] : null} cheer={robot ? robotCheers?.[robot.id] : null} tick={tick} onSelectRobot={onSelectRobot} />
              {order.status === 'delivered' && <span className="ticket-stamp">Completed</span>}
            </article>
          );
        })}
      </div>
    </Window>
  );
}
