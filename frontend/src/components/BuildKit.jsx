// The layout builder's tool palette: every tool shows a mini preview of the tile it paints, its name,
// how many are placed and its key. Grouped by job, with a robot foreman explaining the tool in hand.
import { CHARGER_SPRITE, DOCK_SPRITE, PACKING_SPRITE, RACK_SPRITES } from '../lib/floorArt';
import { DOCK_KINDS, KIT_GROUPS as GROUPS } from '../lib/buildKit';
import { PixelIcon } from './PixelIcon';
import { RobotPet } from './RobotPet';

const FOREMAN = { id: 'R1', color: '#e4b366', status: 'idle', order_id: 'foreman', battery: 100 };
const CHEVRON = 'M0 0h2v1h1v1h1v-1h1v-1h2v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z';

function SpriteSwatch({ layers }) {
  return (
    <svg viewBox="0 0 14 14" shapeRendering="crispEdges" aria-hidden="true">
      {layers.map(({ fill, d }) => <path key={fill} d={d} fill={fill} />)}
    </svg>
  );
}

// A mini version of the tile each tool paints, so nothing has to be guessed.
function Swatch({ kind }) {
  let art = null;
  if (kind === 'rack') art = <SpriteSwatch layers={RACK_SPRITES[0]} />;
  else if (kind === 'packing') art = <SpriteSwatch layers={PACKING_SPRITE} />;
  else if (kind === 'charger') art = <SpriteSwatch layers={CHARGER_SPRITE} />;
  else if (kind === 'dock') art = <SpriteSwatch layers={DOCK_SPRITE} />;
  else if (kind === 'unload' || kind === 'shipping') {
    art = <svg className={`swatch-chevron ${kind === 'shipping' ? 'is-out' : ''}`} viewBox="0 0 7 4" shapeRendering="crispEdges" aria-hidden="true"><path d={CHEVRON} /></svg>;
  }
  return <span className={`kit-swatch swatch-${kind}`}>{art}</span>;
}

export function BuildKit({ brush, onBrush, dockKind, onDockKind, counts, disabled }) {
  const tools = GROUPS.flatMap((g) => g.tools);
  const current = tools.find((t) => (t.id === 'dock' ? brush === 'dock' || brush === 'shipping' : t.id === brush));
  const tip = current
    ? (current.id === 'dock' ? `${current.tip} ${DOCK_KINDS.find((k) => k.id === dockKind).hint}` : current.tip)
    : 'Look around: drag to move, scroll to zoom. Pick a tool to start building.';
  return (
    <nav className="hud-glass build-kit" aria-label="Build kit">
      <header className="kit-head"><PixelIcon name="wrench" /> Build kit</header>
      <button type="button" className="kit-tool kit-look" aria-pressed={!brush} disabled={disabled} onClick={() => onBrush(null)}>
        <span className="kit-swatch swatch-look"><PixelIcon name="hand" /></span>
        <span className="kit-name">Look around</span>
        <kbd className="kit-key">Esc</kbd>
      </button>
      {GROUPS.map((group) => (
        <section key={group.label} className="kit-group">
          <h3>{group.label}</h3>
          {group.tools.map((tool) => {
            const id = tool.id === 'dock' ? dockKind : tool.id;
            const active = brush === id;
            const placed = tool.id === 'dock' ? (counts.dock ?? 0) + (counts.shipping ?? 0) : counts[tool.id] ?? 0;
            const name = tool.id === 'dock' ? DOCK_KINDS.find((k) => k.id === dockKind).label : tool.label;
            return (
              <div key={tool.id} className={`kit-slot ${active ? 'is-active' : ''}`}>
                <button type="button" className={`kit-tool tool-${id}`} aria-pressed={active} disabled={disabled}
                  onClick={() => onBrush(active ? null : id)} title={tool.tip}>
                  <Swatch kind={id} />
                  <span className="kit-name">{name}</span>
                  {tool.id !== 'aisle' && tool.id !== 'void' && <span className={`kit-count ${placed ? '' : 'is-zero'}`}>{placed}</span>}
                  <kbd className="kit-key">{tool.key}</kbd>
                </button>
                {tool.id === 'dock' && active && (
                  <label className="kit-variant">
                    <span>Type</span>
                    <select className="setup-select" value={dockKind} aria-label="Dock type"
                      onChange={(event) => { onDockKind(event.target.value); onBrush(event.target.value); }}>
                      {DOCK_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                  </label>
                )}
              </div>
            );
          })}
        </section>
      ))}
      <footer className="kit-tip" aria-live="polite">
        <span className="kit-foreman"><RobotPet robot={FOREMAN} tick={0} /></span>
        <p key={tip}>{tip}</p>
      </footer>
    </nav>
  );
}
