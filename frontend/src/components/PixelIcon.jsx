import { UI_ICONS } from '../lib/pixelArt';

// A 7x7 pixel icon from UI_ICONS, drawn in the current text colour.
export function PixelIcon({ name, className = '' }) {
  return (
    <svg className={`px-icon ${className}`} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
      <path d={UI_ICONS[name]} />
    </svg>
  );
}
