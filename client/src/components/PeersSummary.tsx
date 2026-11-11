import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  ReferenceLine, ReferenceArea, Tooltip,
} from 'recharts';
import { apiGet } from '../data/session';

/**
 * Where each property stands against its competitors, as one picture.
 *
 * Price per night across, nights taken over the next 30 days up. Every
 * competitor is a grey dot, the benchmark a blue diamond, us an orange
 * dot; the dashed lines are the competitors' medians and cut the chart
 * into four corners — fuller or emptier, cheaper or more expensive. The
 * corner we sit in is the answer to "how are we doing".
 *
 * Occupancy is read from Airbnb the same way for everybody, so blocks
 * count as taken. The price is each listing's average asking price over
 * the stays quoted in the next five weeks. The verdict is against the
 * median, not the benchmark: the benchmark is the best in the segment,
 * and being behind it is the normal state of things.
 */

export interface PeerWindow { days: number; own: number | null; benchmark: number | null; median: number | null; }
export interface PeerPoint { name: string; occupancy: number; price: number; is_own: boolean; is_benchmark: boolean; }
export interface PeerSummaryRow {
  id: number; name: string; benchmark_name: string | null; windows: PeerWindow[];
  points?: PeerPoint[]; median_price?: number | null;
}

const card = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const pct = (v: number | null | undefined) => (v == null ? '–' : `${v}%`);
const rand = (n: number) => `R${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
const ORANGE = '#eb6834';
const BLUE = '#2a78d6';
const GREY = '#B4B2A9';
const INK = '#898781';

function verdict(w: PeerWindow | undefined) {
  if (!w || w.own == null || w.median == null) return null;
  const gap = w.own - w.median;
  if (gap <= -5) return { text: `${-gap} pts behind`, cls: 'bg-[#FDECEA] text-[#C13515]' };
  if (gap >= 5) return { text: `${gap} pts ahead`, cls: 'bg-[#EAF4F0] text-[#0F6E56]' };
  return { text: 'level', cls: 'bg-[#F0F0F0] text-[#717171]' };
}

// Drawn by hand so the three kinds stay distinct without colour alone:
// a ringed dot for us, a diamond for the benchmark, a plain dot for the rest.
const dot = (fill: string, r: number, ring = false) => (props: any) =>
  <circle cx={props.cx} cy={props.cy} r={r} fill={fill} stroke={ring ? '#fff' : 'none'} strokeWidth={ring ? 2 : 0} />;
const diamond = (props: any) => {
  const { cx, cy } = props;
  const s = 8;
  return <path d={`M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z`} fill={BLUE} stroke="#fff" strokeWidth={2} />;
};

function Tip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const p: PeerPoint = payload[0].payload;
  return (
    <div className="bg-white rounded-[8px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] px-3 py-2 text-[12px]">
      <div className="font-semibold text-[#222222]">{p.is_own ? `${p.name} (you)` : p.name}</div>
      <div className="text-[#717171]">{p.occupancy}% taken · {rand(p.price)} a night</div>
    </div>);
}

function PositionChart({ row, height }: { row: PeerSummaryRow; height: number }) {
  const points = row.points || [];
  const w30 = row.windows.find((w) => w.days === 30);
  const medPrice = row.median_price || null;
  const medOcc = w30 ? w30.median : null;
  if (points.length < 2 || !medPrice) return null;

  // A listing priced at more than twice the median would squash every
  // other dot into one corner, so it is named under the chart instead.
  const outliers = points.filter((p) => !p.is_own && p.price > medPrice * 2);
  const shown = points.filter((p) => !outliers.includes(p));
  const prices = shown.map((p) => p.price);
  const lo = Math.max(0, Math.floor((Math.min(...prices) * 0.9) / 500) * 500);
  const hi = Math.ceil((Math.max(...prices) * 1.1) / 500) * 500;

  const others = shown.filter((p) => !p.is_own && !p.is_benchmark);
  const bench = shown.filter((p) => p.is_benchmark);
  const own = shown.filter((p) => p.is_own);
  const corner = (value: string, position: string) => ({ value, position, fill: INK, fontSize: 11 } as any);

  return (
    <div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 0 }}>
            <CartesianGrid stroke="#EFEEEA" />
            <XAxis
              type="number" dataKey="price" domain={[lo, hi]} tickCount={5}
              tickFormatter={(v) => `R${(v / 1000).toFixed(1)}k`}
              tick={{ fill: INK, fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: 'Price per night', position: 'insideBottom', offset: -12, fill: INK, fontSize: 11 }} />
            <YAxis
              type="number" dataKey="occupancy" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`} width={40}
              tick={{ fill: INK, fontSize: 11 }} axisLine={false} tickLine={false} />
            {medOcc != null &&
            <>
                <ReferenceArea x1={lo} x2={medPrice} y1={medOcc} y2={100} fillOpacity={0} label={corner('Fuller, cheaper', 'insideTopLeft')} />
                <ReferenceArea x1={medPrice} x2={hi} y1={medOcc} y2={100} fillOpacity={0} label={corner('Fuller, more expensive', 'insideTopRight')} />
                <ReferenceArea x1={lo} x2={medPrice} y1={0} y2={medOcc} fillOpacity={0} label={corner('Emptier, cheaper', 'insideBottomLeft')} />
                <ReferenceArea x1={medPrice} x2={hi} y1={0} y2={medOcc} fillOpacity={0} label={corner('Emptier, more expensive', 'insideBottomRight')} />
                <ReferenceLine y={medOcc} stroke={INK} strokeDasharray="5 4" />
              </>
            }
            <ReferenceLine x={medPrice} stroke={INK} strokeDasharray="5 4" />
            <Tooltip content={<Tip />} cursor={false} />
            <Scatter data={others} shape={dot(GREY, 6)} isAnimationActive={false} />
            <Scatter data={bench} shape={diamond} isAnimationActive={false} />
            <Scatter data={own} shape={dot(ORANGE, 9, true)} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[#717171] mt-1">
        <span className="flex items-center gap-1.5"><span className="w-[10px] h-[10px] rounded-full" style={{ background: ORANGE }} />You</span>
        {bench.length > 0 && <span className="flex items-center gap-1.5"><span className="w-[9px] h-[9px] rotate-45" style={{ background: BLUE }} />{row.benchmark_name}</span>}
        <span className="flex items-center gap-1.5"><span className="w-[8px] h-[8px] rounded-full" style={{ background: GREY }} />Other competitors</span>
        <span className="flex items-center gap-1.5"><span className="w-[14px] border-t border-dashed" style={{ borderColor: INK }} />Median</span>
      </div>
      {outliers.length > 0 &&
      <p className="text-[12px] text-[#B0B0B0] mt-1">
          Not shown, priced far above the rest: {outliers.map((o) => `${o.name} (${o.occupancy}%, ${rand(o.price)})`).join(', ')}.
        </p>
      }
    </div>);
}

