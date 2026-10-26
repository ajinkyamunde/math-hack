import type { ReactNode } from 'react';

interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  holo?: boolean;
  compact?: boolean;
  className?: string;
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
  labelledBy?: string;
}

export function Panel({ title, actions, holo, compact, className = '', children, as: Tag = 'section', labelledBy }: PanelProps) {
  const classes = ['panel', holo ? 'panel--holo' : '', compact ? 'panel--compact' : '', className].filter(Boolean).join(' ');
  return (
    <Tag className={classes} aria-labelledby={labelledBy}>
      {(title || actions) && (
        <div className="panel__title">
          {typeof title === 'string' ? <h2 id={labelledBy}>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}
