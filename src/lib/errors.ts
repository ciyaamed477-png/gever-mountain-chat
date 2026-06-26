// Map known Supabase/Postgres errors to safe, user-friendly messages.
// Avoids leaking constraint names, table names, or internal schema details.
export function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null | undefined;
  const code = e?.code;
  if (code === "23505") return "Bu kayıt zaten mevcut.";
  if (code === "23503") return "İlgili kayıt bulunamadı.";
  if (code === "23502") return "Eksik bilgi, lütfen alanları kontrol et.";
  if (code === "23514") return "Geçersiz veri.";
  if (code === "42501" || code === "PGRST301") return "Bu işlem için yetkin yok.";
  if (code === "PGRST116") return "Kayıt bulunamadı.";
  if (code === "invalid_credentials" || code === "invalid_grant")
    return "Numara veya şifre hatalı.";
  if (code === "user_already_exists" || code === "email_exists")
    return "Bu kullanıcı zaten kayıtlı.";
  if (code === "weak_password") return "Şifre çok zayıf.";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit")
    return "Çok fazla deneme, lütfen biraz sonra tekrar dene.";
  if (typeof console !== "undefined") {
    // Keep raw detail in console for debugging only
    console.error("[app error]", err);
  }
  return "Bir hata oluştu, lütfen tekrar dene.";
}
