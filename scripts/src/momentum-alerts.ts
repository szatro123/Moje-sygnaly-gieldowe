/**
 * Moje sygnały giełdowe
 *
 * Bot momentum:
 * - bez newsów
 * - bez OpenAI
 * - szuka świeżego ruchu price + volume
 * - wysyła tylko sensowne kandydaty
 */

type Quote = {
  price: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
};

type VolumeData = {
  todayVolume: number;
  avgVolume: number;
  relativeVolume: number;
  source: string;
};

type TickerData = {
  ticker: string;
  quote: Quote;
  volume: VolumeData;
};

type MomentumAlert = {
  ticker: string;
  price: number;
  changePercent: number;
  relativeVolume: number;
  dayHigh: number;
  distanceFromHighPct: number;
  setup: string;
  risk: string;
};

// ===== KONFIG =====

// Na start ręczna lista tickerów.
// Potem możemy zrobić wersję auto top movers.
const WATCHLIST = [
  "AAPL", "NVDA", "TSLA", "PLTR", "SMCI", "AMD", "SOFI", "RIOT", "MARA",
  "HOOD", "RIVN", "CVNA", "UPST", "AFRM", "IONQ", "SOUN", "ASTS", "RKLB",
  "HIMS", "TEM", "CRWD", "PATH", "CFLT", "APP", "AI", "QBTS", "SERV",
  "APLS", "CNTA", "AEHR", "ALKS", "CRML"
];

const PRICE_MIN = 2;
const PRICE_MAX = 20;

const MOVE_MIN = 4.0;
const MOVE_MAX = 12.0;

const RELATIVE_VOLUME_MIN = 1.8;

// Jak blisko high dnia ma być cena, żeby ruch uznać za żywy
const MAX_DISTANCE_FROM_HIGH_PCT = 3.0;

// Chcemy, aby cena była nad open
const REQUIRE_ABOVE_OPEN = true;

// Limit alertów na jeden przebieg
const MAX_ALERTS_PER_RUN = 5;

// ===== ENV =====

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ===== YAHOO FINANCE =====

