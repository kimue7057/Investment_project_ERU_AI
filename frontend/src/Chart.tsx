import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineSeries, type Time } from 'lightweight-charts';

export default function Chart({ data, label }: {data: {time: string; value: number}[]; label: string}) {
  const root = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof createChart> | null>(null);
  const series = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null);
  useEffect(() => {
    if (!root.current) return;
    chart.current = createChart(root.current, {autoSize: true, height: 340,
      layout: {background: {type: ColorType.Solid, color: '#ffffff'}, textColor: '#6b7684', fontFamily: 'Noto Sans KR, Malgun Gothic, sans-serif', attributionLogo: true},
      grid: {vertLines: {visible: false}, horzLines: {color: '#f2f4f6'}},
      rightPriceScale: {borderVisible: false}, timeScale: {borderVisible: false, fixLeftEdge: true, fixRightEdge: true},
      handleScroll: true, handleScale: true});
    series.current = chart.current.addSeries(LineSeries, {color: '#f04452', lineWidth: 2, priceLineVisible: false});
    const observer = new ResizeObserver(()=>requestAnimationFrame(()=>chart.current?.timeScale().fitContent()));
    observer.observe(root.current);
    return () => { observer.disconnect(); chart.current?.remove(); chart.current = null; series.current = null; };
  }, []);
  useEffect(() => {
    const unique = new Map(data.map(d => [d.time.slice(0, 10), d.value]));
    series.current?.setData([...unique].map(([time, value]) => ({time: time as Time, value})));
    chart.current?.timeScale().fitContent();
  }, [data]);
  return <div className="chart-wrap" aria-label={label}><div ref={root} style={{height:340,width:'100%',minWidth:0}}/>{data.length < 2 && <div className="chart-empty">시장이 재생되면 완료된 일봉 차트가 쌓여요.</div>}</div>;
}
