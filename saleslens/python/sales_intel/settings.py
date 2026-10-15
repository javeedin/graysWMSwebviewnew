"""Settings with their defaults — nothing about business units, items or thresholds is hard-coded elsewhere (NFR-008).

The host keeps the file (data/settings.json); the page edits it; every run stores the settings it used.
"""
import copy

DEFAULTS = {
    "pod": "PROD",
    "monthsBack": 24,                 # history read from Fusion (RD: at least 24, preferably 36)
    "reportingCurrency": "MUR",
    "businessUnits": [],              # BU ids to keep ([] = all)
    "excludeZeroPrice": True,         # BOGO / free / zero-price lines are not sales
    "excludeItemPatterns": ["CRATE", "CONSIGN", "EMPTY", "DEPOSIT"],   # item number / description words left out (crates, deposits …)
    "excludeOrderTypes": [],          # order type codes left out
    "excludeLinePattern": r"\.\d+$",  # line numbers N.1 / N.2 = consignment / crate lines added by the order pad
    "itemDff": {"profitCenter": "ATTRIBUTE1", "supplier": "ATTRIBUTE2"},
    # missed-opportunity rules
    "analysisMonths": 3,              # the last full months scanned for gaps
    "minHistoryMonths": 4,            # months with a purchase in the 12 before — newer pairs have no baseline
    "minGapValue": 1000,              # smallest lost revenue that counts (reporting currency)
    "minDropPct": 30,                 # actual at least this % under expected
    "zThreshold": 1.2,                # gap / robust spread
    "includeCurrentMonth": False,     # the running month is never complete
    "marginFallbackPct": 25,          # gross margin % used when no item cost is known
    # cause evidence thresholds
    "lateDays": 2,
    "priceUpPct": 3,
    "discountDownPts": 2,
    "returnRatePct": 10,
    "partialRatePct": 15,
    "itemDropPct": 40,                # the item fell this much across every customer → market / lifecycle, not this customer
    "stockoutCancelPct": 10,          # the item lost this % of its ordered quantity to cancellations in the month
    # how much of a gap can be won back, per primary cause
    "recoverability": {
        "STOCKOUT": 0.65, "PARTIAL": 0.6, "LATE": 0.5, "CANCEL": 0.55, "PRICE_UP": 0.4, "DISCOUNT_DOWN": 0.45,
        "MARGIN_LEAK": 0.3, "RETURNS": 0.35, "PAYMENT": 0.3, "CYCLE": 0.5, "INACTIVE": 0.35, "SEASONAL": 0.2,
        "LIFECYCLE": 0.1, "SUBSTITUTION": 0.25, "UNKNOWN": 0.35,
    },
    "tierWeights": {"A": 1.25, "B": 1.0, "C": 0.8},
    "defaultElasticity": -1.2,
    "churnHorizonMonths": 3,
    "churnDropPct": 50,
    "topToApex": 2000,
    "nightly": {"on": False, "at": "02:30", "refreshMonths": 2},
    "costSource": None,               # {table, itemCol, costCol} found on the pod
    "apexBase": "",                   # another APEX gateway for the WMS_SI_* copy ('' = the app's)
    "allowedBus": {},                 # login → [bu ids]; missing = every BU
}


def merge(user):
    out = copy.deepcopy(DEFAULTS)
    for k, v in (user or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
        else:
            out[k] = v
    return out