export function PeersSummaryCards({ rows, propertyId = 0, onOpen, height = 240 }: {
  rows: PeerSummaryRow[]; propertyId?: number; onOpen?: () => void; height?: number;
}) {
  const shown = rows.filter((r) => !propertyId || r.id === propertyId);
  if (!shown.length) return null;
  return (
    <div className="space-y-3">
      {shown.map((p) => {
        const w30 = p.windows.find((w) => w.days === 30);
        const w90 = p.windows.find((w) => w.days === 90);
        const near = verdict(w30);
        return (
          <div
            key={p.id}
            className={`${card} px-4 py-3 ${onOpen ? 'cursor-pointer active:bg-[#F7F7F7]' : ''}`}
            onClick={onOpen}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[15px] font-semibold text-[#222222] truncate">{p.name}</span>
              <span className="flex items-center gap-1.5 shrink-0">
                {near && <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${near.cls}`}>{near.text}</span>}
                {onOpen && <ChevronRight className="w-4 h-4 text-[#B0B0B0]" />}
              </span>
            </div>
            <p className="text-[13px] text-[#717171] mb-2">
              Nights taken, next 30 days: <span className="font-semibold text-[#222222]">you {pct(w30?.own)}</span>
              {' · '}median {pct(w30?.median)}
              {p.benchmark_name && w30?.benchmark != null && <> · {p.benchmark_name} {pct(w30.benchmark)}</>}
              {w90 && <span className="text-[#B0B0B0]"> · 90 days: you {pct(w90.own)}, median {pct(w90.median)}</span>}
            </p>
            <PositionChart row={p} height={height} />
          </div>);
      })}
    </div>);
}

/** The Home version: fetches its own summary and opens Competitors on tap. */
export function PeersSummary({ propertyId = 0, onOpen }: { propertyId?: number; onOpen?: () => void }) {
  const [rows, setRows] = useState<PeerSummaryRow[] | null>(null);
  useEffect(() => {
    apiGet<{ properties: PeerSummaryRow[] }>('/api/peers/summary')
      .then((d) => setRows(d.properties))
      .catch(() => setRows([]));
  }, []);
  if (!rows || !rows.filter((r) => !propertyId || r.id === propertyId).length) return null;
  return (
    <div className="mb-6">
      <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
        Against competitors on Airbnb
      </div>
      <PeersSummaryCards rows={rows} propertyId={propertyId} onOpen={onOpen} height={220} />
    </div>);
}
