// Must stay byte-for-byte identical to the Postgres generated-column
// expression used everywhere a fardo code is matched:
// upper(regexp_replace(code, '[[:space:]-]', '', 'g'))
// — see container_items.code_normalized / product_codes.code_normalized in
// supabase/migrations/0010_container_receiving_schema.sql. If either side
// changes, update both.
export function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase()
}
