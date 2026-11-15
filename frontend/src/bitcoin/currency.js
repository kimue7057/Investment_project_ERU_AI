// ECB 2026-11-13: 1 EUR = 1477.80 KRW = 1.4236 SGD.
// 표시 환산만 수행하며 서버의 원화 Decimal 장부와 수익률은 변경하지 않습니다.
export const FX={date:'2026-11-13',numerator:14778000,denominator:14236,source:'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html'};
export const krwPerSgd=FX.numerator/FX.denominator;
export const currencyCode=locale=>locale==='ko'?'KRW':'SGD';
export const currencySymbol=locale=>locale==='ko'?'₩':'S$';
export const displayedValue=(krw,locale)=>locale==='ko'?Number(krw):Number(krw)/krwPerSgd;
export function inputAmount(krw,locale){return displayedValue(krw,locale).toLocaleString(locale==='ko'?'ko-KR':'en-SG',{minimumFractionDigits:locale==='ko'?0:2,maximumFractionDigits:locale==='ko'?0:2});}
export function parseAmount(text,locale,current){
 const raw=String(text).replaceAll(',','').trim(),pattern=locale==='ko'?/^\d+$/:/^\d+(\.\d{1,2})?$/;
 if(!pattern.test(raw)||raw.length>17)return null;
 // 기존 금액을 다시 제출할 때 화면의 반올림으로 원금이 달라지지 않게 합니다.
 if(current!==undefined&&raw===inputAmount(current,locale).replaceAll(',',''))return Number(current);
 if(locale==='ko'){const n=Number(raw);return Number.isSafeInteger(n)?n:null;}
 const [whole,fraction='']=raw.split('.'),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 const denominator=BigInt(FX.denominator),krwCents=(cents*BigInt(FX.numerator)+denominator/2n)/denominator;
 return krwCents<=BigInt(Number.MAX_SAFE_INTEGER)?Number(krwCents)/100:null;
}
export const defaultCapital=locale=>locale==='ko'?100000000:parseAmount('100000.00','en');
export function amountLimits(locale){return locale==='ko'?[10000,10000000000]:[Math.ceil(10000/krwPerSgd*100)/100,Math.floor(10000000000/krwPerSgd*100)/100];}
export function presets(locale){return locale==='ko'?[1e7,5e7,1e8]:[1e4,5e4,1e5].map(n=>parseAmount(n.toFixed(2),'en'));}
export function formatMoney(krw,locale){
 const n=displayedValue(krw,locale),a=Math.abs(n),sign=n<0?'−':'';
 if(locale==='ko')return sign+(a>=1e8?Number((a/1e8).toFixed(2)).toLocaleString('ko-KR')+'억 원':a>=1e4?Number((a/1e4).toFixed(1)).toLocaleString('ko-KR')+'만 원':Math.round(a).toLocaleString('ko-KR')+'원');
 return sign+'S$'+(a>=1e9?Number((a/1e9).toFixed(2))+'B':a>=1e6?Number((a/1e6).toFixed(2))+'M':a>=1e3?Number((a/1e3).toFixed(2))+'K':a.toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2}));
}
