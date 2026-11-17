import {beforeEach,describe,it,expect,vi} from 'vitest';

const fake=vi.hoisted(()=>({series:[],options:null,crosshair:null,click:null,chart:null,markers:null}));
vi.mock('lightweight-charts',()=>({
 ColorType:{Solid:0},CrosshairMode:{Normal:0},LineStyle:{Dotted:1,Dashed:2},LineSeries:{},
 createChart:vi.fn((host,options)=>{fake.options=options;return fake.chart;}),
 createSeriesMarkers:vi.fn(()=>fake.markers),
}));
import {createFinancialChart} from './financialChart';
import {createChart} from 'lightweight-charts';

function element(){return {children:[],style:{},hidden:false,clientWidth:358,clientHeight:350,setAttribute:vi.fn(),
 append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
 addEventListener:vi.fn(),removeEventListener:vi.fn()};}
const data={start:'2022-01-01',end:'2022-01-11',phase:'bear',history:[
 {date:'2022-01-01',position:0,hold:100,guard:100},
 {date:'2022-01-03',position:20,hold:60,guard:85}],
 events:[{id:'sell',kind:'sell',at:'2022-01-03',position:20,guard_value:85}]};

beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('document',{createElement:element});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});fake.series=[];
 let visible={from:0,to:2};const scale={setVisibleLogicalRange:vi.fn(range=>visible=range),getVisibleLogicalRange:()=>visible,logicalToCoordinate:step=>step*100,subscribeVisibleLogicalRangeChange:vi.fn(),unsubscribeVisibleLogicalRangeChange:vi.fn()};
 fake.markers={setMarkers:vi.fn(),detach:vi.fn()};
 fake.chart={addSeries:vi.fn(()=>{const s={setData:vi.fn(),createPriceLine:vi.fn(()=>({})),removePriceLine:vi.fn()};fake.series.push(s);return s;}),
  timeScale:()=>scale,priceScale:()=>({width:()=>57}),applyOptions:vi.fn(),subscribeCrosshairMove:vi.fn(cb=>fake.crosshair=cb),
  subscribeClick:vi.fn(cb=>fake.click=cb),unsubscribeCrosshairMove:vi.fn(),unsubscribeClick:vi.fn(),
  setCrosshairPosition:vi.fn(),clearCrosshairPosition:vi.fn(),resize:vi.fn(),remove:vi.fn()};
});

describe('persistent financial chart controller',()=>{
 it('keeps fixed-capital baseline and numbered decisions on the same original series',()=>{
  const c=createFinancialChart(element());c.update(data,{key:'report',numbered:true,startValue:100,selectedId:'sell'});
  c.update(data,{key:'report',numbered:true,startValue:100,chartUnit:'year'});
  expect(fake.series[2].createPriceLine).toHaveBeenCalledTimes(1);
  expect(fake.series[2].createPriceLine).toHaveBeenCalledWith(expect.objectContaining({price:100}));
  expect(fake.markers.setMarkers.mock.calls[0][0][0].text).toBe('1');
  expect(fake.series[2].setData).toHaveBeenCalledTimes(1);
 });
 it('keeps the chart instance and asset data intact when only the axis unit changes',()=>{
  const host=element(),c=createFinancialChart(host);c.update(data,{key:'run/1/bear',chartUnit:'day'});
  const nodes=[...host.children];
  for(const unit of ['week','month','year'])c.update(data,{key:'run/1/bear',chartUnit:unit});
  expect(createChart).toHaveBeenCalledTimes(1);expect(host.children).toEqual(nodes);
  expect(fake.series[1].setData).toHaveBeenCalledTimes(1);expect(fake.series[2].setData).toHaveBeenCalledTimes(1);
  expect(fake.series[2].setData.mock.calls[0][0].map(p=>p.value)).toEqual([100,85]);
  expect(fake.options.rightPriceScale.visible).toBe(true);expect(fake.options.timeScale.enableConflation).toBe(false);
  expect(fake.options.layout.attributionLogo).toBe(false);expect(fake.options.layout.fontSize).toBe(14);
  expect(host.children[2].children.map(t=>t.textContent)).toEqual(['2022']);
 });
 it('looks up actual account balances at the crosshair without invoking playback or interpolating prices',()=>{
  const onInspect=vi.fn(),c=createFinancialChart(element(),{onInspect});c.update(data,{key:'run'});
  fake.crosshair({time:1641168000,logical:1.7,point:{x:70,y:90}});
  expect(onInspect).toHaveBeenLastCalledWith(expect.objectContaining({date:'2022-01-03',guard:85,hold:60}));
  fake.crosshair({});expect(onInspect).toHaveBeenLastCalledWith(null);
  expect(fake.options.handleScroll.pressedMouseMove).toBe(false);
 });
 it('connects a native marker click to the same existing risk-response record',()=>{
  const onRecord=vi.fn(),c=createFinancialChart(element(),{onRecord});c.update(data,{key:'run',selectedId:'sell'});
  fake.click({hoveredInfo:{objectId:'sell'}});expect(onRecord).toHaveBeenCalledWith(data.events[0]);
  expect(fake.markers.setMarkers.mock.calls[0][0][0].id).toBe('sell');
 });
 it('releases observers, marker subscriptions and the chart exactly once on navigation',()=>{
  const c=createFinancialChart(element());c.update(data,{key:'run'});c.dispose();c.dispose();
  expect(fake.chart.remove).toHaveBeenCalledTimes(1);expect(fake.markers.detach).toHaveBeenCalledTimes(1);
  expect(fake.chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(1);
 });
});
