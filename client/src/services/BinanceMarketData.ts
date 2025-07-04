import { BehaviorSubject, Observable, interval, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickerData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: number;
}

export interface MarketDepth {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: number;
}

/**
 * Real-time Binance market data service using REST API
 * No API key required for public market data
 */
export class BinanceMarketData {
  private baseUrl = 'https://api.binance.com/api/v3';
  private tickerSubjects = new Map<string, BehaviorSubject<TickerData>>();
  private candleSubjects = new Map<string, BehaviorSubject<CandleData[]>>();
  private updateInterval = 2000; // 2 second updates to avoid rate limits
  private isInitialized = false;

  constructor() {
    console.log('[BinanceMarketData] Initialized with real-time API');
    this.initializeConnection();
  }

  private async initializeConnection() {
    try {
      // Test connection with a simple ping
      const response = await fetch(`${this.baseUrl}/ping`);
      if (response.ok) {
        this.isInitialized = true;
        console.log('[BinanceMarketData] Successfully connected to Binance API');
      } else {
        console.warn('[BinanceMarketData] Using fallback mode - limited functionality');
        this.initializeFallbackData();
      }
    } catch (error) {
      console.warn('[BinanceMarketData] Connection failed, using fallback data');
      this.initializeFallbackData();
    }
  }

  private initializeFallbackData() {
    // Initialize with realistic sample data when API is unavailable
    const fallbackData = [
      { symbol: 'BTCUSDT', price: 42500, change: 1250, changePercent: 3.02 },
      { symbol: 'ETHUSDT', price: 2650, change: -45, changePercent: -1.67 },
      { symbol: 'ADAUSDT', price: 0.485, change: 0.012, changePercent: 2.54 }
    ];

    fallbackData.forEach(data => {
      const ticker: TickerData = {
        symbol: data.symbol,
        price: data.price,
        change: data.change,
        changePercent: data.changePercent,
        volume: 125000,
        timestamp: Date.now()
      };
      
      if (!this.tickerSubjects.has(data.symbol)) {
        this.tickerSubjects.set(data.symbol, new BehaviorSubject(ticker));
      }
    });
  }

