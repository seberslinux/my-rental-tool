import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Analysis, Period } from './PeerAnalysis';
import { ESTIMATE_NOTE } from './PeerAnalysis';
import type { FeatureProps } from './PeerFeatures';
import type { PeerSummaryRow } from './PeersSummary';
import { PropertyPeers, Run, cleaningSummary, competitorRows, daysAhead, defaultStay, nightlyRows, stayTable } from './peersShared';

/**
 * The Competitors page as a PDF anybody can open: the same figures, laid
 * out for paper rather than a screen. Real text and tables, the position
 * chart drawn in vectors, every listing name a link to its Airbnb page,
 * each property from a fresh page. A4 portrait.
 */

type RGB = [number, number, number];
const INK: RGB = [34, 34, 34];
const MUTED: RGB = [113, 113, 113];
const FAINT: RGB = [176, 176, 176];
const LINE: RGB = [224, 224, 224];
const ORANGE: RGB = [235, 104, 52];
const BLUE: RGB = [42, 120, 214];
const GREY: RGB = [180, 178, 169];
const GOLD: RGB = [201, 162, 39];
const GREEN: RGB = [15, 110, 86];
const RED: RGB = [193, 53, 21];
const PINK: RGB = [255, 56, 92];
const OWN_ROW: RGB = [244, 250, 247];

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14; // margin
const W = PAGE_W - 2 * M;

