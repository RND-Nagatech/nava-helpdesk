import { formatHindsightRecall } from "../src/services/hindsight-memory.js";

const question = "Error timbangan muncul lagi, kemarin saya sudah coba apa?";
const recalled = formatHindsightRecall({
  results: [
    {
      id: "demo-fact-001",
      type: "experience",
      occurred_start: "2026-09-20T09:00:00Z",
      text: "Customer mengalami berat timbangan tidak muncul. Customer sudah mencoba menjalankan ulang aplikasi Timbangan, tetapi masalah masih terjadi.",
    },
    {
      id: "demo-fact-002",
      type: "observation",
      occurred_start: "2026-09-20T09:00:00Z",
      text: "Kasus timbangan customer sebelumnya belum terselesaikan dan perlu pemeriksaan lanjutan jika muncul kembali.",
    },
  ],
});

console.log("PERTANYAAN CUSTOMER");
console.log(question);
console.log("\nSEBELUM HINDSIGHT");
console.log("NAVA hanya memiliki pertanyaan saat ini dan knowledge resmi. NAVA belum mengetahui bahwa customer sudah mencoba menjalankan ulang aplikasi sebelumnya.");
console.log("Contoh konteks jawaban: Minta customer menjelaskan langkah yang sudah dicoba atau ulangi troubleshooting dari awal.");
console.log("\nSESUDAH HINDSIGHT - KONTEKS YANG DITEMUKAN");
console.log(recalled.text);
console.log("\nDampak yang diharapkan: NAVA dapat mengakui langkah sebelumnya, tidak mengulang langkah yang sama secara buta, dan langsung melanjutkan ke pemeriksaan berikutnya atau eskalasi.");
