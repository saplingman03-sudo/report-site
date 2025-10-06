import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
  ComposedChart, Line, PieChart, Pie, Cell
} from "recharts";

// ===================== 型別 =====================
type Row = {
  月份?: string; // 例如 "2025-07"、"2025/08"、"2025-08"
  代理商: string;
  商戶: string;
  開分量: number;
  營業額: number;
  比率: number; // 營業額/開分量
  [key: string]: any; // 額外欄位（機台數量/備註/營業時間...）
};

// ===================== Demo 資料（不上傳也能看） =====================
const seed: Row[] = [
  { 月份: "2025-07", 代理商: "金傑克", 商戶: "萬豪",   開分量: 1200000, 營業額: 300000, 比率: 300000/1200000 },
  { 月份: "2025-07", 代理商: "金傑克", 商戶: "新吉星", 開分量:  900000, 營業額: 210000, 比率: 210000/ 900000 },
  { 月份: "2025-08", 代理商: "阿峰",   商戶: "千弈",   開分量:  500000, 營業額: 150000, 比率: 150000/ 500000 },
  { 月份: "2025-08", 代理商: "阿峰",   商戶: "布拉德", 開分量:  380000, 營業額:  98000, 比率:  98000/ 380000 },
  { 月份: "2025-08", 代理商: "國正",   商戶: "皇室",   開分量:  350000, 營業額:  70000, 比率:  70000/ 350000 },
];

// ===================== 小工具 =====================
const BAR_COLOR = "#8ec8ff"; // 一致的淺藍色長條

const [monthFilter, setMonthFilter] = useState<string>("ALL");


const num = (v:any) => {
  if (v===null || v===undefined || v==="") return 0;
  const n = Number(String(v).replace(/[\,\s%]/g,""));
  return Number.isFinite(n) ? n : 0;
};
const money = (n:number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n/1_000_000).toFixed(2)+" 百萬";
  if (a >= 10_000)   return (n/10_000).toFixed(2)+" 萬";
  return n.toLocaleString();
};

// 正規化月份字串（從欄位或使用者指定的本批月份）
const normalizeMonth = (s?: string): string | undefined => {
  if (!s) return undefined;
  const t = String(s).trim();
  // 支援 "2025-07"、"2025/07"、"2025.07"、"Jul 2025"、"2025年7月"、"7月"（會自動補今年）
  const m1 = t.match(/(20\d{2})[\-/\.年]?(\d{1,2})/);
  if (m1) {
    const y = m1[1];
    const mm = String(Number(m1[2])).padStart(2, "0");
    return `${y}-${mm}`;
  }
  const m2 = t.match(/(\d{1,2})\s*月/);
  if (m2) {
    const y = new Date().getFullYear();
    const mm = String(Number(m2[1])).padStart(2, "0");
    return `${y}-${mm}`;
  }
  return undefined;
};

// 自動產生 HSL 配色（Pie/多系列用）
const usePalette = (count: number) => React.useMemo(() => {
  const res: string[] = [];
  for (let i=0; i<count; i++) {
    const hue = Math.round((360/count) * i);
    res.push(`hsl(${hue} 70% 60%)`);
  }
  return res;
}, [count]);

// ===================== 統計 hooks（依目前篩選結果） =====================
const useParetoByMerchant = (rows: Row[]) => React.useMemo(() => {
  const m = new Map<string, number>();
  rows.forEach(r => m.set(r.商戶, (m.get(r.商戶) ?? 0) + r.開分量));
  const list = Array.from(m, ([商戶, 開分量]) => ({ 商戶, 開分量 }))
    .sort((a,b)=> b.開分量 - a.開分量);
  const total = list.reduce((s,d)=>s+d.開分量,0) || 1;
  let cum = 0;
  return list.map(d => ({ ...d, 累積比例: +(((cum += d.開分量)/total*100).toFixed(2)) }));
}, [rows]);

const useRatioHistogram = (rows: Row[], step=0.05) => React.useMemo(() => {
  if (!rows.length) return [] as { 區間: string; 數量: number; _a:number; _b:number }[];
  let min = Math.min(...rows.map(r => r.比率));
  let max = Math.max(...rows.map(r => r.比率));
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;

  const toStep = (x:number, f:(v:number)=>number) => f(x/step)*step;
  const lo = toStep(min - step, Math.floor);
  const hi = toStep(max + step, Math.ceil);

  const bins: { 區間: string; 數量: number; _a:number; _b:number }[] = [];
  for (let a=lo; a<hi; a+=step) {
    const b = +(a + step).toFixed(10);
    bins.push({ 區間: `${(a*100).toFixed(0)}%~${(b*100).toFixed(0)}%`, 數量:0, _a:a, _b:b });
  }
  rows.forEach(r=>{
    const x = Math.min(r.比率, hi - 1e-12);
    const idx = Math.max(0, Math.min(bins.length-1, Math.floor((x - lo)/step)));
    bins[idx].數量++;
  });
  return bins;
}, [rows, step]);

