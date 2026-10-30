// Stroke icons for the navigation only; each one depicts its menu label so a long menu scans quickly.
const paths:Record<string,string>={
  home:'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
  collect:'M3 7h18v10H3zM3 11h18M7 15h3',
  verify:'M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  location:'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  loans:'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  intake:'M14 3H6v18h12V7zM14 3v4h4M12 11v6M9 14h6',
  deposit:'M4 10l8-5 8 5M5 10v8M19 10v8M9.5 10v8M14.5 10v8M3 20h18',
  report:'M4 19V5M4 19h16M8 15l3.5-4 3 2.5L20 7',
  capital:'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3S9.5 10 12 10.5s4.5 1.5 4.5 3.5-2 3-4.5 3-4.5-1.3-4.5-3',
  policy:'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  users:'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  logout:'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  menu:'M4 7h16M4 12h16M4 17h16',
  close:'M6 6l12 12M18 6 6 18',
  plus:'M12 5v14M5 12h14'
};

export function Icon({name,size=20}:{name:keyof typeof paths|string;size?:number}){
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
