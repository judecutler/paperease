// PaperEase pup logo. Source art and light/dark SVG exports: public/brand/.
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g transform="rotate(-5 32 34)">
        <path d="M21 8h22l13 13v31a7 7 0 0 1-7 7H15a7 7 0 0 1-7-7V21z" fill="var(--pine)" />
        <path d="M21 8L8 21C4 27 2.5 34 4.5 39c2 4.5 7.5 4 9-.5C16 30 18 18 21 8z" fill="var(--brand-ear)" />
        <path d="M43 8l13 13c4 6 5.5 13 3.5 18-2 4.5-7.5 4-9-.5C48 30 46 18 43 8z" fill="var(--brand-ear)" />
        <circle cx="24" cy="32" r="3.3" fill="var(--on-pine)" />
        <circle cx="40" cy="32" r="3.3" fill="var(--on-pine)" />
        <path d="M28.6 37.6h6.8a1.6 1.6 0 0 1 1.2 2.6l-3.4 3.6a1.6 1.6 0 0 1-2.4 0l-3.4-3.6a1.6 1.6 0 0 1 1.2-2.6z" fill="var(--on-pine)" />
        <path d="M32 43.5v2.5M24.5 45.5c1.5 3.6 6 4 7.5.5 1.5 3.5 6 3.1 7.5-.5" fill="none" stroke="var(--on-pine)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M29 49.4h6v2.8a3 3 0 0 1-6 0z" fill="var(--brand-warm)" />
      </g>
    </svg>
  );
}

export function BrandName() {
  return (
    <span className="brand-name">
      Paper<span className="brand-ease">Ease</span>
    </span>
  );
}
