'use strict';

// Adapt the Android DTO to the existing server-priced purchase handler.
module.exports = function purchaseV2(purchase, report = code => console.warn('[PurchaseV2]', code)) {
  return function handle(req, res) {
    // Log only known error codes, never request bodies, tokens or receipts.
    const json = res.json;
    res.json = function (body) {
      const known = new Set(['AUTHENTICATION_REQUIRED', 'ITEM_ID_REQUIRED',
        'CONFLICTING_ITEM_ID', 'CONFLICTING_EXTRA_PARAMETERS',
        'UNSUPPORTED_PURCHASE_PARAMETERS', 'ITEM_NOT_FOUND', 'INVALID_PRICE',
        'INSUFFICIENT_FUNDS', 'IAP_RECEIPT_VALIDATION_REQUIRED', 'INTERNAL_SERVER_ERROR']);
      if (known.has(body?.error)) report(body.error);
      return json.call(this, body);
    };
    if (!req.user) return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
    const body = req.body || {};
    if (body.ItemId != null && body.itemId != null && body.ItemId !== body.itemId) {
      return res.status(400).json({ error: 'CONFLICTING_ITEM_ID' });
    }
    if (body.ExtraParameters != null && body.extraParameters != null) {
      return res.status(400).json({ error: 'CONFLICTING_EXTRA_PARAMETERS' });
    }
    const ItemId = body.ItemId ?? body.itemId;
    const ExtraParameters = body.ExtraParameters ?? body.extraParameters;
    if (typeof ItemId !== 'string' || !ItemId.trim()) {
      return res.status(400).json({ error: 'ITEM_ID_REQUIRED' });
    }
    // Do not silently ignore receipt/offer parameters with unknown semantics.
    if (ExtraParameters != null && (typeof ExtraParameters !== 'object'
        || Array.isArray(ExtraParameters) || Object.keys(ExtraParameters).length)) {
      return res.status(400).json({ error: 'UNSUPPORTED_PURCHASE_PARAMETERS' });
    }
    req.params = { ...req.params, item: ItemId };
    return purchase(req, res);
  };
};
