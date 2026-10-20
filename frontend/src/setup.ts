import { aliases, validWeights, type Alias, type Allocation } from './model';

export type Profile = 'cautious'|'balanced'|'active'|'custom';
export type Shares = Record<Alias, number>;
export const emptyShares = (): Shares => ({A:0,B:0,C:0,D:0});
export const profiles = [
  {id:'cautious' as const, name:'안정형', cash:60, description:'현금을 넉넉히 남기고, 투자하는 금액을 작게 시작하고 싶어요.', answer:'현금 60%, 투자 40%를 출발점으로 잡아볼게요. 현금 비중으로 가격 변동에 노출되는 금액을 줄여요. 투자한 코인의 원금이 보장되는 것은 아니에요.'},
  {id:'balanced' as const, name:'균형형', cash:30, description:'투자 기회와 현금 여유를 함께 가져가고 싶어요.', answer:'현금 30%, 투자 70%로 시작해볼게요. 투자 참여와 추가 판단에 쓸 현금을 함께 남기는 구성이에요.'},
  {id:'active' as const, name:'공격형', cash:10, description:'큰 가격 변동을 감수하고 투자 비중을 높이고 싶어요.', answer:'현금 10%, 투자 90%로 잡아볼게요. 가격 변화가 전체 자산에 크게 반영되므로 손실 가능성도 함께 고려해 주세요.'},
  {id:'custom' as const, name:'기타', cash:50, description:'정해진 유형 대신 내 기준으로 현금과 투자 비중을 직접 정하고 싶어요.', answer:'현금과 투자 비중을 직접 정해요. 현금은 이자를 받고, 코인에 배분한 금액은 가격 변동에 노출돼요.'},
];

// 비중을 0.01% 단위로 배분해 서버 Decimal 장부에서도 합계가 정확히 100이 되게 한다.
function distribute(units: number, ratios: Shares): Shares {
  const total = aliases.reduce((sum,a)=>sum+ratios[a],0);
  if (!total) return emptyShares();
  const rows = aliases.map(a=>{const exact=units*ratios[a]/total;return {a,units:Math.floor(exact),fraction:exact-Math.floor(exact)};});
  const remainder = units-rows.reduce((sum,r)=>sum+r.units,0);
  const order = [...rows].sort((a,b)=>b.fraction-a.fraction);
  for(let i=0;i<remainder;i++) order[i].units++;
  return Object.fromEntries(rows.map(r=>[r.a,r.units])) as Shares;
}

export function equalShares(selected: Alias[]): Shares {
  const amounts = distribute(10000,Object.fromEntries(aliases.map(a=>[a,selected.includes(a) ? 1:0])) as Shares);
  return Object.fromEntries(aliases.map(a=>[a,amounts[a]/100])) as Shares;
}

export function sharesFromAllocation(w: Allocation): Shares {
  const units = distribute(10000,Object.fromEntries(aliases.map(a=>[a,w[a]])) as Shares);
  return Object.fromEntries(aliases.map(a=>[a,units[a]/100])) as Shares;
}

export function buildAllocation(cash: number, shares: Shares): Allocation|null {
  if (!Number.isFinite(cash) || cash<0 || cash>100 || Math.abs(cash*100-Math.round(cash*100))>1e-7) return null;
  if(cash===100) return {cash:100,...emptyShares()};
  if (aliases.some(a=>!Number.isFinite(shares[a]) || shares[a]<0 || shares[a]>100) || Math.abs(aliases.reduce((s,a)=>s+shares[a],0)-100)>1e-7) return null;
  const units = distribute(10000-Math.round(cash*100),shares);
  const result = {cash,...Object.fromEntries(aliases.map(a=>[a,units[a]/100]))} as Allocation;
  return validWeights(result) ? result : null;
}
