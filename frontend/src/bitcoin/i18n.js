import {formatMoney} from './currency';
const KEY='eru-btc-language-v1';
let language='en';
try{if(localStorage.getItem(KEY)==='ko')language='ko';}catch{}
export const lang=()=>language;
export const t=(en,ko)=>language==='ko'?ko:en;
export function setLanguage(value){language=value==='ko'?'ko':'en';try{localStorage.setItem(KEY,language);}catch{}document.documentElement.lang=language;}
export const cycleName=i=>t(`Cycle ${i+1}`,`${i+1}차 사이클`);
export const money=value=>formatMoney(value,language);
export const typeLabel=kind=>({sell:t('Sell','일부 매도'),buy:t('Buy back','다시 매수'),wait:t('Wait','매수 보류')}[kind]||t('Hold','보유 유지'));
export function eventText(e){if(!e||language==='ko')return e;return {...e,title:{sell:'Part of the Bitcoin position was sold',buy:'Bitcoin was bought back after conditions were met',wait:'Additional buying was put on hold'}[e.kind],signal:{sell:'A sell signal was confirmed on a completed daily candle.',buy:'Re-entry conditions were confirmed on a completed daily candle.',wait:'The market was falling, but re-entry conditions were not met.'}[e.kind],action:{sell:'Part of the Bitcoin position was sold at the next daily open to raise cash.',buy:'Part of the available cash was used to buy Bitcoin at the next daily open.',wait:'Bitcoin and cash were held without placing a new order.'}[e.kind],after:'Compare both accounts at the same point, then follow the subsequent asset changes.'};}
export function errorText(message){if(language==='ko')return message;return /보고서/.test(message)?'Could not prepare your report. Please try again shortly.':/연결/.test(message)?'Could not connect. Check your connection and try again.':/준비/.test(message)?'Verified market data is being prepared. Please try again shortly.':/한도|너무|잠시/.test(message)?'Please wait a moment before trying again.':/찾|만료/.test(message)?'This session is unavailable. Start a new comparison.':/메일|이메일/.test(message)?'Email delivery is unavailable. Please try again later.':/^[\x00-\x7F]*$/.test(message)?message:'We could not complete this request. Please try again.';}
