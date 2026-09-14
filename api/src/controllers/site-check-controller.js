import { checkCustomerSite, siteCheckInputSchema } from "../services/site-check-service.js";

export async function siteCheckHandler(req, res, next) {
  try {
    const input = siteCheckInputSchema.parse(req.body);
    const result = await checkCustomerSite(input.domain, { force: input.force });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}
