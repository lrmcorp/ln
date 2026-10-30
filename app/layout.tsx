import {Plus_Jakarta_Sans} from 'next/font/google';
import './style.css';

const sans=Plus_Jakarta_Sans({subsets:['latin'],display:'swap',variable:'--font-sans'});
export const metadata={title:'LN Operasional',description:'Ruang kerja demo untuk pengelolaan pinjaman'};

// Applies the saved light/dark choice before first paint so the page does not flash.
const themeScript=`try{var t=localStorage.getItem('ln-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="id" className={sans.variable} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body>{children}</body></html>;
}