const useRevenueShareByAgent = (rows: Row[]) => React.useMemo(()=>{
  const m = new Map<string, number>();
  rows.forEach(r=> m.set(r.代理商, (m.get(r.代理商) ?? 0) + r.營業額));
  return Array.from(m, ([name, value]) => ({ name, value }))
    .sort((a,b)=> b.value - a.value);
}, [rows]);

const useTopOpenByMerchant = (rows: Row[], n=10) => React.useMemo(()=>{
  const m = new Map<string, number>();
  rows.forEach(r=> m.set(r.商戶, (m.get(r.商戶) ?? 0) + r.開分量));
  return Array.from(m, ([商戶, 開分量]) => ({ 商戶, 開分量 }))
    .sort((a,b)=> b.開分量 - a.開分量)
    .slice(0, n)
    .reverse();
}, [rows, n]);

// ===================== 主元件 =====================
export default function App() {
  // 原始資料（支援累積上傳）
  const [rows, setRows] = useState<Row[]>(seed);

  // 篩選
  const [agent, setAgent] = useState("ALL");
  const [merchant, setMerchant] = useState("ALL");
  const [excludeAgent, setExcludeAgent] = useState("");
  const [topN, setTopN] = useState(10);

  // 搜尋/排序/分頁（保持輕量，只做 TopN 與篩選）
  const [q, setQ] = useState("");

  // ===== 新增："多月累積 & 對比" 控制 =====
  const monthSet = useMemo(()=> Array.from(new Set(rows.map(r=>r.月份).filter(Boolean))) as string[], [rows]);
  const [appendMode, setAppendMode] = useState(true); // 勾選 = 追加。不勾 = 覆蓋
  const [batchMonth, setBatchMonth] = useState(""); // 使用者指定：本批月份（若檔案內沒有"月份"欄位時使用）
  const [keyJoin, setKeyJoin] = useState<"代理商+商戶" | "商戶">("代理商+商戶");
  const [monthA, setMonthA] = useState<string | undefined>(monthSet[0]);
  const [monthB, setMonthB] = useState<string | undefined>(monthSet[1] ?? monthSet[0]);

  // 上傳 Excel/CSV（可選擇：覆蓋/追加；可指定本批月份；支援多檔）
  const onFiles = async (files: FileList | null) => {
    if (!files || files.length===0) return;

    const parseOne = async (file: File): Promise<Row[]> => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const toRow = (r:any): Row => {
        const agent = String(r["代理商"] ?? r["代理"] ?? r["Agent"] ?? "").trim();
        const store = String(r["商戶"]   ?? r["Store"] ?? "").trim();
        const open  = num(r["開分量"]     ?? r["開分"]   ?? r["Open"]);
        const rev   = num(r["營業額"]     ?? r["Revenue"]?? r["Sales"]);
        const ratioSrc = r["營業額/開分量"] ?? r["營業額/開分量百分比"] ?? r["Revenue/Open"] ?? r["ROI"] ?? "";
        const raw = String(ratioSrc);
        const ratio = raw === "" ? (open>0 ? rev/open : 0)
                     : raw.includes("%") ? num(raw)/100 : num(raw);
        const machine = r["機台數量"] ?? r["機台"] ?? r["Machines"];
        const note    = r["備註"]     ?? r["Remark"] ?? r["Note"];
        const low25   = r["開分量低於25%"] ?? r["低於25%"];
        const hours   = r["營業時間"] ?? r["Hours"];
        const m = normalizeMonth(
          r["月份"] ?? r["月"] ?? r["Month"] ?? r["日期"] ?? r["Date"] ?? batchMonth
        );
        return {
          月份: m, 代理商: agent, 商戶: store, 開分量: open, 營業額: rev, 比率: ratio,
          "機台數量": machine, "備註": note, "開分量低於25%": low25, "營業時間": hours
        };
      };

      const fromCSV = (): Promise<Row[]> => new Promise((resolve) => {
        Papa.parse(file, {
          header: true, skipEmptyLines: true,
          complete: (res) => resolve(((res.data as any[])||[]).map(toRow).filter(x=>x.代理商 && x.商戶))
        });
      });

      if (ext === "csv") return fromCSV();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws, { raw: false });
      return json.map(toRow).filter(x=>x.代理商 && x.商戶);
    };

    const batches: Row[][] = [];
    for (const f of Array.from(files)) {
      // 若未指定月份且檔案內也找不到月份，將試圖從檔名推斷
      if (!batchMonth) {
        const fromName = normalizeMonth(f.name);
        if (fromName) setBatchMonth(v=> v || fromName);
      }
      const rowsOne = await parseOne(f);
      batches.push(rowsOne);
    }

    // 沒有月份就用 batchMonth（若 batchMonth 也沒填，就標記為 "未指定"）
    const merged = batches.flat().map(r => ({
      ...r,
      月份: r.月份 ?? normalizeMonth(batchMonth) ?? "未指定",
    }));

    if (appendMode) setRows(prev => [...prev, ...merged]);
    else setRows(merged);

    // 更新月份選單預設
    const months = Array.from(new Set(merged.map(r=>r.月份))).filter(Boolean) as string[];
    if (months.length) {
      setMonthA(months[0]);
      setMonthB(months[1] ?? months[0]);
    }
  };

  // ====== 選單資料 ======
  const agents = useMemo(()=>Array.from(new Set(rows.map(r=>r.代理商))),[rows]);
  const merchants = useMemo(()=>{
    const base = agent==="ALL" ? rows : rows.filter(r=>r.代理商===agent);
    return Array.from(new Set(base.map(r=>r.商戶)));
  },[rows, agent]);

  // ====== 篩選 + 搜尋 ======
  const filtered = useMemo(()=>{
    let d = rows;
    if (agent!=="ALL") d = d.filter(r=>r.代理商===agent);
    if (merchant!=="ALL") d = d.filter(r=>r.商戶===merchant);
    if (excludeAgent.trim()) d = d.filter(r=>r.代理商!==excludeAgent.trim());
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      d = d.filter(r => r.代理商.toLowerCase().includes(s) || r.商戶.toLowerCase().includes(s));
    }
    if (monthFilter!=="ALL") d = d.filter(r => r.月份 === monthFilter);

    return d;
  },[rows, agent, merchant, excludeAgent, q]);

  // ====== KPI（依目前篩選） ======
  const kpi = useMemo(()=>({
    open: filtered.reduce((s,r)=>s+r.開分量,0),
    rev:  filtered.reduce((s,r)=>s+r.營業額,0),
    ratio: filtered.length ? filtered.reduce((s,r)=>s+r.比率,0)/filtered.length : 0
  }),[filtered]);

  // ====== 圖表資料（依目前篩選） ======
  const hist    = useRatioHistogram(filtered, 0.05);
  const share   = useRevenueShareByAgent(filtered);
  const topOpen = useTopOpenByMerchant(filtered, topN);
  const pieColors = usePalette(share.length);

  // ====== 對比表（選兩個月份，方便複製貼上） ======
  const compareRows = useMemo(()=>{
    if (!monthA || !monthB) return [] as any[];
    const A = rows.filter(r=>r.月份===monthA);
    const B = rows.filter(r=>r.月份===monthB);
    const keyFn = (r: Row) => keyJoin === "商戶" ? r.商戶 : `${r.代理商}__${r.商戶}`;
    const mapA = new Map<string, Row>();
    const mapB = new Map<string, Row>();
    A.forEach(r=> mapA.set(keyFn(r), r));
    B.forEach(r=> mapB.set(keyFn(r), r));
    const keys = new Set<string>([...mapA.keys(), ...mapB.keys()]);
    const out: any[] = [];
    keys.forEach(k => {
      const a = mapA.get(k); const b = mapB.get(k);
      const 代理商 = a?.代理商 ?? b?.代理商 ?? "";
      const 商戶 = a?.商戶 ?? b?.商戶 ?? "";
      const 開A = a?.開分量 ?? 0; const 開B = b?.開分量 ?? 0;
      const 營A = a?.營業額 ?? 0; const 營B = b?.營業額 ?? 0;
      const 比A = a?.比率 ?? 0;   const 比B = b?.比率 ?? 0;
      out.push({
        代理商, 商戶,
        [`開分量@${monthA}`]: 開A,
        [`開分量@${monthB}`]: 開B,
        "Δ開分量": 開B - 開A,
        [`營業額@${monthA}`]: 營A,
        [`營業額@${monthB}`]: 營B,
        "Δ營業額": 營B - 營A,
        [`比率@${monthA}`]: 比A,
        [`比率@${monthB}`]: 比B,
        "Δ比率": 比B - 比A,
      });
    });
    out.sort((a,b)=> (b["Δ營業額"] ?? 0) - (a["Δ營業額"] ?? 0));
    return out;
  }, [rows, monthA, monthB, keyJoin]);

  const copyTSV = () => {
    if (!compareRows.length) return;
    const cols = Object.keys(compareRows[0]);
    const lines = [cols.join("\t"), ...compareRows.map(r=> cols.map(c=> {
      const v = (r as any)[c];
      if (typeof v === "number") return String(v);
      return (v ?? "").toString().replace(/\t/g, " ");
    }).join("\t"))];
    navigator.clipboard.writeText(lines.join("\n"));
    alert("已複製成 TSV，可直接貼到 Excel / Google Sheets。");
  };

  const exportCSV = () => {
    if (!compareRows.length) return;
    const ws = XLSX.utils.json_to_sheet(compareRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Compare");
    XLSX.writeFile(wb, `compare_${monthA}_vs_${monthB}.csv`);
  };

  return (
    <div className="min-h-screen p-6 space-y-6 bg-slate-50">
      <h1 className="text-3xl font-bold">📊 開分量 / 營業額（多月累積與對比版）</h1>

      {/* 上傳區（支援多檔、追加、指定月份） */}
      <div className="p-4 bg-white rounded-2xl border shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={e=>onFiles(e.target.files)} className="border rounded px-3 h-10 bg-white" />
          <input placeholder="本批月份（例如：2025-07 或 2025年7月）若檔內無月份欄位則套用此值" value={batchMonth} onChange={e=>setBatchMonth(e.target.value)} className="border rounded px-3 h-10 w-[360px] bg-white" />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={appendMode} onChange={e=>setAppendMode(e.target.checked)} /> 追加到現有資料（取消打勾＝覆蓋）
          </label>
          <button className="ml-auto border rounded h-10 px-3 bg-white" onClick={()=>{ setRows([]); setMonthA(undefined); setMonthB(undefined); }}>清空資料</button>
        </div>
        <p className="text-sm text-gray-500">提示：你也可以把 7 月與 8 月放在同一個 Excel，只要有「月份」欄位（或「日期/Month」），系統會自動辨識。</p>
      </div>

      {/* 篩選 + 搜尋 + TopN */}
      <div className="flex flex-wrap items-center gap-3">
        <select className="border rounded h-10 px-3 bg-white" value={agent} onChange={e=>{setAgent(e.target.value); setMerchant("ALL");}}>
          <option value="ALL">全部代理商</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="border rounded h-10 px-3 bg-white" value={merchant} onChange={e=>setMerchant(e.target.value)}>
          <option value="ALL">全部商戶</option>
          {merchants.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input placeholder="排除某代理商（例：金傑克）" value={excludeAgent} onChange={e=>setExcludeAgent(e.target.value)} className="border rounded px-3 h-10 w-64 bg-white" />
        <input placeholder="搜尋代理商/商戶" value={q} onChange={e=>setQ(e.target.value)} className="border rounded px-3 h-10 w-56 bg-white" />
        <select className="border rounded h-10 px-3 bg-white" value={topN} onChange={e=>setTopN(Number(e.target.value))}>
          {[5,10,15,20].map(n => <option key={n} value={n}>Top {n}</option>)}
        </select>
      </div>
      <select
  className="border rounded h-10 px-3 bg-white"
  value={monthFilter}
  onChange={e => setMonthFilter(e.target.value)}
>
  <option value="ALL">全部月份</option>
  {monthSet.map(m => <option key={m} value={m}>{m}</option>)}
</select>


      {/* KPI（依目前篩選） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-2xl border shadow-sm">
          <p className="text-gray-500">總開分量</p>
          <p className="text-2xl md:text-3xl font-bold">{money(kpi.open)}</p>
        </div>
        <div className="p-4 bg-white rounded-2xl border shadow-sm">
          <p className="text-gray-500">總營業額</p>
          <p className="text-2xl md:text-3xl font-bold">{money(kpi.rev)}</p>
        </div>
        <div className="p-4 bg-white rounded-2xl border shadow-sm">
          <p className="text-gray-500">平均 營業額/開分量</p>
          <p className="text-2xl md:text-3xl font-bold">{(kpi.ratio*100).toFixed(2)}%</p>
        </div>
      </div>

      {/* 圖表群（加上 margin/dy 避免擋到刻度） */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-white rounded-2xl border shadow-sm h-[500px]">
          <h2 className="font-semibold mb-2">開分量帕累托（含累積比例）</h2>
          <ResponsiveContainer width="100%" height="80%">
            <ComposedChart data={useParetoByMerchant(filtered)} margin={{ top: 20, right: 20, bottom:5, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="商戶" tick={{ fontSize: 16 }} />
              <YAxis yAxisId="left" tickFormatter={(v)=>money(Number(v))} />
              <YAxis yAxisId="right" orientation="right" domain={[0,100]} tickFormatter={(v)=>`${v}%`} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="開分量" name="開分量" fill={BAR_COLOR} />
              <Line yAxisId="right" type="monotone" dataKey="累積比例" name="累積比例(%)" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="p-4 bg-white rounded-2xl border shadow-sm h-[320px]">
          <h2 className="font-semibold mb-2">營業額/開分量 分布（直方圖）</h2>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hist} margin={{ top: 30, right: 50, left: 100, bottom: 80 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="區間" tick={{ fontSize: 13 }} dy={10} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="數量" name="筆數" fill={BAR_COLOR} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="p-4 bg-white rounded-2xl border shadow-sm h-[400px]">
          <h2 className="font-semibold mb-2">代理商營業額占比</h2>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip formatter={(v:any)=>money(Number(v))} />
              <Legend verticalAlign="bottom" />
              <Pie data={share} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius="70%" label labelLine={false} paddingAngle={1}>
                {share.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="p-4 bg-white rounded-2xl border shadow-sm h-[800px]">
          <h2 className="font-semibold mb-2">開分量 Top {topN} 商戶</h2>
          <ResponsiveContainer width="80%" height="80%">
            <BarChart
  data={topOpen}
  layout="vertical"
  barCategoryGap="20%"                // ★ 移到這裡
  margin={{ top: 10, right: 20, bottom: 20, left: 120 }}
>
  <CartesianGrid strokeDasharray="3 3" />
  <XAxis type="number" tickFormatter={(v)=>money(Number(v))} />
  <YAxis type="category" dataKey="商戶" interval={0} />
  <Tooltip formatter={(v:any)=>money(Number(v))} />
  <Bar dataKey="開分量" name="開分量" fill={BAR_COLOR} />
</BarChart>

          </ResponsiveContainer>
        </div>
      </div>

      {/* ====== 月份對比（方便複製貼上） ====== */}
      <div className="p-4 bg-white rounded-2xl border shadow-sm">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="font-semibold mr-2">月份對比</h2>
          <select className="border rounded h-10 px-3 bg-white" value={monthA ?? ""} onChange={e=>setMonthA(e.target.value || undefined)}>
            <option value="">選擇 A 月份</option>
            {monthSet.map(m=> <option key={m} value={m}>{m}</option>)}
          </select>
          <span>vs</span>
          <select className="border rounded h-10 px-3 bg-white" value={monthB ?? ""} onChange={e=>setMonthB(e.target.value || undefined)}>
            <option value="">選擇 B 月份</option>
            {monthSet.map(m=> <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="border rounded h-10 px-3 bg-white" value={keyJoin} onChange={e=> (setKeyJoin(e.target.value as any))}>
            <option value="代理商+商戶">合併鍵：代理商+商戶</option>
            <option value="商戶">合併鍵：商戶</option>
          </select>
          <button className="ml-auto border rounded h-10 px-3 bg-white disabled:opacity-50" disabled={!compareRows.length} onClick={copyTSV}>複製成 TSV</button>
          <button className="border rounded h-10 px-3 bg-white disabled:opacity-50" disabled={!compareRows.length} onClick={exportCSV}>下載 CSV</button>
        </div>

        {monthA && monthB && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {(() => {
              const sum = (m?:string, f:(r:Row)=>number= r=>r.營業額)=> rows.filter(r=>r.月份===m).reduce((s,r)=>s+f(r),0);
              const openA = sum(monthA, r=>r.開分量), openB = sum(monthB, r=>r.開分量);
              const revA  = sum(monthA, r=>r.營業額), revB  = sum(monthB, r=>r.營業額);
              const ratioA = (()=>{ const arr=rows.filter(r=>r.月份===monthA); return arr.length? arr.reduce((s,r)=>s+r.比率,0)/arr.length:0;})()
              const ratioB = (()=>{ const arr=rows.filter(r=>r.月份===monthB); return arr.length? arr.reduce((s,r)=>s+r.比率,0)/arr.length:0;})()
              return (
                <>
                  <div className="p-4 bg-white rounded-2xl border shadow-sm">
                    <p className="text-gray-500">總開分量：{monthA} → {monthB}</p>
                    <p className="text-xl md:text-2xl font-bold">{money(openA)} → {money(openB)} <span className={openB-openA>=0?"text-green-600":"text-red-600"}>({openB-openA>=0?"+":""}{money(openB-openA)})</span></p>
                  </div>
                  <div className="p-4 bg-white rounded-2xl border shadow-sm">
                    <p className="text-gray-500">總營業額：{monthA} → {monthB}</p>
                    <p className="text-xl md:text-2xl font-bold">{money(revA)} → {money(revB)} <span className={revB-revA>=0?"text-green-600":"text-red-600"}>({revB-revA>=0?"+":""}{money(revB-revA)})</span></p>
                  </div>
                  <div className="p-4 bg-white rounded-2xl border shadow-sm">
                    <p className="text-gray-500">平均比率：{monthA} → {monthB}</p>
                    <p className="text-xl md:text-2xl font-bold">{(ratioA*100).toFixed(2)}% → {(ratioB*100).toFixed(2)}% <span className={ratioB-ratioA>=0?"text-green-600":"text-red-600"}>({((ratioB-ratioA)*100).toFixed(2)}%)</span></p>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* 對比明細表（可複製） */}
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-gray-100">
              <tr className="[&>th]:px-3 [&>th]:py-2 text-left whitespace-nowrap">
                {compareRows.length>0 && Object.keys(compareRows[0]).map(k=> <th key={k}>{k}</th>)}
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(odd)]:bg-gray-50">
              {compareRows.map((r, i) => (
                <tr key={i} className="[&>td]:px-3 [&>td]:py-2 whitespace-nowrap">
                  {Object.keys(r).map((k)=>{
                    const v = r[k];
                    if (typeof v === "number") {
                      if (k.startsWith("比率") || k === "Δ比率") return <td key={k}>{(v*100).toFixed(2)}%</td>;
                      if (k.startsWith("開分量") || k.startsWith("營業額") || k.startsWith("Δ")) return <td key={k}>{money(v)}</td>;
                    }
                    return <td key={k}>{String(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 明細表（單月/多月混合視圖） */}
      <div className="p-4 bg-white rounded-2xl border shadow-sm overflow-auto">
        <h2 className="font-semibold mb-3">明細表</h2>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-100">
            <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
              <th>月份</th><th>代理商</th><th>商戶</th>
              <th className="whitespace-nowrap">開分量</th>
              <th className="whitespace-nowrap">營業額</th>
              <th className="whitespace-nowrap">營業額/開分量</th>
              {"機台數量" in (rows[0]||{}) && <th>機台數量</th>}
              {"備註" in (rows[0]||{}) && <th>備註</th>}
              {"開分量低於25%" in (rows[0]||{}) && <th>開分量低於25%</th>}
              {"營業時間" in (rows[0]||{}) && <th>營業時間</th>}
            </tr>
          </thead>
          <tbody className="[&>tr:nth-child(odd)]:bg-gray-50">
            {filtered.map((r, i) => (
              <tr key={i} className="[&>td]:px-3 [&>td]:py-2">
                <td>{r.月份 ?? "—"}</td>
                <td>{r.代理商}</td>
                <td>{r.商戶}</td>
                <td>{money(r.開分量)}</td>
                <td>{money(r.營業額)}</td>
                <td>{(r.比率*100).toFixed(2)}%</td>
                {"機台數量" in r && <td>{r["機台數量"]}</td>}
                {"備註" in r && <td>{r["備註"]}</td>}
                {"開分量低於25%" in r && <td>{r["開分量低於25%"]}</td>}
                {"營業時間" in r && <td>{r["營業時間"]}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 小提示：部署 */}
      <div className="p-4 bg-white rounded-2xl border shadow-sm">
        <h3 className="font-semibold mb-1">部署小提示</h3>
        <p className="text-sm text-gray-600">把專案推到 GitHub，然後用 Vercel 一鍵部署。資料由使用者本地上傳，免後端。</p>
      </div>
    </div>
  );
}