interface YahooChartMeta {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  regularMarketVolume?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketOpen?: number;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta;
      indicators?: {
        quote?: Array<{
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: unknown;
  };
}

async function fetchTickerData(ticker: string): Promise<TickerData | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}` +
    `?interval=1d&range=30d&includePrePost=false`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as YahooChartResponse;
    const result = json.chart?.result?.[0];
    const meta = result?.meta;

    if (!meta?.regularMarketPrice) return null;
    if (!meta.chartPreviousClose) return null;

    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose;
    const todayVol = meta.regularMarketVolume ?? 0;
    const open = meta.regularMarketOpen ?? 0;
    const high = meta.regularMarketDayHigh ?? 0;
    const low = meta.regularMarketDayLow ?? 0;

    const changePct =
      prevClose > 0
        ? Math.round((((price - prevClose) / prevClose) * 100) * 100) / 100
        : 0;

    const volHistory = (result?.indicators?.quote?.[0]?.volume ?? [])
      .filter((v): v is number => v !== null && v !== undefined && v > 0);

    // Bierzemy poprzednie dni bez dzisiejszego
    const baseline = volHistory.slice(0, -1);

    const avgVol =
      baseline.length > 0
        ? Math.round(baseline.reduce((sum, v) => sum + v, 0) / baseline.length)
        : 0;

    const relVol =
      avgVol > 0 ? Math.round((todayVol / avgVol) * 100) / 100 : 0;

    return {
      ticker,
      quote: {
        price,
        changePercent: changePct,
        open,
        high,
        low,
        prevClose,
      },
      volume: {
        todayVolume: todayVol,
        avgVolume: avgVol,
        relativeVolume: relVol,
        source: "Yahoo Finance /v8/finance/chart",
      },
    };
  } catch {
    return null;
  }
}

// ===== FILTR MOMENTUM =====

function buildMomentumAlert(data: TickerData): MomentumAlert | null {
  const { ticker, quote, volume } = data;

  if (quote.price < PRICE_MIN || quote.price > PRICE_MAX) return null;
  if (quote.changePercent < MOVE_MIN || quote.changePercent > MOVE_MAX) return null;
  if (volume.relativeVolume < RELATIVE_VOLUME_MIN) return null;
  if (REQUIRE_ABOVE_OPEN && quote.open > 0 && quote.price <= quote.open) return null;
  if (quote.high <= 0) return null;

  const distanceFromHighPct =
    Math.round((((quote.high - quote.price) / quote.high) * 100) * 100) / 100;

  if (distanceFromHighPct > MAX_DISTANCE_FROM_HIGH_PCT) return null;

  const setup =
    quote.changePercent >= 8
      ? "strong momentum continuation candidate"
      : "fresh momentum setup";

  const risk =
    quote.changePercent >= 10
      ? "higher risk: move already extended"
      : "normal momentum risk";

  return {
    ticker,
    price: quote.price,
    changePercent: quote.changePercent,
    relativeVolume: volume.relativeVolume,
    dayHigh: quote.high,
    distanceFromHighPct,
    setup,
    risk,
  };
}

// ===== TELEGRAM =====

function formatTelegramMessage(alert: MomentumAlert): string {
  return [
    `🔥 <b>Moje sygnały giełdowe — ${alert.ticker}</b>`,
    ``,
    `💵 <b>Cena:</b> $${alert.price}`,
    `📈 <b>Zmiana:</b> +${alert.changePercent}%`,
    `📊 <b>Relative volume:</b> ${alert.relativeVolume}x`,
    `🎯 <b>High dnia:</b> $${alert.dayHigh}`,
    `📍 <b>Odległość od high:</b> ${alert.distanceFromHighPct}%`,
    ``,
    `⚙️ <b>Setup:</b> ${alert.setup}`,
    `⚠️ <b>Ryzyko:</b> ${alert.risk}`,
  ].join("\n");
}

async function sendTelegram(message: string): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${requireEnv("TELEGRAM_TOKEN")}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: requireEnv("CHAT_ID"),
        text: message,
        parse_mode: "HTML",
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram error: ${res.status} - ${body}`);
  }
}

// ===== MAIN =====

type RunStats = {
  checked: number;
  validData: number;
  alerts: number;
};

async function main(): Promise<RunStats> {
  ["TELEGRAM_TOKEN", "CHAT_ID"].forEach(requireEnv);

  console.log("====================================");
  console.log(" Moje sygnały giełdowe");
  console.log("====================================\n");

  const alerts: MomentumAlert[] = [];
  let validData = 0;

  for (const ticker of WATCHLIST) {
    const data = await fetchTickerData(ticker);

    if (!data) {
      console.log(`❌ ${ticker}: no data`);
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }

    validData++;

    console.log(
      `CHECK ${ticker} | $${data.quote.price} | ${data.quote.changePercent >= 0 ? "+" : ""}${data.quote.changePercent}% | relVol ${data.volume.relativeVolume}x`
    );

    const alert = buildMomentumAlert(data);

    if (alert) {
      alerts.push(alert);
      console.log(`✅ PASS ${ticker}`);
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  alerts.sort((a, b) => {
    if (b.relativeVolume !== a.relativeVolume) {
      return b.relativeVolume - a.relativeVolume;
    }
    return b.changePercent - a.changePercent;
  });

  const finalAlerts = alerts.slice(0, MAX_ALERTS_PER_RUN);

  for (const alert of finalAlerts) {
    const message = formatTelegramMessage(alert);
    await sendTelegram(message);
    console.log(`📨 sent: ${alert.ticker}`);
  }

  return {
    checked: WATCHLIST.length,
    validData,
    alerts: finalAlerts.length,
  };
}

main()
  .then(async (stats) => {
    const debugMsg = [
      `MOJE SYGNAŁY GIEŁDOWE`,
      `checked: ${stats.checked}`,
      `valid_data: ${stats.validData}`,
      `alerts: ${stats.alerts}`,
    ].join("\n");

    await sendTelegram(debugMsg);
  })
  .catch((err) => {
    console.error("Fatal error:", err?.message ?? err);
    process.exit(1);
  });
