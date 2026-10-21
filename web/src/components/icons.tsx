import type { ReactNode, SVGProps } from 'react';

function Svg({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </Svg>
);
export const UserIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
  </Svg>
);
export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
export const AperturePlus = (p: SVGProps<SVGSVGElement>) => (
  <Svg width={28} height={28} strokeWidth={2.4} {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" fill="currentColor" />
  </Svg>
);
export const ThumbIcon = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM7 11l4-8c1.7 0 3 1.3 3 3v3h5.3a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 18.1 20H7" />
  </Svg>
);
export const CommentIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
  </Svg>
);
export const FlipIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 8V5h3M20 16v3h-3" />
    <path d="M5 5a9 9 0 0 1 15 4M19 19A9 9 0 0 1 4 15" />
  </Svg>
);
export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="6" y="4.5" width="4" height="15" rx="1" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" />
  </Svg>
);
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" />
  </Svg>
);
export const StopIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </Svg>
);
export const BackIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);
export const MoreIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </Svg>
);
export const FlameIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M12.5 2c.4 3-1.2 4.6-2.7 6.3C8.2 10 7 11.600 7 14a5 5 0 0 0 10 0c0-1.800-.8-3.200-1.800-4.400-.3 1.200-.9 2-1.700 2.400.5-3.500-.3-7.400-1-10z" />
  </Svg>
);
