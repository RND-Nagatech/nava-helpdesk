import "dotenv/config";
import { env } from "../src/config/env.js";
import { closeMongo, connectMongo } from "../src/database/mongodb.js";
import { __investigationPlaybookInternals } from "../src/services/investigation-playbook-service.js";

const playbookName = "Selisih Laporan Barang Summary dan Detail";

const pipeline = [
  {
    $group: {
      _id: {
        kode_barcode: "$kode_barcode",
        kode_toko: "$kode_toko",
        kode_gudang: "$kode_gudang",
      },
      detail_stock: { $sum: { $ifNull: ["$stock_on_hand", 0] } },
      detail_berat: { $sum: { $ifNull: ["$berat", 0] } },
    },
  },
  {
    $lookup: {
      from: "tt_barang_saldo",
      let: {
        barcode: "$_id.kode_barcode",
        kode_toko: "$_id.kode_toko",
        kode_gudang: "$_id.kode_gudang",
        tanggal: "{{tanggal}}",
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$tanggal", "$$tanggal"] },
                { $eq: ["$kode_barcode", "$$barcode"] },
                { $eq: ["$kode_toko", "$$kode_toko"] },
                { $eq: ["$kode_gudang", "$$kode_gudang"] },
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            summary_stock: { $sum: { $ifNull: ["$stock_akhir", 0] } },
            summary_berat: { $sum: { $ifNull: ["$berat_akhir", 0] } },
            summary_count: { $sum: 1 },
          },
        },
      ],
      as: "summary",
    },
  },
  { $unwind: { path: "$summary", preserveNullAndEmptyArrays: true } },
  {
    $set: {
      summary_count: { $ifNull: ["$summary.summary_count", 0] },
      summary_stock: { $ifNull: ["$summary.summary_stock", 0] },
      summary_berat: { $ifNull: ["$summary.summary_berat", 0] },
    },
  },
  {
    $set: {
      stock_difference: { $subtract: ["$detail_stock", "$summary_stock"] },
      berat_difference: { $subtract: ["$detail_berat", "$summary_berat"] },
    },
  },
  {
    $match: {
      $expr: {
        $or: [
          { $eq: ["$summary_count", 0] },
          { $ne: ["$detail_stock", "$summary_stock"] },
          { $gt: [{ $abs: "$berat_difference" }, 0.01] },
        ],
      },
    },
  },
  {
    $project: {
      _id: 0,
      kode_barcode: "$_id.kode_barcode",
      kode_toko: "$_id.kode_toko",
      kode_gudang: "$_id.kode_gudang",
      detail_stock: 1,
      detail_berat: 1,
      summary_stock: 1,
      summary_berat: 1,
      summary_count: 1,
      stock_difference: 1,
      berat_difference: 1,
    },
  },
  { $sort: { kode_gudang: 1, kode_toko: 1, kode_barcode: 1 } },
  { $limit: 50 },
];

async function main() {
  const db = await connectMongo();
  const collection = db.collection(env.investigationPlaybookCollection);
  const existing = await collection.findOne({ name: playbookName });
  if (!existing) throw new Error(`Playbook '${playbookName}' tidak ditemukan.`);

  const aggregationSource = `db.tm_barang.aggregate(${JSON.stringify(pipeline, null, 2)})`;
  const normalized = __investigationPlaybookInternals.normalizeInvestigationPlaybookInput({
    ...existing,
    parameters: [{
      key: "tanggal",
      label: "Tanggal",
      type: "date",
      required: true,
      description: "Tanggal system yang ingin diperiksa.",
    }],
    aggregation_source: aggregationSource,
    execution: { strategy: "stock_summary_vs_detail" },
  }, { status: "published" });

  const result = await collection.updateOne(
    { _id: existing._id },
    {
      $set: {
        ...normalized,
        status: "published",
        updated_at: new Date(),
      },
    },
  );
  console.log(`Playbook diperbarui: matched=${result.matchedCount}, modified=${result.modifiedCount}`);
  console.log(`Parameter wajib: ${normalized.parameters.filter((item) => item.required).map((item) => item.key).join(", ") || "tidak ada"}`);
  console.log(`Collection sumber: ${normalized.execution.source_collection}`);
}

main()
  .catch((error) => {
    console.error("Gagal memperbarui Playbook:", error);
    process.exitCode = 1;
  })
  .finally(closeMongo);
