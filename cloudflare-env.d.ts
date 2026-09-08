interface Fetcher { fetch(input: Request | string, init?: RequestInit): Promise<Response>; }
interface D1PreparedStatement { bind(...values: unknown[]): D1PreparedStatement; first<T = unknown>(): Promise<T | null>; run(): Promise<unknown>; all<T = unknown>(): Promise<{ results: T[] }>; raw<T = unknown>(): Promise<T[]>; }
interface D1Database { prepare(query: string): D1PreparedStatement; batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>; exec(query: string): Promise<unknown>; dump(): Promise<ArrayBuffer>; }
declare module "cloudflare:workers" { export const env: { DB?: D1Database }; }