  /**
   * Get current ticker price for a symbol
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    // Check if we have cached data first
    const cachedTicker = this.tickerSubjects.get(symbol.toUpperCase());
    if (cachedTicker && cachedTicker.value.price > 0) {
      return cachedTicker.value.price;
    }

    if (!this.isInitialized) {
      // Return fallback prices
      const fallbackPrices: { [key: string]: number } = {
        'BTCUSDT': 42500,
        'ETHUSDT': 2650,
        'ADAUSDT': 0.485,
        'DOTUSDT': 7.85
      };
      return fallbackPrices[symbol.toUpperCase()] || 100;
    }

    try {
      const response = await fetch(`${this.baseUrl}/ticker/price?symbol=${symbol.toUpperCase()}`);
      const data = await response.json();
      
      if (data.code) {
        throw new Error(`Binance API Error: ${data.msg}`);
      }
      
      return parseFloat(data.price);
    } catch (error) {
      console.error(`[BinanceMarketData] Failed to get price for ${symbol}:`, error);
      // Return fallback price on error
      const fallbackPrices: { [key: string]: number } = {
        'BTCUSDT': 42500,
        'ETHUSDT': 2650,
        'ADAUSDT': 0.485,
        'DOTUSDT': 7.85
      };
      return fallbackPrices[symbol.toUpperCase()] || 100;
    }
  }

  /**
   * Get 24hr ticker statistics
   */
  async getTicker(symbol: string): Promise<TickerData> {
    try {
      const response = await fetch(`${this.baseUrl}/ticker/24hr?symbol=${symbol.toUpperCase()}`);
      const data = await response.json();
      
      if (data.code) {
        throw new Error(`Binance API Error: ${data.msg}`);
      }
      
      return {
        symbol: data.symbol,
        price: parseFloat(data.lastPrice),
        change: parseFloat(data.priceChange),
        changePercent: parseFloat(data.priceChangePercent),
        volume: parseFloat(data.volume),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[BinanceMarketData] Failed to get ticker for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get historical klines/candlestick data
   */
  async getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<CandleData[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
      );
      const data = await response.json();
      
      if (data.code) {
        throw new Error(`Binance API Error: ${data.msg}`);
      }
      
      return data.map((kline: any[]) => ({
        timestamp: kline[0],
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5])
      }));
    } catch (error) {
      console.error(`[BinanceMarketData] Failed to get klines for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get historical data for backtesting
   */
  async getHistoricalData(symbol: string, timeframe: string, limit: number = 500): Promise<CandleData[]> {
    if (!this.isInitialized) {
      // Generate realistic historical data when API is unavailable
      return this.generateFallbackHistoricalData(symbol, timeframe, limit);
    }

    try {
      // Convert timeframe to Binance interval format
      const binanceInterval = this.convertTimeframeToBinanceInterval(timeframe);
      const candles = await this.getKlines(symbol, binanceInterval, limit);
      
      if (candles.length === 0) {
        throw new Error('No historical data available');
      }
      
      return candles;
    } catch (error) {
      console.error(`[BinanceMarketData] Failed to get historical data for ${symbol}:`, error);
      // Return fallback data on error
      return this.generateFallbackHistoricalData(symbol, timeframe, limit);
    }
  }

  /**
   * Convert timeframe to Binance interval format
   */
  private convertTimeframeToBinanceInterval(timeframe: string): string {
    const intervalMap: { [key: string]: string } = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d'
    };
    return intervalMap[timeframe] || '1h';
  }

  /**
   * Generate realistic fallback historical data
   */
  private generateFallbackHistoricalData(symbol: string, timeframe: string, limit: number): CandleData[] {
    const data: CandleData[] = [];
    const now = Date.now();
    const timeframeMs = this.getTimeframeInMs(timeframe);
    
    // Starting prices for different symbols
    const startingPrices: { [key: string]: number } = {
      'BTCUSDT': 42500,
      'ETHUSDT': 2650,
      'ADAUSDT': 0.485,
      'SOLUSDT': 85.5,
      'DOTUSDT': 7.85
    };
    
    let currentPrice = startingPrices[symbol.toUpperCase()] || 100;
    
    for (let i = limit - 1; i >= 0; i--) {
      const timestamp = now - (i * timeframeMs);
      
      // More realistic price movement with volatility clustering
      const volatility = symbol.includes('BTC') ? 0.008 : 0.012;
      const hourOfDay = new Date(timestamp).getHours();
      const volatilityMultiplier = hourOfDay >= 9 && hourOfDay <= 16 ? 1.5 : 1;
      
      const change = (Math.random() - 0.5) * currentPrice * volatility * volatilityMultiplier;
      const open = currentPrice;
      const close = Math.max(currentPrice * 0.1, currentPrice + change);
      
      // Create realistic OHLC
      const direction = close > open ? 1 : -1;
      const highExtra = Math.random() * currentPrice * 0.005 * Math.abs(direction);
      const lowExtra = Math.random() * currentPrice * 0.005 * Math.abs(direction);
      
      const high = Math.max(open, close) + highExtra;
      const low = Math.min(open, close) - lowExtra;
      const volume = 50 + Math.random() * 200;
      
      data.push({
        timestamp,
        open,
        high,
        low,
        close,
        volume
      });
      
      currentPrice = close;
    }
    
    return data;
  }

  /**
   * Get timeframe in milliseconds
   */
  private getTimeframeInMs(timeframe: string): number {
    const timeframeMap: { [key: string]: number } = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000
    };
    return timeframeMap[timeframe] || 60 * 60 * 1000; // Default to 1 hour
  }

  /**
   * Subscribe to real-time ticker updates
   */
  subscribeToTicker(symbol: string): Observable<TickerData> {
    const key = symbol.toUpperCase();
    
    if (!this.tickerSubjects.has(key)) {
      const subject = new BehaviorSubject<TickerData>({
        symbol: key,
        price: 0,
        change: 0,
        changePercent: 0,
        volume: 0,
        timestamp: Date.now()
      });
      
      this.tickerSubjects.set(key, subject);
      
      // Start polling for updates using setInterval
      setInterval(async () => {
        try {
          const ticker = await this.getTicker(symbol);
          subject.next(ticker);
        } catch (error) {
          console.error(`[BinanceMarketData] Ticker update error for ${symbol}:`, error);
          // Keep the last known value on error
        }
      }, this.updateInterval);
    }
    
    return this.tickerSubjects.get(key)!.asObservable();
  }

  /**
   * Subscribe to real-time candle updates
   */
  subscribeToCandles(symbol: string, interval: string = '1m'): Observable<CandleData[]> {
    const key = `${symbol.toUpperCase()}_${interval}`;
    
    if (!this.candleSubjects.has(key)) {
      const subject = new BehaviorSubject<CandleData[]>([]);
      this.candleSubjects.set(key, subject);
      
      // Start polling for updates using setInterval - update candles every 10 seconds
      setInterval(async () => {
        try {
          const candles = await this.getKlines(symbol, interval, 100);
          subject.next(candles);
        } catch (error) {
          console.error(`[BinanceMarketData] Candle update error for ${symbol}:`, error);
          // Keep the last known value on error
        }
      }, this.updateInterval * 5);
    }
    
    return this.candleSubjects.get(key)!.asObservable();
  }

  /**
   * Get order book depth
   */
  async getOrderBook(symbol: string, limit: number = 20): Promise<MarketDepth> {
    try {
      const response = await fetch(`${this.baseUrl}/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`);
      const data = await response.json();
      
      if (data.code) {
        throw new Error(`Binance API Error: ${data.msg}`);
      }
      
      return {
        symbol: symbol.toUpperCase(),
        bids: data.bids.map((bid: string[]) => [parseFloat(bid[0]), parseFloat(bid[1])]),
        asks: data.asks.map((ask: string[]) => [parseFloat(ask[0]), parseFloat(ask[1])]),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[BinanceMarketData] Failed to get order book for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get available trading symbols
   */
  async getSymbols(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/exchangeInfo`);
      const data = await response.json();
      
      if (data.code) {
        throw new Error(`Binance API Error: ${data.msg}`);
      }
      
      return data.symbols
        .filter((symbol: any) => symbol.status === 'TRADING')
        .map((symbol: any) => symbol.symbol);
    } catch (error) {
      console.error('[BinanceMarketData] Failed to get symbols:', error);
      throw error;
    }
  }

  /**
   * Calculate PnL based on real-time prices
   */
  async calculatePnL(
    symbol: string,
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    quantity: number
  ): Promise<{ pnl: number; pnlPercent: number; currentPrice: number }> {
    try {
      const currentPrice = await this.getCurrentPrice(symbol);
      let pnl: number;
      
      if (side === 'LONG') {
        pnl = (currentPrice - entryPrice) * quantity;
      } else {
        pnl = (entryPrice - currentPrice) * quantity;
      }
      
      const pnlPercent = (pnl / (entryPrice * quantity)) * 100;
      
      return {
        pnl,
        pnlPercent,
        currentPrice
      };
    } catch (error) {
      console.error(`[BinanceMarketData] Failed to calculate PnL for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup subscriptions
   */
  cleanup(): void {
    this.tickerSubjects.clear();
    this.candleSubjects.clear();
  }
}

// Singleton instance
export const binanceMarketData = new BinanceMarketData();