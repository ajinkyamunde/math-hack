export function BrandMark({ className = 'brand__mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="mh-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="0.55" stopColor="#6d28d9" />
          <stop offset="1" stopColor="#f5c451" />
        </linearGradient>
      </defs>
      <path d="M32 6 54 19v26L32 58 10 45V19z" fill="none" stroke="url(#mh-brand)" strokeWidth="3.5" />
      <path d="M21 42V22l11 12 11-12v20" fill="none" stroke="#f5c451" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
