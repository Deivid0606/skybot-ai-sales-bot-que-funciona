// lib/cache.server.ts
type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

class Cache {
  private store = new Map<string, CacheEntry<any>>();
  private defaultTTL = 300000; // 5 minutos

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttl = this.defaultTTL): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  clear(): void {
    this.store.clear();
  }

  clean(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

// ✅ EXPORTACIÓN CORRECTA
export const contextCache = new Cache();
export default Cache;
