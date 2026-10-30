import {Plus_Jakarta_Sans} from 'next/font/google';
import './style.css';

const sans=Plus_Jakarta_Sans({subsets:['latin'],display:'swap',variable:'--font-sans'});
export const metadata={title:'LN Operasional',description:'Ruang kerja demo untuk pengelolaan pinjaman'};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="id" className={sans.variable}><body>{children}</body></html>;
}
