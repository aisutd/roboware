import { useLayoutEffect, useRef } from 'react';
import { PET_BODY, PET_LEGS_A, PET_LEGS_B } from '../lib/pet';
import { PixelIcon } from './PixelIcon';

const VIEWS = [
  { id: 'session', label: 'Session', icon: 'play' },
  { id: 'models', label: 'Models', icon: 'chip' },
  { id: 'layouts', label: 'Layouts', icon: 'grid' },
  { id: 'history', label: 'History', icon: 'clock' },
];

// The app logo: an amber pixel pet that blinks now and then.
function BrandPet() {
  return (
    <svg className="brand-pet" viewBox="-1 -3 14 14" shapeRendering="crispEdges" aria-hidden="true">
      <path d={`${PET_BODY}${PET_LEGS_A}${PET_LEGS_B}`} />
      <g className="brand-pet-eyes"><rect x="3" y="1" width="1" height="1" /><rect x="8" y="1" width="1" height="1" /></g>
    </svg>
  );
}

// Moves the highlight onto the active item (measured, so it works in every rail layout); the CSS
// transition makes it glide. Updated straight on the element, so a resize doesn't re-render the rail.
function useGlidingHighlight(listRef, highlightRef, view) {
  useLayoutEffect(() => {
    const list = listRef.current;
    const highlight = highlightRef.current;
    if (!list || !highlight) return undefined;
    const place = () => {
      const item = list.querySelector('.nav-item.active');
      highlight.style.opacity = item ? '1' : '0';
      if (!item) return;
      highlight.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
      highlight.style.width = `${item.offsetWidth}px`;
      highlight.style.height = `${item.offsetHeight}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => observer.disconnect();
  }, [listRef, highlightRef, view]);
}

export function NavRail({ view, onChange }) {
  const listRef = useRef(null);
  const highlightRef = useRef(null);
  useGlidingHighlight(listRef, highlightRef, view);
  return (
    <nav className="nav-rail clay-card" aria-label="Main">
      <div className="nav-brand" title="RoboWare">
        <span className="brand-mark"><BrandPet /></span>
        <div className="brand-copy">RoboWare<span>Warehouse ops</span></div>
      </div>
      <div className="nav-section-label">Workspace</div>
      <div className="nav-list" ref={listRef}>
        <span ref={highlightRef} className="nav-highlight" aria-hidden="true" />
        {VIEWS.map(({ id, label, icon }) => (
          <button key={id} type="button" className={`nav-item ${view === id ? 'active' : ''}`} data-sound="select"
            onClick={() => onChange(id)} aria-current={view === id ? 'page' : undefined}>
            <span className="nav-cursor" aria-hidden="true">▶</span>
            <PixelIcon name={icon} />
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="nav-footer"><span className="status-led led-live" /> Systems online</div>
    </nav>
  );
}
