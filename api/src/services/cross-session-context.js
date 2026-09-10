export function formatCrossSessionContext(items = []) {
  if (!items.length) return "";

  const lines = [
    "KONTEKS CUSTOMER DARI SESSION SEBELUMNYA:",
    "Gunakan hanya bila relevan dengan pesan customer sekarang. Ini konteks percakapan lama, bukan sumber fakta realtime dan bukan pengganti knowledge resmi.",
  ];

  for (const item of items) {
    if (item.role === "user") {
      lines.push(`- Customer sebelumnya: ${item.content}`);
    } else if (item.role === "assistant_grounded") {
      const article = item.primary_article_title ? ` [knowledge: ${item.primary_article_title}]` : "";
      lines.push(`- Jawaban NAVA sebelumnya yang grounded${article}: ${item.content}`);
    }
  }

  return lines.join("\n");
}
