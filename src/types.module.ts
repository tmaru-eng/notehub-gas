/**
 * テスト用: モジュールとして import 可能な型定義。
 * 本番コードは src/types.d.ts（グローバル）を使用。
 */
export interface ScriptProperties {
  getProperty(key: string): string | null;
}
