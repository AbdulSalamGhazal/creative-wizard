/**
 * The Urjwan "Uj" brand logomark — a stylized U with a separated ascender +
 * tittle, in the brand purple→magenta gradient. Used in the top bar; the
 * favicon (app/icon.svg) is the same mark on a dark rounded square.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient
          id="urjwan-mark"
          x1="10"
          y1="10"
          x2="54"
          y2="54"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#8b46f0" />
          <stop offset="1" stopColor="#e0359d" />
        </linearGradient>
      </defs>
      <path
        d="M20 16 L20 34 C20 41 25.4 46 32 46 C38.6 46 44 41 44 34 L44 28"
        stroke="url(#urjwan-mark)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="44" cy="12" r="4.5" fill="url(#urjwan-mark)" />
    </svg>
  );
}
