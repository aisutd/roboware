import { Brain, History, LayoutGrid, Play } from 'lucide-react';

const VIEWS = [
  { id: 'session', label: 'Session', Icon: Play },
  { id: 'models', label: 'Models', Icon: Brain },
  { id: 'layouts', label: 'Layouts', Icon: LayoutGrid },
  { id: 'history', label: 'History', Icon: History },
];

export function NavRail({ view, onChange }) {
  return (
    <nav className="nav-rail clay-card" aria-label="Main">
      <div className="nav-brand" title="RoboWare">RW</div>
      {VIEWS.map((item) => {
        const { id, label, Icon } = item;
        return (
          <button key={id} type="button" className={`nav-item ${view === id ? 'active' : ''}`}
            onClick={() => onChange(id)} aria-current={view === id ? 'page' : undefined}>
            <Icon size={18} strokeWidth={2.2} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
