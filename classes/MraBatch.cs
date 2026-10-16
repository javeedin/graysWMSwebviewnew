using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace WMSApp.MRA
{
    /// <summary>
    /// Runs several orders through MRAProcessor the way the Shipping Agent's Print Trip does (wms/shipping-agent.js):
    /// PARALLEL orders at a time, one OrderTypesBatch for the whole run (MRA_ORDER_TYPES is read once), results kept in
    /// the order given, and after two gateway problems in a row the orders not started yet are NOT_SENT (safe to retry).
    /// Every order still writes its own row to WMS_MRA_INTERFACE_STATUS (MRAProcessor's finally).
    /// </summary>
    public static class MraBatch
    {
        public const int PARALLEL = 4;

        public sealed class Item
        {
            public string Order;
            public string Status;          // INTERFACED / ALREADY_DONE / NOT_REQUIRED / FAILED / NOT_SENT
            public MRAProcessingResult Result;   // null when NOT_SENT
            public string NotSentReason;
        }

        /// <summary>make(order) builds the processor (Source / TripId / AppUser set by the caller); the batch id is added here.
        /// onStart / onStep / onDone are progress callbacks (any thread).</summary>
        public static async Task<(List<Item> Items, string StoppedEarly)> RunAsync(IList<string> orders, Func<string, MRAProcessor> make,
            Action<int, string> onStart = null, Action<int, string, string> onStep = null, Action<int, Item> onDone = null, int parallel = PARALLEL)
        {
            var items = new Item[orders.Count];
            string batchId = "ai_" + Guid.NewGuid().ToString("N").Substring(0, 12);
            object gate = new object();
            int next = -1, streak = 0;
            string stop = null;

            async Task Worker()
            {
                while (true)
                {
                    int i = Interlocked.Increment(ref next);
                    if (i >= orders.Count) return;
                    string order = orders[i];
                    string stopNow; lock (gate) stopNow = stop;
                    if (stopNow != null)
                    {
                        items[i] = new Item { Order = order, Status = "NOT_SENT", NotSentReason = stopNow };
                        onDone?.Invoke(i, items[i]);
                        continue;
                    }
                    onStart?.Invoke(i, order);
                    MRAProcessingResult r;
                    try
                    {
                        var p = make(order);
                        p.OrderTypesBatch = batchId;
                        r = await p.ProcessMRAInterfaceAsync(order, (msg, step) => onStep?.Invoke(i, order, msg)).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        r = new MRAProcessingResult { Success = false, Message = ex.Message, CurrentStep = MRAProcessingStep.Failed };
                    }
                    string status = r.Success ? "INTERFACED"
                        : r.Skipped ? "NOT_REQUIRED"
                        : (r.Message ?? "").IndexOf("already done", StringComparison.OrdinalIgnoreCase) >= 0 ? "ALREADY_DONE"
                        : "FAILED";
                    lock (gate)
                    {
                        // the streak counts gateway problems in the order they finish; it resets only when the gateway really answered
                        if (!string.IsNullOrEmpty(r.GatewayProblem)) streak++;
                        else if (r.Success || r.CurrentStep == MRAProcessingStep.CreatingMRAInvoice) streak = 0;
                        if (streak >= 2 && stop == null)
                            stop = $"the MRA gateway failed for {streak} orders in a row (last: {r.GatewayProblem}) - the batch stopped sending to save time. Retry these when the gateway answers again.";
                    }
                    items[i] = new Item { Order = order, Status = status, Result = r };
                    onDone?.Invoke(i, items[i]);
                }
            }

            var workers = new List<Task>();
            for (int w = 0; w < Math.Max(1, Math.Min(parallel, orders.Count)); w++) workers.Add(Worker());
            await Task.WhenAll(workers).ConfigureAwait(false);
            return (new List<Item>(items), stop);
        }
    }
}
