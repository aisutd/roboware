import { useId } from 'react';
import { PixelIcon } from './PixelIcon';

// Shared panel surface with a title and optional actions on the right.
// collapsible: the title becomes a toggle that folds the body away (actions stay usable);
// headerRef points at the title bar, e.g. for anchoring a notification to it.
export function Window({
  title, actions, className = '', bodyClassName = '', style, bodyStyle, as: Tag = 'section',
  collapsible = false, collapsed = false, onToggle, headerRef, children, ...rest
}) {
  const bodyId = useId();
  const body = <div className={`win-body ${bodyClassName}`} style={bodyStyle}>{children}</div>;
  return (
    <Tag className={`win ${collapsible ? 'win-collapsible' : ''} ${collapsed ? 'is-collapsed' : ''} ${className}`} style={style} {...rest}>
      <div className="win-title" ref={headerRef}>
        <h2>
          {collapsible ? (
            <button type="button" className="win-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}
              title={collapsed ? 'Expand' : 'Collapse'}>
              <PixelIcon name="chevron" className="win-chevron" />
              {title}
            </button>
          ) : title}
        </h2>
        {actions && <div className="win-actions">{actions}</div>}
      </div>
      {collapsible ? (
        <div className="win-collapse" id={bodyId} inert={collapsed}>
          <div className="win-collapse-inner">{body}</div>
        </div>
      ) : body}
    </Tag>
  );
}
