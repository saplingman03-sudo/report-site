import React, { useMemo, useState, useEffect } from "react";
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

// 讓網址與上傳共用的轉換器
const toRow = (r:any, batchMonth:string): Row => {
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

// 從「已發佈的 CSV 網址」載入
async function loadFromCsvUrl(url:string, batchMonth:string) {
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now());
  const text = await res.text();
  return new Promise<Row[]>((resolve)=>{
    Papa.parse(text, {
      header: true, skipEmptyLines: true,
      complete: (r:any)=> resolve(((r.data as any[])||[])
        .map(row => toRow(row, batchMonth))
        .filter(x=>x.代理商 && x.商戶))
    });
  });
}

// 從「JSON 網址」載入
async function loadFromJsonUrl(url:string, batchMonth:string) {
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now());
  const arr = await res.json();
  return (Array.isArray(arr)? arr: []).map((row:any)=> toRow(row, batchMonth))
    .filter(x=>x.代理商 && x.商戶);
}

// 正規化月份字串
const normalizeMonth = (s?: string): string | undefined => {
  if (!s) return undefined;
  const t = String(s).trim();
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

// 自動配色
const usePalette = (count: number) => React.useMemo(() => {
  const res: string[] = [];
  for (let i=0; i<count; i++) {
    const hue = Math.round((360/count) * i);
    res.push(`hsl(${hue} 70% 60%)`);
  }
  return res;
}, [count]);

// ===================== 統計 hooks =====================
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

  // 讀取資料來源 & 管理者模式
  const params = new URLSearchParams(location.search);
  const DATA_URL =
    params.get("source") ||
    (import.meta as any).env?.VITE_DATA_URL ||
    "";
  const isAdmin = params.has("admin");

  // 掛載時若有網址資料來源就自動載入
  useEffect(() => {
    if (!DATA_URL) return;
    const isCsv =
      /\.csv(\?|$)/i.test(DATA_URL) ||
      /[?&](output|format)=csv\b/i.test(DATA_URL);
    (async () => {
      try {
        const loaded = isCsv
          ? await loadFromCsvUrl(DATA_URL, "")
          : await loadFromJsonUrl(DATA_URL, "");
        if (loaded.length) setRows(loaded);
      } catch (e) {
        console.error("[DATA] 載入失敗", e);
      }
    })();
  }, [DATA_URL]);

  type SortKey = '月份' | '代理商' | '商戶' | '開分量' | '營業額' | '比例';

  // 轉成 YYYY-MM（支援 2025-8 -> 2025-08）
  const normMonth = (m: any) => {
    if (m == null) return '';
    const s = String(m).trim();
    const [y, raw] = s.split('-');
    if (!y || !raw) return s;
    const mm = String(raw).padStart(2, '0');
    return `${y}-${mm}`;
  };

  // 依資料自動蒐集所有月份（升冪）
  const allMonths = useMemo(
    () => Array.from(new Set(rows.map((r: any) => normMonth(r.月份)))).sort(),
    [rows]
  );

  // 多選月份（預設：全部勾選）
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  useEffect(() => {
    if (allMonths.length && selectedMonths.length === 0) {
      setSelectedMonths(allMonths);
    }
  }, [allMonths, selectedMonths.length]);

  // 每月筆數
  const monthCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r: any) => {
      const k = normMonth(r.月份);
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [rows]);

  const pickAll  = () => setSelectedMonths(allMonths);
  const clearAll = () => setSelectedMonths([]);
  const quickPick = (n: number) => setSelectedMonths(allMonths.slice(-n)); // 最近 n 個月

  // 先預設按「營業額 由大到小」
  const [sorter, setSorter] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: '營業額', dir: 'desc'
  });

  // 把「萬/百萬/億/%」這些字串轉成數值
  const coerceNumber = (v: any) => {
    if (typeof v === 'number') return v;
    if (v == null) return 0;
    let s = String(v).replace(/,/g, '').trim();
    if (s.endsWith('%')) return parseFloat(s.replace('%', '')) / 100;

    let mult = 1;
    if (s.includes('億')) mult = 1e8;
    else if (s.includes('百萬')) mult = 1e6;
    else if (s.includes('萬')) mult = 1e4;

    s = s.replace(/[^\d.\-]/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n * mult : 0;
  };

  const getSortValue = (row: any, key: SortKey) => {
    switch (key) {
      case '月份':   return row.月份 ?? '';
      case '代理商': return row.代理商 ?? '';
      case '商戶':   return row.商戶 ?? '';
      case '開分量': return coerceNumber(row.開分量);
      case '營業額': return coerceNumber(row.營業額);
      case '比例': {
        const r = typeof row.比率 === 'number'
          ? row.比率
          : coerceNumber(row.營業額) / Math.max(coerceNumber(row.開分量), 1e-9);
        return r;
      }
    }
  };

  const toggleSort = (key: SortKey) => {
    setSorter(prev =>
      prev && prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' }
    );
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sorter?.key !== k ? <span className="opacity-40 ml-1">↕</span>
    : sorter.dir === 'asc' ? <span className="ml-1">▲</span> : <span className="ml-1">▼</span>;

  // 篩選
  const [agent, setAgent] = useState("ALL");
  const [merchant, setMerchant] = useState("ALL");
  const [excludeAgent, setExcludeAgent] = useState("");
  const [topN, setTopN] = useState(10);

  // 允許多個關鍵字（逗號 或 空白分隔），採「包含」比對：例 "金傑克, 國正 阿峰"
  const excludeTokens = useMemo(
    () =>
      excludeAgent
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean),
    [excludeAgent]
  );

  // 共用排除規則：有任一 token 被包含就剔除
  const passExclude = React.useCallback(
    (r: Row) =>
      excludeTokens.length === 0 ||
      !excludeTokens.some(tok => String(r.代理商 ?? "").includes(tok)),
    [excludeTokens]
  );

  // 搜尋
  const [q, setQ] = useState("");

  // 多月累積 & 對比
  const monthSet = useMemo(()=> Array.from(new Set(rows.map(r=>r.月份).filter(Boolean))) as string[], [rows]);
  const [appendMode, setAppendMode] = useState(true);
  const [batchMonth, setBatchMonth] = useState("");
  const [keyJoin, setKeyJoin] = useState<"代理商+商戶" | "商戶">("代理商+商戶");
  const [monthA, setMonthA] = useState<string | undefined>(monthSet[0]);
  const [monthB, setMonthB] = useState<string | undefined>(monthSet[1] ?? monthSet[0]);

  // 上傳 Excel/CSV
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
      if (!batchMonth) {
        const fromName = normalizeMonth(f.name);
        if (fromName) setBatchMonth(v=> v || fromName);
      }
      const rowsOne = await parseOne(f);
      batches.push(rowsOne);
    }

    const merged = batches.flat().map(r => ({
      ...r,
      月份: r.月份 ?? normalizeMonth(batchMonth) ?? "未指定",
    }));

    if (appendMode) setRows(prev => [...prev, ...merged]);
    else setRows(merged);

    const months = Array.from(new Set(merged.map(r=>r.月份))).filter(Boolean) as string[];
    if (months.length) {
      setMonthA(months[0]);
      setMonthB(months[1] ?? months[0]);
    }
  };

  // 選單資料
  const agents = useMemo(()=>Array.from(new Set(rows.map(r=>r.代理商))),[rows]);
  const merchants = useMemo(()=>{
    const base = agent==="ALL" ? rows : rows.filter(r=>r.代理商===agent);
    return Array.from(new Set(base.map(r=>r.商戶)));
  },[rows, agent]);

  // 篩選 + 搜尋（明細表/圖表用）
  const filtered = useMemo(()=>{
    let d = rows;

    // 月份鎖定（若不是全選才過濾）
    if (selectedMonths.length && selectedMonths.length !== allMonths.length) {
      const set = new Set(selectedMonths);
      d = d.filter((r: any) => set.has(normMonth(r.月份)));
    }
    if (agent!=="ALL") d = d.filter(r=>r.代理商===agent);
    if (merchant!=="ALL") d = d.filter(r=>r.商戶===merchant);

    // 排除代理商（共用規則）
    if (excludeTokens.length) d = d.filter(passExclude);

    // 搜尋
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      d = d.filter(r => r.代理商.toLowerCase().includes(s) || r.商戶.toLowerCase().includes(s));
    }
    return d;
  }, [rows, agent, merchant, excludeTokens, q, selectedMonths, allMonths, passExclude]);

  const sortedRows = useMemo(() => {
    const rowsX = [...filtered];
    if (!sorter) return rowsX;
    const { key, dir } = sorter;
    return rowsX.sort((a, b) => {
      const av = getSortValue(a, key);
      const bv = getSortValue(b, key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      if (av < bv) return dir === 'asc' ? -1 : 1;
      return 0;
    });
  }, [filtered, sorter]);

  // KPI
  const kpi = useMemo(()=>({
    open: filtered.reduce((s,r)=>s+r.開分量,0),
    rev:  filtered.reduce((s,r)=>s+r.營業額,0),
    ratio: filtered.length ? filtered.reduce((s,r)=>s+r.比率,0)/filtered.length : 0
  }),[filtered]);

  // 圖表資料
  const hist    = useRatioHistogram(filtered, 0.05);
  const share   = useRevenueShareByAgent(filtered);
  const topOpen = useTopOpenByMerchant(filtered, topN);
  const pieColors = usePalette(share.length);

  // 對比用的基礎資料（已套用「排除代理商」）
  const baseRowsForCompare = useMemo(
    () => rows.filter(passExclude),
    [rows, passExclude]
  );

  // 對比表
  const compareRows = useMemo(()=>{
    if (!monthA || !monthB) return [] as any[];
    const A = baseRowsForCompare.filter(r=>r.月份===monthA);
    const B = baseRowsForCompare.filter(r=>r.月份===monthB);
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
  }, [baseRowsForCompare, monthA, monthB, keyJoin]);

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

  // 1) 先算總額，拿來算佔比
  const total = useMemo(
    () => share.reduce((s, d) => s + Number(d.value || 0), 0),
    [share]
  );

  // 2) 自訂 Tooltip（Pie）
  function CustomPieTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const p = payload[0];
    const name = p?.name ?? p?.payload?.name ?? "";
    const value = Number(p?.value ?? p?.payload?.value ?? 0);
    const percent = (p?.percent ?? (total ? value / total : 0)) * 100;

    return (
      <div
        style={{
          pointerEvents: "none",
          background: "rgba(0,0,0,0.75)",
          color: "#fff",
          padding: "6px 10px",
          borderRadius: 8,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: p?.fill || p?.color || "#999",
            flex: "0 0 auto",
          }}
        />
        <div>
          <div style={{ fontWeight: 600 }}>{name}</div>
          <div style={{ opacity: 0.9 }}>
            {money(value)}（{percent.toFixed(2)}%）
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 space-y-6 bg-slate-50">
      <h1 className="text-3xl font-bold">📊 開分量 / 營業額（多月累積與對比版）</h1>

      {/* 上傳區（支援多檔、追加、指定月份） */}
      {isAdmin && (
        <div className="p-4 bg-white rounded-2xl border shadow-sm space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              multiple
              onChange={(e) => onFiles(e.currentTarget.files)}
              className="border rounded px-3 h-10 bg-white"
            />
            <input
              placeholder="本批月份（例如：2025-07 或 2025年7月）若檔內無月份欄位則套用此值"
              value={batchMonth}
              onChange={e=>setBatchMonth(e.target.value)}
              className="border rounded px-3 h-10 w-[360px] bg-white"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={appendMode}
                onChange={e=>setAppendMode(e.target.checked)}
              />
              追加到現有資料（取消打勾＝覆蓋）
            </label>
            <button
              className="ml-auto border rounded h-10 px-3 bg-white"
              onClick={()=>{ setRows([]); setMonthA(undefined); setMonthB(undefined); }}
            >
              清空資料
            </button>
          </div>
          <p className="text-sm text-gray-500">
            提示：你也可以把 7 月與 8 月放在同一個 Excel，只要有「月份」欄位（或「日期/Month」），系統會自動辨識。
          </p>
        </div>
      )}

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
        <input
          placeholder="排除某代理商（可多個：金傑克, 國正 阿峰）"
          value={excludeAgent}
          onChange={e=>setExcludeAgent(e.target.value)}
          className="border rounded px-3 h-10 w-64 bg-white"
        />
        <input placeholder="搜尋代理商/商戶" value={q} onChange={e=>setQ(e.target.value)} className="border rounded px-3 h-10 w-56 bg-white" />
        <select className="border rounded h-10 px-3 bg-white" value={topN} onChange={e=>setTopN(Number(e.target.value))}>
          {[5,10,15,20].map(n => <option key={n} value={n}>Top {n}</option>)}
        </select>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-2xl border shadow-sm">
          <p className="text-gray-500">總開分量</p>
          <p className="text-2xl md:text-3xl font-bold">{money(kpi.open)}</p>
        </div>
        <div className="p-4 bg白 rounded-2xl border shadow-sm">
          <p className="text-gray-500">總營業額</p>
          <p className="text-2xl md:text-3xl font-bold">{money(kpi.rev)}</p>
        </div>
        <div className="p-4 bg-white rounded-2xl border shadow-sm">
          <p className="text-gray-500">平均 營業額/開分量</p>
          <p className="text-2xl md:text-3xl font-bold">{(kpi.ratio*100).toFixed(2)}%</p>
        </div>
      </div>

      {/* 圖表群 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-white rounded-2xl border shadow-sm h-[500px]">
          <h2 className="font-semibold mb-2">開分量帕累托（含累積比例）</h2>
          <ResponsiveContainer width="100%" height="80%">
            <ComposedChart data={useParetoByMerchant(filtered)} margin={{ top: 20, right: 20, bottom:5, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="商戶" tick={{ fontSize: 12 }} />
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

        <div className="p-4 bg-white rounded-2xl border shadow-sm h-[600px]">
          <h2 className="font-semibold mb-2">代理商營業額占比</h2>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 120 }}>
              <Legend
                layout="vertical"
                verticalAlign="middle"
                align="left"
                wrapperStyle={{ left: 0 }}
                formatter={(name: string, entry: any) => {
                  const v = Number(entry?.payload?.value ?? 0);
                  const pct = total ? (v / total) * 100 : 0;
                  return (
                    <span style={{ display: "inline-flex", gap: 8 }}>
                      <span>{name}</span>
                      <span style={{ opacity: 0.8 }}>{money(v)}</span>
                      <span style={{ opacity: 0.6 }}>（{pct.toFixed(2)}%）</span>
                    </span>
                  );
                }}
              />
              <Tooltip content={<CustomPieTooltip />} offset={12} cursor={false} />
              <Pie
                data={share}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="40%"
                outerRadius="70%"
                label={false}
                labelLine={false}
                paddingAngle={1}
              >
                {share.map((_, i) => (
                  <Cell key={i} fill={pieColors[i % pieColors.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="p-4 bg-white rounded-2xl border shadow-sm h-[600px]">
          <h2 className="font-semibold mb-2">開分量 Top {topN} 商戶</h2>
          <ResponsiveContainer width="80%" height="80%">
            <BarChart data={topOpen} layout="vertical" margin={{left: 80, right: 20}}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(v)=>money(Number(v))} />
              <YAxis type="category" dataKey="商戶" />
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
              const sum = (m?:string, f:(r:Row)=>number = r=>r.營業額) =>
                baseRowsForCompare.filter(r=>r.月份===m).reduce((s,r)=>s+f(r),0);

              const openA = sum(monthA, r=>r.開分量), openB = sum(monthB, r=>r.開分量);
              const revA  = sum(monthA, r=>r.營業額), revB  = sum(monthB, r=>r.營業額);

              const ratioA = (() => {
                const arr = baseRowsForCompare.filter(r=>r.月份===monthA);
                return arr.length ? arr.reduce((s,r)=>s+r.比率,0)/arr.length : 0;
              })();

              const ratioB = (() => {
                const arr = baseRowsForCompare.filter(r=>r.月份===monthB);
                return arr.length ? arr.reduce((s,r)=>s+r.比率,0)/arr.length : 0;
              })();

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
      <div className="p-4 bg-white rounded-2xl border shadow-sm overflow-auto relative z-20 isolate">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold">明細表</h2>

          {/* 右側月份鎖定控制 */}
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <button type="button" onClick={pickAll}
              className="px-2 py-1 rounded border bg-white hover:bg-gray-50">全部</button>
            <button type="button" onClick={() => quickPick(1)}
              className="px-2 py-1 rounded border bg-white hover:bg-gray-50">最近1個月</button>
            <button type="button" onClick={() => quickPick(3)}
              className="px-2 py-1 rounded border bg-white hover:bg-gray-50">最近3個月</button>
            <button type="button" onClick={clearAll}
              className="px-2 py-1 rounded border bg-white hover:bg-gray-50">清空</button>

            {allMonths.map((m) => {
              const active = selectedMonths.includes(m);
              const btnClass = active
                ? "px-2 py-1 rounded border bg-blue-600 text-white border-blue-600"
                : "px-2 py-1 rounded border bg-white text-gray-700 border-gray-300 hover:bg-gray-50";

              return (
                <button
                  key={m}
                  type="button"
                  title="單擊：只看此月｜Ctrl/⌘+點：多選/取消"
                  className={btnClass}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      setSelectedMonths(prev =>
                        prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m].sort()
                      );
                    } else {
                      setSelectedMonths([m]); // 單選
                    }
                  }}
                >
                  {m}{monthCounts[m] ? ` (${monthCounts[m]})` : ""}
                </button>
              );
            })}
          </div>
        </div>

        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-20 relative bg-white">
            <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
              <th>
                <button type="button"
                  className="flex items-center gap-1 cursor-pointer select-none"
                  onClick={() => toggleSort('月份')}
                >
                  月份 <SortIcon k="月份" />
                </button>
              </th>
              <th>
                <button type="button"
                  className="flex items-center gap-1 cursor-pointer select-none"
                  onClick={() => toggleSort('代理商')}
                >
                  代理商 <SortIcon k="代理商" />
                </button>
              </th>
              <th>
                <button type="button"
                  className="flex items-center gap-1 cursor-pointer select-none"
                  onClick={() => toggleSort('商戶')}
                >
                  商戶 <SortIcon k="商戶" />
                </button>
              </th>
              <th>
                <button type="button"
                  className="flex items-center gap-1 cursor-pointer select-none"
                  onClick={() => toggleSort('開分量')}
                >
                  開分量 <SortIcon k="開分量" />
                </button>
              </th>
              <th>
                <button type="button"
                  className="flex items-center gap-1 cursor-pointer select-none"
                  onClick={() => toggleSort('營業額')}
                >
                  營業額 <SortIcon k="營業額" />
                </button>
              </th>
              <th>
                <button type="button"
                  className="flex items-center gap-1 cursor-pointer select-none"
                  onClick={() => toggleSort('比例')}
                >
                  營業額/開分量 <SortIcon k="比例" />
                </button>
              </th>
            </tr>
          </thead>

          <tbody className="[&>tr:nth-child(odd)]:bg-gray-50">
            {sortedRows.map((r, i) => (
              <tr key={i} className="[&>td]:px-3 [&>td]:py-2">
                <td>{normMonth(r.月份) || '-'}</td>
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
    </div>
  );
}