const SIGNS: Record<string, string> = { ZAR: 'R', EUR: '€', USD: '$', GBP: '£' };
const money = (n: number | null | undefined, c = 'ZAR') =>
  n == null ? '–' : `${SIGNS[c] || `${c} `}${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const monthShort = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'short' });
const monthLong = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
const weekSpan = (monday: string) => `${day(monday)} – ${day(new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10))}`;
const pct = (v: number | null | undefined) => (v == null ? '–' : `${v}%`);

// The standard PDF fonts carry Latin-1 and a few more (€, dashes, quotes,
// the middle dot); anything else — an emoji in a listing name — would print
// as noise, so it is dropped.
const EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const clean = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFC').split('').filter((c) => c.charCodeAt(0) <= 255 || EXTRA.has(c)).join('').replace(/\s+/g, ' ').trim();

interface Input {
  properties: PropertyPeers[];
  analysis: Analysis[];
  features: FeatureProps[];
  summary: PeerSummaryRow[];
  run: Run | null;
  filename: string;
}

export async function peersPdf({ properties, analysis, features, summary, run, filename }: Input) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const generated = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
  const readAt = run ? new Date(run.finished_at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  let y = M;

  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, style: 'normal' | 'bold' = 'normal', c: RGB = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    color(c);
  };
  /** Room for `h` mm more on this page, or a new one. */
  const room = (h: number) => {
    if (y + h > PAGE_H - M - 8) { doc.addPage(); y = M; }
  };
  const para = (text: string, size = 9, c: RGB = MUTED, style: 'normal' | 'bold' = 'normal') => {
    font(size, style, c);
    const lines = doc.splitTextToSize(clean(text), W) as string[];
    const h = lines.length * size * 0.42;
    room(h);
    doc.text(lines, M, y + size * 0.35);
    y += h + 1.5;
  };
  const heading = (text: string) => {
    room(16);
    y += 4;
    font(8.5, 'bold', FAINT);
    doc.text(clean(text).toUpperCase(), M, y);
    y += 4;
  };
  const after = () => { y = ((doc as any).lastAutoTable?.finalY ?? y) + 3; };

  const tableStyle = {
    theme: 'plain' as const,
    rowPageBreak: 'avoid' as const,
    margin: { left: M, right: M, bottom: M + 8 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 }, textColor: INK, lineColor: LINE, overflow: 'linebreak' as const },
    headStyles: { fontStyle: 'normal' as const, textColor: MUTED, fontSize: 7.5 },
    bodyStyles: { lineWidth: { top: 0.2 } as any },
  };

  const figuresRow = (who: string, p: Period | undefined, c: string, extra: string[] = []) =>
    !p || !p.bookings
      ? [who, '0', '0', '–', '–', '–', ...extra]
      : [who, String(p.bookings), String(p.nights), `${money(p.revenue, c)}${p.estimated && p.revenue != null ? '*' : ''}`, money(p.avg_nightly, c), daysAhead(p.median_lead_days), ...extra];

  properties.forEach((p, index) => {
    if (index > 0) doc.addPage();
    y = M;
    const c = p.currency || 'ZAR';
    const a = analysis.find((x) => x.id === p.id);
    const f = features.find((x) => x.id === p.id);
    const s = summary.find((x) => x.id === p.id);

    // Title.
    font(18, 'bold');
    doc.text(clean(p.name), M, y + 6);
    y += 10;
    para(`Competitor watch · read from Airbnb ${readAt || '–'} · ${p.listings.length} listings · asking prices for ${p.guests || 2} guests, in ${c}`, 8.5);

    // Where we stand.
    if (s) {
      heading('Where you stand');
      const w30 = s.windows.find((w) => w.days === 30);
      const w90 = s.windows.find((w) => w.days === 90);
      const gap = w30 && w30.own != null && w30.median != null ? w30.own - w30.median : null;
      const verdict = gap == null ? '' : gap <= -5 ? `${-gap} pts behind` : gap >= 5 ? `${gap} pts ahead` : 'level';
      font(10, 'normal', INK);
      doc.text(clean(`Nights taken, next 30 days: you ${pct(w30?.own)} · competitors' median ${pct(w30?.median)}`), M, y + 3.5);
      if (verdict) {
        font(10, 'bold', gap! <= -5 ? RED : gap! >= 5 ? GREEN : MUTED);
        doc.text(verdict, PAGE_W - M, y + 3.5, { align: 'right' });
      }
      y += 5;
      para([
        s.benchmark_name && w30?.benchmark != null ? `${s.benchmark_name}: ${pct(w30.benchmark)}` : '',
        w90 ? `Next 90 days: you ${pct(w90.own)}, median ${pct(w90.median)}` : '',
      ].filter(Boolean).join(' · '), 8.5);
      if (s.points && s.points.length) chart(s);
    }

    // What to do.
    if (a && a.suggestions.length) {
      heading('What to do');
      a.suggestions.forEach((x) => {
        font(9.5, 'normal', INK);
        const lines = doc.splitTextToSize(clean(x.text), W - 5) as string[];
        room(lines.length * 4.1 + 1.5);
        doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
        doc.circle(M + 1, y + 2.3, 0.8, 'F');
        doc.text(lines, M + 5, y + 3.2);
        y += lines.length * 4.1 + 1.5;
      });
    }

    // The same two-night stay at every listing, taken apart.
    const cleaningLine = cleaningSummary(p, (n) => money(n, c));
    const stay = defaultStay(p);
    if (stay) {
      const { rows: stayRows, median: stayMedian, share } = stayTable(p, a, stay);
      heading(`Price for the same stay: two nights from ${day(stay.date)}`);
      if (cleaningLine) para(cleaningLine, 8.5, INK);
      const stayBody: any[][] = stayRows.map(({ l, b, booked, leader }) => [
        `${l.is_own ? `You (${clean(l.name)})` : clean(l.name)}${l.is_benchmark ? '\nBENCHMARK' : ''}${leader ? '\nPRICE LEADER' : ''}`,
        ...(b ? [money(b.nightly, c), `${b.cleaning ? money(b.cleaning, c) : 'none'}${b.cleaningMeasured ? '' : '~'}`, money(b.fees, c), money(b.total, c)]
          : [{ content: booked ? 'booked those nights' : 'not quoted', colSpan: 4, styles: { textColor: FAINT, fontStyle: 'normal', halign: 'left' } }]),
      ]);
      if (stayMedian) stayBody.push(['Competitors (median)', money(stayMedian.nightly, c), money(stayMedian.cleaning, c), money(stayMedian.fees, c), money(stayMedian.total, c)]);
      const stayOf = (raw: unknown) => stayRows[stayBody.indexOf(raw as any[])];
      autoTable(doc, {
        ...tableStyle,
        startY: y,
        head: [['Listing', 'Nightly (no fees)', 'Cleaning & stay fees (once)', 'Airbnb fees a night', 'Total, 2 nights']],
        body: stayBody,
        columnStyles: { 0: { cellWidth: 62 }, 1: { halign: 'right', fontStyle: 'bold' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
        didParseCell: (d) => {
          if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right';
          if (d.section !== 'body') return;
          const r = stayOf(d.row.raw);
          if (r && r.l.is_own) d.cell.styles.fillColor = OWN_ROW;
          if (r && d.column.index === 0) d.cell.styles.textColor = BLUE;
          if (!r) { d.cell.styles.textColor = MUTED; d.cell.styles.lineWidth = { top: 0.5 } as any; }
        },
        didDrawCell: (d) => {
          const r = d.section === 'body' && d.column.index === 0 ? stayOf(d.row.raw) : null;
          if (r) doc.link(d.cell.x, d.cell.y, d.cell.width, d.cell.height, { url: r.l.url });
        },
      });
      after();
      para(`Total = 2 × nightly + cleaning & stay fees + 2 × Airbnb fees: the all-in price Airbnb shows, before taxes. Cleaning & stay fees are measured weekly per listing (~ is the competitors' average until one is). Airbnb's fees are ${Math.round(share * 1000) / 10}% of the nights${p.airbnb_fee_measured ? ', as it kept on your own Airbnb bookings' : ''}. Listing names open the listing on Airbnb.`, 7.5, FAINT);
    }

    // What each has sold since the watch began.
    heading('What they sold');
    if (a && a.total.bookings > 0) {
      const t = (q: Period | undefined) => (!q || !q.bookings ? 'nothing sold' :
        `${q.bookings} bookings, ${q.nights} nights, ${money(q.revenue, c)}${q.estimated ? '*' : ''}${q.avg_nightly != null ? ` at ${money(q.avg_nightly, c)} a night` : ''}${q.median_lead_days != null ? `, booked ${daysAhead(q.median_lead_days)} ahead` : ''}`);
      para(`Competitors${a.since ? ` since ${day(a.since)}` : ''}: ${t(a.total)}.`, 8.5, INK);
      para(`You, all channels: ${t(a.you)}.`, 8.5, GREEN);
    }
    const rows = competitorRows(p, a);
    const compBody = rows.map(({ l, s: sold, taken, leader }) => [
        `${l.is_own ? `You (${clean(l.name)})` : clean(l.name)}${l.is_benchmark ? '\nBENCHMARK' : ''}${leader ? '\nPRICE LEADER' : ''}`,
        taken == null ? '–' : `${taken}%`,
        String(sold ? sold.bookings : 0),
        String(sold ? sold.nights : 0),
        sold && sold.revenue != null ? `${money(sold.revenue, c)}${sold.estimated ? '*' : ''}` : '–',
        sold && sold.avg_nightly != null ? money(sold.avg_nightly, c) : '–',
        daysAhead(sold?.median_lead_days),
      ]);
    // Each body row back to its listing, by the row itself: autotable's
    // own row numbers do not survive a row split across pages.
    const rowOf = (raw: unknown) => rows[compBody.indexOf(raw as string[])];
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Listing', 'Taken next 30 days', 'Bookings', 'Nights', 'Sold for', 'Per night', 'Booked ahead']],
      body: compBody,
      columnStyles: { 0: { cellWidth: 56 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      didParseCell: (d) => {
        if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right';
        if (d.section !== 'body') return;
        const r = rowOf(d.row.raw);
        if (r && r.l.is_own) { d.cell.styles.fillColor = OWN_ROW; d.cell.styles.fontStyle = d.column.index === 0 ? 'bold' : 'normal'; }
        if (d.column.index === 0) d.cell.styles.textColor = BLUE;
      },
      didDrawCell: (d) => {
        const r = d.section === 'body' && d.column.index === 0 ? rowOf(d.row.raw) : null;
        if (r) doc.link(d.cell.x, d.cell.y, d.cell.width, d.cell.height, { url: r.l.url });
      },
    });
    after();
    para("Competitors' sales count their cleaning once per stay.", 7.5, FAINT);

    // When they sold.
    if (a) {
      const periodTable = (title: string, list: { label: string; p: Period; you?: Period }[]) => {
        if (!list.length) return;
        heading(title);
        const body: string[][] = [];
        list.forEach((r) => {
          body.push(figuresRow(r.label, r.p, c, ['Competitors', r.p.top_listing ? `${clean(r.p.top_listing.name)} (${r.p.top_listing.nights} nights)` : '–']));
          body.push(figuresRow('', r.you, c, ['You', '']));
        });
        // Columns: period, bookings, nights, sold for, per night, ahead, who, sold most — shown who-first.
        autoTable(doc, {
          ...tableStyle,
          startY: y,
          head: [['', 'Who', 'Bookings', 'Nights', 'Sold for', 'Per night', 'Booked ahead', 'Sold most']],
          body: body.map((b) => [b[0], b[6], b[1], b[2], b[3], b[4], b[5], b[7]]),
          columnStyles: { 0: { cellWidth: 30, fontStyle: 'bold' }, 1: { cellWidth: 19 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { cellWidth: 44, textColor: MUTED } },
          didParseCell: (d) => {
            if (d.section === 'head' && d.column.index >= 2 && d.column.index <= 6) d.cell.styles.halign = 'right';
            if (d.section !== 'body') return;
            const ours = (d.row.raw as string[])[1] === 'You';
            if (ours) { d.cell.styles.textColor = d.column.index === 7 ? MUTED : GREEN; d.cell.styles.lineWidth = 0; }
          },
        });
        after();
      };
      periodTable('Sales by the week they were booked', a.weeks.map((w) => ({ label: weekSpan(w.week), p: w, you: w.you })));
      periodTable('Sales by the month guests stay', a.months.map((m) => ({ label: monthLong(m.month), p: m, you: m.you })));
      periodTable('Sales by season', a.seasons.map((x) => ({ label: x.season, p: x, you: x.you })));

      const sales = a.weeks.flatMap((w) => w.sales.map((x) => ({ week: w.week, ...x })));
      if (sales.length) {
        heading('Every sale');
        const salesBody = sales.map((x) => [
          day(x.week),
          `${x.own ? `You${x.channel ? ` (${clean(x.channel)})` : ''}` : clean(x.name)}${x.leader ? ' · PRICE LEADER' : ''}`,
          `${day(x.check_in)} – ${day(x.check_out)}`,
          String(x.nights),
          daysAhead(x.lead_days),
          x.nightly != null ? `${money(x.nightly, c)}${x.estimated ? '*' : ''}` : '–',
        ]);
        autoTable(doc, {
          ...tableStyle,
          startY: y,
          head: [['Booked in week of', 'Listing', 'Stay', 'Nights', 'Booked ahead', 'Per night']],
          body: salesBody,
          columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 62 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
          didParseCell: (d) => {
            if (d.section === 'head' && d.column.index >= 3) d.cell.styles.halign = 'right';
            if (d.section === 'body' && sales[salesBody.indexOf(d.row.raw as string[])]?.own) d.cell.styles.textColor = GREEN;
          },
        });
        after();
      }
    }

    // The months ahead.
    heading('Ahead: nights taken per month');
    const monthRows: [string, (number | null)[], boolean][] = [];
    if (p.own) monthRows.push(['You', p.own.months, true]);
    if (p.benchmark) monthRows.push([clean(p.benchmark.name), p.benchmark.months, false]);
    monthRows.push(['Others (median)', p.peer_median, false]);
    const monthBody = monthRows.map(([n, v]) => [n, ...v.map(pct)]);
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['', ...p.months.map(monthShort)]],
      body: monthBody,
      columnStyles: { 0: { cellWidth: 50 } },
      didParseCell: (d) => {
        if (d.column.index > 0) d.cell.styles.halign = 'right';
        if (d.section !== 'body') return;
        const row = monthRows[monthBody.indexOf(d.row.raw as string[])];
        if (!row) return;
        const [, values, ours] = row;
        if (ours && d.column.index === 0) d.cell.styles.fontStyle = 'bold';
        const i = d.column.index - 1;
        if (ours && i >= 0 && values[i] != null && p.peer_median[i] != null && (values[i] as number) + 15 < (p.peer_median[i] as number)) {
          d.cell.styles.textColor = RED;
          d.cell.styles.fontStyle = 'bold';
        }
      },
    });
    after();

    const priceTable = (title: string, kind: 'weekend' | 'weekday') => {
      const { dates, rows: priceRows } = nightlyRows(p, a, kind);
      if (!dates.length) return;
      const body = priceRows.map((r) => [clean(r.name), ...r.values.map((v) => (v == null ? '–' : v === 'sold' ? 'sold' : money(v, c)))]);
      autoTable(doc, {
        ...tableStyle,
        startY: y,
        head: [[title, ...dates.map(day)]],
        body,
        columnStyles: { 0: { cellWidth: 46 } },
        didParseCell: (d) => {
          if (d.column.index > 0) d.cell.styles.halign = 'right';
          if (d.section === 'body' && d.cell.raw === 'sold') d.cell.styles.textColor = FAINT;
        },
      });
      after();
    };
    if (p.prices && (p.prices.weekends.length || p.prices.weekdays.length)) {
      heading(`Ahead: nightly price without fees or cleaning, ${p.guests || 2} guests`);
      priceTable('Weekend (Fri)', 'weekend');
      priceTable('Weekday (Mon)', 'weekday');
    }

    // What a renovation should aim at.
    if (f && f.snapshots.taken) {
      heading('What features earn');
      para(`From ${f.snapshots.taken} of ${f.snapshots.of} listings' Airbnb pages, against how each sells. Small groups: read it as a direction, not a law.`, 8.5);
      if (f.shortlist.length) {
        para('Worth adding', 9.5, INK, 'bold');
        f.shortlist.forEach((x) => {
          const bits: string[] = [];
          if (x.price_premium) bits.push(`they ask ${x.price_premium > 0 ? `${x.price_premium}% more` : `${-x.price_premium}% less`} (${money(x.price_with, c)} against ${money(x.price_without, c)})`);
          if (x.occupancy_gap) bits.push(`${x.occupancy_gap > 0 ? `${x.occupancy_gap} pts fuller` : `${-x.occupancy_gap} pts emptier`} over the next 90 days`);
          para(`${x.name}${x.kind === 'policy' ? ' (no building needed)' : ''}: ${x.with} of ${x.with + x.without} competitors have it; ${bits.join(' and ')}.`, 8.5, INK);
        });
      }
      if (f.leaders.length) {
        para("What the leaders have that you don't", 9.5, INK, 'bold');
        f.leaders.forEach((l) => para(
          `${l.name}${l.is_benchmark ? ' (benchmark)' : ''} — ${money(l.price, c)} a night, ${pct(l.occupancy)} of the next 90 days taken, ${l.rating ?? '–'} from ${l.reviews ?? '–'} reviews: ${l.has_and_you_lack.length ? l.has_and_you_lack.join(', ') : 'nothing on the feature list you lack — the gap is elsewhere (design, photos, reviews)'}.`,
          8.5, INK));
      }
      if (f.you && f.you.category_ratings) {
        const r = f.you.category_ratings;
        const mm = f.market_median;
        const scores: [string, number | null | undefined, number | null][] = [
          ['Overall', f.you.rating, mm.rating], ['Value', r.value, mm.value], ['Cleanliness', r.cleanliness, mm.cleanliness],
          ['Accuracy', r.accuracy, mm.accuracy], ['Photos', f.you.photos, mm.photos],
        ];
        autoTable(doc, {
          ...tableStyle,
          startY: y,
          tableWidth: 100,
          head: [['Score', 'You', 'Competitors (median)']],
          body: scores.map(([n, you, them]) => [n, you == null ? '–' : String(you), them == null ? '–' : String(Math.round(them * 100) / 100)]),
          didParseCell: (d) => {
            if (d.column.index > 0) d.cell.styles.halign = 'right';
            const row = scores[d.row.index] || [];
            if (d.section === 'body' && d.column.index === 1 && row[1] != null && row[2] != null && (row[1] as number) < (row[2] as number)) {
              d.cell.styles.textColor = RED; d.cell.styles.fontStyle = 'bold';
            }
          },
        });
        after();
      }
      if (f.features.length) {
        autoTable(doc, {
          ...tableStyle,
          startY: y,
          head: [['Feature', 'You', 'Have it', 'Price with / without', 'Taken with / without']],
          body: f.features.map((x) => [
            `${x.name}${x.kind === 'view' ? ' (view)' : ''}`,
            x.you ? 'yes' : '–',
            `${x.with} of ${x.with + x.without}`,
            `${money(x.price_with, c)} / ${money(x.price_without, c)}${x.price_premium != null ? ` (${x.price_premium > 0 ? '+' : ''}${x.price_premium}%)` : ''}`,
            `${pct(x.occupancy_with)} / ${pct(x.occupancy_without)}${x.occupancy_gap != null ? ` (${x.occupancy_gap > 0 ? '+' : ''}${x.occupancy_gap} pts)` : ''}`,
          ]),
          columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
          didParseCell: (d) => {
            if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right';
            if (d.section === 'body' && d.column.index === 1 && d.cell.raw === 'yes') d.cell.styles.textColor = GREEN;
          },
        });
        after();
      }
    }

    para(ESTIMATE_NOTE, 7.5, FAINT);
  });

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font(7.5, 'normal', FAINT);
    doc.text(clean(`Competitor watch · ${properties.map((p) => p.name).join(', ')} · ${generated}`), M, PAGE_H - M + 2);
    doc.text(`${i} / ${pages}`, PAGE_W - M, PAGE_H - M + 2, { align: 'right' });
  }
  doc.save(filename);

  /**
   * Price across, nights taken up, bubble area by money booked — the
   * page's chart, drawn for paper.
   */
  function chart(s: PeerSummaryRow) {
    const pts = s.points || [];
    const H = 78;
    room(H + 22);
    const left = M + 10, top = y + 2, w = W - 12, h = H - 12;
    const prices = pts.map((x) => x.price);
    let lo = Math.min(...prices), hi = Math.max(...prices);
    const pad = Math.max((hi - lo) * 0.08, 100);
    lo = Math.max(0, lo - pad); hi += pad;
    const X = (v: number) => left + ((v - lo) / (hi - lo)) * w;
    const Y = (v: number) => top + h - (v / 100) * h;
    const med = s.median_price ?? null;
    const competitors = pts.filter((x) => !x.is_own).map((x) => x.occupancy).sort((a, b) => a - b);
    const occMed = competitors.length ? competitors[Math.floor(competitors.length / 2)] : null;

    // Frame and grid.
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    [0, 25, 50, 75, 100].forEach((v) => {
      doc.line(left, Y(v), left + w, Y(v));
      font(7, 'normal', MUTED);
      doc.text(`${v}%`, left - 1.5, Y(v) + 1, { align: 'right' });
    });
    // Round steps — R2 000, R4 000 — rather than wherever a quarter falls.
    const rough = (hi - lo) / 4;
    const mag = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= rough) || rough;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.line(X(v), top + h, X(v), top + h + 1);
      font(7, 'normal', MUTED);
      doc.text(money(v, s.currency || 'ZAR'), X(v), top + h + 4, { align: 'center' });
    }
    font(7.5, 'normal', MUTED);
    doc.text('Price per night', left + w / 2, top + h + 8.5, { align: 'center' });
    font(7, 'normal', FAINT);
    doc.text('Fuller, cheaper', left + 1.5, top + 3.5);
    doc.text('Fuller, more expensive', left + w - 1.5, top + 3.5, { align: 'right' });
    doc.text('Emptier, cheaper', left + 1.5, top + h - 1.5);
    doc.text('Emptier, more expensive', left + w - 1.5, top + h - 1.5, { align: 'right' });

    // Medians, dashed.
    doc.setDrawColor(150, 150, 150);
    doc.setLineDashPattern([1, 1], 0);
    if (med != null) doc.line(X(med), top, X(med), top + h);
    if (occMed != null) doc.line(left, Y(occMed), left + w, Y(occMed));
    doc.setLineDashPattern([], 0);

    // Bubbles: area follows the money booked.
    const maxRev = Math.max(1, ...pts.map((x) => x.revenue || 0));
    const R = (rev?: number) => (rev ? 1.2 + 4.2 * Math.sqrt(rev / maxRev) : 1);
    const isLeader = (x: typeof pts[number]) => !x.is_own && med != null && x.price > med * 2;
    const order = [...pts].sort((a, b) => Number(a.is_own || a.is_benchmark) - Number(b.is_own || b.is_benchmark) || (b.revenue || 0) - (a.revenue || 0));
    const G = (doc as any).GState;
    for (const x of order) {
      const fill = x.is_own ? ORANGE : x.is_benchmark ? BLUE : GREY;
      doc.setGState(new G({ opacity: 0.8 }));
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.circle(X(x.price), Y(x.occupancy), R(x.revenue), 'F');
      doc.setGState(new G({ opacity: 1 }));
      const ring = isLeader(x) ? GOLD : x.is_own || x.is_benchmark ? ([255, 255, 255] as RGB) : null;
      if (ring) {
        doc.setDrawColor(ring[0], ring[1], ring[2]);
        doc.setLineWidth(0.5);
        doc.circle(X(x.price), Y(x.occupancy), R(x.revenue), 'S');
      }
      if (x.is_own || x.is_benchmark || isLeader(x)) {
        font(6.5, 'bold', x.is_own ? ORANGE : x.is_benchmark ? BLUE : GOLD);
        const name = x.is_own ? 'You' : clean(x.name).slice(0, 28);
        const right = X(x.price) + R(x.revenue) + 1 + doc.getTextWidth(name) > left + w;
        doc.text(name, right ? X(x.price) - R(x.revenue) - 1 : X(x.price) + R(x.revenue) + 1, Y(x.occupancy) + 1, { align: right ? 'right' : 'left' });
      }
    }
    doc.setLineWidth(0.2);
    y = top + h + 14;

    // Legend and what the size means.
    const legend: [RGB, string, RGB | null][] = [[ORANGE, 'You', null]];
    if (s.benchmark_name) legend.push([BLUE, clean(s.benchmark_name), null]);
    if (pts.some(isLeader)) legend.push([GREY, 'Price leader', GOLD]);
    legend.push([GREY, 'Other competitors', null]);
    let lx = M;
    font(7.5, 'normal', MUTED);
    legend.forEach(([fill, text, ring]) => {
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.circle(lx + 1.3, y - 0.9, 1.3, 'F');
      if (ring) { doc.setDrawColor(ring[0], ring[1], ring[2]); doc.setLineWidth(0.4); doc.circle(lx + 1.3, y - 0.9, 1.3, 'S'); doc.setLineWidth(0.2); }
      doc.text(text, lx + 3.6, y);
      lx += 3.6 + doc.getTextWidth(text) + 5;
    });
    y += 3;
    para(`Dashed lines: the competitors' medians. Bubble size: money booked for the next ${s.revenue_days || 30} nights — competitors' taken nights at their nearest quoted price, yours from Smoobu.`, 7.5, FAINT);
  }
}
