import { z } from "zod";
import {
  closeInvestigationSession,
  createInvestigationSession,
  getInvestigationSession,
  listInvestigationSessions,
  sendInvestigationMessage,
} from "../services/investigation-chat-service.js";
import {
  inspectBuybackVsCash,
  inspectBuybackVsStock,
  inspectDailyRolloverDifference,
  inspectDebtVsCash,
  inspectHancurVsSaldo,
  inspectInternalTransferVsSaldo,
  inspectOpnameVsSaldo,
  inspectReportVisibility,
  inspectSalesVsCash,
  inspectServiceVsCash,
  inspectStockDifference,
  listInvestigationRuns,
  listInvestigationTargets,
  upsertInvestigationTarget,
} from "../services/investigation-service.js";
import { getInvestigationDefinition } from "../services/investigation-definition-service.js";

const trainingIdSchema = z.string().trim().min(8).max(200);
const messageSchema = z.object({
  question: z.string().trim().min(2).max(4000),
  domain: z.string().trim().max(200).optional(),
});
const targetSchema = z.object({
  domain: z.string().trim().min(1).max(200),
  connection_profile: z.string().trim().min(1).max(64).optional(),
  database_name: z.string().trim().max(200).optional(),
  display_name: z.string().trim().max(200).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  allowed_collection_profile: z.string().trim().max(80).optional(),
});
const databaseCheckSchema = z.discriminatedUnion("operation_id", [
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("stock.detail_vs_summary"),
    params: z.object({
      kode_barcode: z.string().trim().min(1).max(120),
      tanggal: z.string().trim().min(10).max(10),
      kode_toko: z.string().trim().max(80).optional(),
      kode_baki: z.string().trim().max(80).optional(),
      kode_gudang: z.string().trim().max(80).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("stock.opening_vs_previous_closing"),
    params: z.object({
      tanggal_sebelumnya: z.string().trim().min(10).max(10),
      tanggal_sesudahnya: z.string().trim().min(10).max(10),
      kode_toko: z.string().trim().max(80).optional(),
      kode_baki: z.string().trim().max(80).optional(),
      kode_gudang: z.string().trim().max(80).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("service.status_vs_cash"),
    params: z.object({
      tanggal_awal: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      tanggal_akhir: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      no_faktur_service: z.string().trim().max(160).optional(),
      status_proses: z.string().trim().max(20).optional(),
      max_rows: z.number().int().min(1).max(200).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("stock.internal_transfer_vs_saldo"),
    params: z.object({
      tanggal_awal: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      tanggal_akhir: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      no_pindah: z.string().trim().max(160).optional(),
      kode_dept: z.string().trim().max(120).optional(),
      kode_gudang_asal: z.string().trim().max(80).optional(),
      kode_toko_asal: z.string().trim().max(80).optional(),
      kode_baki_asal: z.string().trim().max(80).optional(),
      kode_gudang_tujuan: z.string().trim().max(80).optional(),
      kode_toko_tujuan: z.string().trim().max(80).optional(),
      kode_baki_tujuan: z.string().trim().max(80).optional(),
      max_rows: z.number().int().min(1).max(200).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("stock.opname_vs_saldo"),
    params: z.object({
      tanggal_awal: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      tanggal_akhir: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      kode_barcode: z.string().trim().max(120).optional(),
      kode_toko: z.string().trim().max(80).optional(),
      kode_baki: z.string().trim().max(80).optional(),
      kode_gudang: z.string().trim().max(80).optional(),
      max_rows: z.number().int().min(1).max(200).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("stock.hancur_vs_saldo"),
    params: z.object({
      tanggal_awal: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      tanggal_akhir: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      no_hancur: z.string().trim().max(160).optional(),
      kode_barcode: z.string().trim().max(120).optional(),
      kode_toko: z.string().trim().max(80).optional(),
      kode_baki: z.string().trim().max(80).optional(),
      kode_gudang: z.string().trim().max(80).optional(),
      max_rows: z.number().int().min(1).max(200).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("finance.debt_vs_cash"),
    params: z.object({
      tanggal_awal: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      tanggal_akhir: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      identifier: z.string().trim().max(160).optional(),
      no_faktur_hutang: z.string().trim().max(160).optional(),
      no_faktur_cicil: z.string().trim().max(160).optional(),
      jenis_transaksi: z.enum(["hutang", "cicilan", "all"]).optional(),
      max_rows: z.number().int().min(1).max(200).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("finance.sales_vs_cash"),
    params: z.object({
      tanggal_awal: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      tanggal_akhir: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      no_faktur_group: z.string().trim().max(160).optional(),
      jenis_pembayaran: z.string().trim().max(80).optional(),
      max_rows: z.number().int().min(1).max(200).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("finance.buyback_vs_cash"),
    params: z.object({
      tanggal_awal: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      tanggal_akhir: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      no_faktur_group: z.string().trim().max(160).optional(),
      no_faktur_beli: z.string().trim().max(160).optional(),
      kode_barcode: z.string().trim().max(120).optional(),
      kode_gudang: z.string().trim().max(80).optional(),
      max_rows: z.number().int().min(1).max(200).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("stock.buyback_vs_saldo"),
    params: z.object({
      tanggal_awal: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      tanggal_akhir: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      kode_barcode: z.string().trim().max(120).optional(),
      kode_gudang: z.string().trim().max(80).optional(),
      max_rows: z.number().int().min(1).max(200).optional(),
    }),
  }),
  z.object({
    domain: z.string().trim().min(1).max(200),
    operation_id: z.literal("report.visibility_diagnostic"),
    params: z.object({
      report_context: z.enum(["buyback", "sales", "cash", "service", "debt", "stock"]),
      tanggal_awal: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      tanggal_akhir: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      identifier: z.string().trim().max(160).optional(),
      kode_gudang: z.string().trim().max(80).optional(),
      max_rows: z.number().int().min(1).max(100).optional(),
    }),
  }),
]);

function trainingIdParam(req) {
  return trainingIdSchema.parse(req.params.trainingId);
}

export async function createInvestigationSessionHandler(req, res, next) {
  try {
    const session = await createInvestigationSession(req.helpdeskUser);
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}

export async function listInvestigationSessionsHandler(req, res, next) {
  try {
    res.json({ success: true, data: await listInvestigationSessions(req.helpdeskUser) });
  } catch (error) {
    next(error);
  }
}

export async function getInvestigationSessionHandler(req, res, next) {
  try {
    res.json({
      success: true,
      data: await getInvestigationSession(trainingIdParam(req), req.helpdeskUser),
    });
  } catch (error) {
    next(error);
  }
}

export async function sendInvestigationMessageHandler(req, res, next) {
  try {
    const input = messageSchema.parse(req.body);
    const data = await sendInvestigationMessage({
      trainingId: trainingIdParam(req),
      helpdeskUser: req.helpdeskUser,
      question: input.question,
      domain: input.domain || "",
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function closeInvestigationSessionHandler(req, res, next) {
  try {
    res.json({
      success: true,
      data: await closeInvestigationSession({
        trainingId: trainingIdParam(req),
        helpdeskUser: req.helpdeskUser,
      }),
    });
  } catch (error) {
    next(error);
  }
}

export async function investigationDatabaseCheckHandler(req, res, next) {
  try {
    const trainingId = trainingIdParam(req);
    const input = databaseCheckSchema.parse(req.body);
    // Direct database-check calls must stay within a room owned by the caller.
    await getInvestigationSession(trainingId, req.helpdeskUser);
    const inputData = {
      domain: input.domain,
      params: input.params,
      trainingId,
      helpdeskUser: req.helpdeskUser,
    };
    if (["finance.sales_vs_cash", "finance.buyback_vs_cash", "finance.debt_vs_cash", "stock.buyback_vs_saldo", "stock.opname_vs_saldo", "stock.hancur_vs_saldo", "report.visibility_diagnostic", "service.status_vs_cash", "stock.internal_transfer_vs_saldo"].includes(input.operation_id)) {
      const definition = await getInvestigationDefinition(input.operation_id);
      if (!definition || definition.status !== "published") {
        const error = new Error(`Operation ${input.operation_id} belum published atau sedang diarsipkan.`);
        error.code = "INVESTIGATION_DEFINITION_NOT_PUBLISHED";
        error.statusCode = 409;
        throw error;
      }
    }
    const data = input.operation_id === "stock.opening_vs_previous_closing"
      ? await inspectDailyRolloverDifference(inputData)
      : input.operation_id === "stock.opname_vs_saldo"
        ? await inspectOpnameVsSaldo(inputData)
        : input.operation_id === "stock.hancur_vs_saldo"
          ? await inspectHancurVsSaldo(inputData)
          : input.operation_id === "finance.debt_vs_cash"
            ? await inspectDebtVsCash(inputData)
      : input.operation_id === "service.status_vs_cash"
        ? await inspectServiceVsCash(inputData)
        : input.operation_id === "stock.internal_transfer_vs_saldo"
          ? await inspectInternalTransferVsSaldo(inputData)
      : input.operation_id === "finance.sales_vs_cash"
        ? await inspectSalesVsCash(inputData)
        : input.operation_id === "finance.buyback_vs_cash"
          ? await inspectBuybackVsCash(inputData)
          : input.operation_id === "stock.buyback_vs_saldo"
            ? await inspectBuybackVsStock(inputData)
            : input.operation_id === "report.visibility_diagnostic"
              ? await inspectReportVisibility(inputData)
              : await inspectStockDifference(inputData);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function investigationRunsHandler(req, res, next) {
  try {
    res.json({
      success: true,
      data: await listInvestigationRuns({
        trainingId: trainingIdParam(req),
        helpdeskUser: req.helpdeskUser,
      }),
    });
  } catch (error) {
    next(error);
  }
}

export async function investigationTargetsHandler(req, res, next) {
  try {
    res.json({ success: true, data: await listInvestigationTargets() });
  } catch (error) {
    next(error);
  }
}

export async function upsertInvestigationTargetHandler(req, res, next) {
  try {
    const input = targetSchema.parse(req.body);
    const data = await upsertInvestigationTarget({
      ...input,
      helpdeskUser: req.helpdeskUser,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
