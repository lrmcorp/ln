import './style.css';
export const metadata={title:'LN Operasional',description:'Ruang kerja demo untuk pengelolaan pinjaman'};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="id"><body>{children}</body></html>;
}
