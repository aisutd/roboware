// A square panel with a pinstriped title bar; actions sit on the right of the bar.
export function Window({ title, actions, className = '', bodyClassName = '', style, bodyStyle, as: Tag = 'section', children, ...rest }) {
  return (
    <Tag className={`win ${className}`} style={style} {...rest}>
      <div className="win-title">
        <h2>{title}</h2>
        {actions && <div className="win-actions">{actions}</div>}
      </div>
      <div className={`win-body ${bodyClassName}`} style={bodyStyle}>{children}</div>
    </Tag>
  );
}
