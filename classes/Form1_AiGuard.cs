using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace WMSApp
{
    /// <summary>
    /// AI Digital Employee: approval integrity. Every approval card the host sends to the page is registered
    /// (IssueAiApprovals, called from PostAiChatAnswer); a decision only runs when it matches a card the host
    /// issued (one use) and the user's policy for that action is not DENY by now. So a changed, replayed or
    /// forged page message cannot run a write the user never saw.
    /// </summary>
    public partial class Form1
    {
        private static string AiNormInstance(string i) => string.Equals((i ?? "").Trim(), "TEST", StringComparison.OrdinalIgnoreCase) ? "TEST" : "PROD";
        private static string AiNormTitle(string t) => string.IsNullOrWhiteSpace(t) ? "WMS AI Result" : t.Trim();
        private static string AiNormOrders(IEnumerable<string> orders) =>
            string.Join(",", (orders ?? Enumerable.Empty<string>()).Where(o => !string.IsNullOrWhiteSpace(o)).Select(o => o.Trim()).Distinct());

        private void IssueAiApprovals(AiChatResult r)
        {
            if (r == null || !r.RequiresApproval) return;
            var svc = GetClaudeCliService();
            if (r.Pending != null)
                svc.IssueApproval("fusion", (r.Pending.Method ?? "").ToUpperInvariant(), r.Pending.Path, r.Pending.Body, AiNormInstance(r.Pending.Instance));
            if (r.PendingEmail != null)
                svc.IssueApproval("email", r.PendingEmail.To, r.PendingEmail.Cc, r.PendingEmail.Subject, r.PendingEmail.BodyHtml);
            if (r.PendingDbWrite != null)
                svc.IssueApproval("dbwrite", r.PendingDbWrite.Sql);
            if (r.PendingJob != null)
                svc.IssueApproval("job", r.PendingJob.JobJson);
            if (r.PendingPrint != null)
                svc.IssueApproval("print", r.PendingPrint.Printer, AiNormTitle(r.PendingPrint.Title));
            if (r.PendingPrintOrders != null)
                svc.IssueApproval("printorders", AiNormOrders(r.PendingPrintOrders.Orders), r.PendingPrintOrders.Printer, AiNormInstance(r.PendingPrintOrders.Instance));
            if (r.PendingMra != null)
                svc.IssueApproval("mra", AiNormOrders(r.PendingMra.Orders), r.PendingMra.TripId, AiNormInstance(r.PendingMra.Instance));
        }

        /// <summary>null = go ahead; otherwise the reason nothing was run.</summary>
        private async Task<string> AiApprovalGuardAsync(string kind, string policyAction, string instance, params string[] parts)
        {
            var svc = GetClaudeCliService();
            if (!svc.ConsumeApproval(kind, parts))
            {
                System.Diagnostics.Debug.WriteLine("[AI GUARD] refused " + kind + ": not an approval the app issued");
                return "Nothing was run: this approval does not match a card the app showed (changed, already used or older than 12 hours). Ask the AI again.";
            }
            if (!string.IsNullOrEmpty(policyAction) && await svc.IsDeniedAsync(policyAction, instance))
                return "Nothing was run: your policy for '" + policyAction + "' is DENY.";
            return null;
        }
    }
}
