// wa.me needs the international form without "+": 0812... becomes 62812...
export function whatsappLink(phone:string|null,message:string){
  const digits=(phone??'').replace(/\D/g,'');
  if(digits.length<8)return null;
  const international=digits.startsWith('0')?`62${digits.slice(1)}`:digits.startsWith('62')?digits:`62${digits}`;
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
}
