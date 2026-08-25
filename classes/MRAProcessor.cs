using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace WMSApp.MRA
{
    /// <summary>
    /// Main MRA processor - handles all steps of MRA interface process
    /// </summary>
    public class MRAProcessor
    {
        private readonly string _fusionUsername;
        private readonly string _fusionPassword;
        private readonly string _instance;
        private readonly string _mraApiUrl;

        // Report paths
        private const string MRA_CHECK_REPORT = "/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/MRA_TRX_NO_CHECK_BIP.xdo";
        private const string ORDER_SUMMARY_REPORT = "/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/ORDER_SUMMARY_4_ORDER_NUMBER_BIP.xdo";
        private const string ORDER_DETAILS_REPORT = "/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/ORDER_DETAILS_MRA_BIP.xdo";

        // Org IDs
        private const string INVENTORY_ORG_ID = "300000003277749";
        private const string ORG_ID = "300000003234003";

        public MRAProcessor(
            string fusionUsername,
            string fusionPassword,
            string instance,
            string mraApiUrl = "http://mra.busi.in/MRAInvoice.php")
        {
            _fusionUsername = fusionUsername;
            _fusionPassword = fusionPassword;
            _instance = instance;
            _mraApiUrl = mraApiUrl;
        }

        /// <summary>
        /// Main method to process MRA interface for an order
        /// </summary>
        public async Task<MRAProcessingResult> ProcessMRAInterfaceAsync(
            string orderNumber,
            Action<string, MRAProcessingStep> progressCallback = null,
            Action<Dictionary<string, object>, List<Dictionary<string, object>>> orderDataCallback = null,
            Action<string, object> mraRequestCallback = null,
            Action<bool, object> mraResponseCallback = null,
            Action<string, string> logCallback = null)
        {
            var result = new MRAProcessingResult
            {
                OrderNumber = orderNumber,
                CurrentStep = MRAProcessingStep.Initial
            };

            try
            {
                // Step 1: Check if already interfaced to MRA
                progressCallback?.Invoke("Checking if order is already interfaced to MRA...", MRAProcessingStep.CheckingMRAStatus);
                result.CurrentStep = MRAProcessingStep.CheckingMRAStatus;

                var mraCheck = await CheckMRAInterfaceStatusAsync(orderNumber, logCallback);
                if (mraCheck.IsInterfaced)
                {
                    result.Success = false;
                    result.Message = $"MRA interface is already done for order {orderNumber}";
                    result.CurrentStep = MRAProcessingStep.Completed;
                    return result;
                }

                // Step 2: Fetch order summary
                progressCallback?.Invoke("Fetching order summary from Fusion...", MRAProcessingStep.FetchingOrderSummary);
                result.CurrentStep = MRAProcessingStep.FetchingOrderSummary;

                var orderSummary = await FetchOrderSummaryAsync(orderNumber, logCallback);
                if (orderSummary == null || orderSummary.Tables.Count < 2 || orderSummary.Tables[1].Rows.Count == 0)
                {
                    logCallback?.Invoke(
                        $"Order summary not found — report returned {(orderSummary?.Tables.Count ?? 0)} table(s); expected data rows in Table[1]. Review the report parameters and XML logged above.",
                        "warning");
                    result.Success = false;
                    result.Message = "Order summary not found";
                    result.CurrentStep = MRAProcessingStep.Failed;
                    return result;
                }

                // Step 3: Fetch order details
                progressCallback?.Invoke("Fetching order line details from Fusion...", MRAProcessingStep.FetchingOrderDetails);
                result.CurrentStep = MRAProcessingStep.FetchingOrderDetails;

                var orderDetails = await FetchOrderDetailsAsync(orderNumber, logCallback);
                if (orderDetails == null || orderDetails.Tables.Count < 2 || orderDetails.Tables[1].Rows.Count == 0)
                {
                    int tblCount = orderDetails?.Tables.Count ?? 0;
                    int t1Rows = (orderDetails != null && orderDetails.Tables.Count > 1) ? orderDetails.Tables[1].Rows.Count : 0;
                    logCallback?.Invoke(
                        $"Order details not found — report returned {tblCount} table(s), Table[1] rows={t1Rows}. Expected order lines in Table[1]. " +
                        $"Parameters used: ORG_ID={ORG_ID}, INVENTORY_ORG_ID={INVENTORY_ORG_ID}, SOURCE_ORDER_NUMBER={orderNumber}. Review the report XML logged above.",
                        "warning");
                    result.Success = false;
                    result.Message = "Order details not found";
                    result.CurrentStep = MRAProcessingStep.Failed;
                    return result;
                }

                // Send order data to JavaScript for Tab 1
                if (orderDataCallback != null)
                {
                    try
                    {
                        var headerData = ConvertDataRowToDictionary(orderSummary.Tables[1].Rows[0]);
                        var linesData = ConvertDataTableToList(orderDetails.Tables[1]);
                        orderDataCallback(headerData, linesData);
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Error sending order data: {ex.Message}");
                    }
                }

                // Step 4: Validate all lines are closed
                progressCallback?.Invoke("Validating order line statuses...", MRAProcessingStep.ValidatingOrderLines);
                result.CurrentStep = MRAProcessingStep.ValidatingOrderLines;

                var validation = ValidateOrderLines(orderDetails.Tables[1]);
                if (!validation.AllLinesClosed)
                {
                    result.Success = false;
                    result.Message = $"Cannot interface to MRA: {validation.Message}";
                    result.ErrorDetails = string.Join(", ", validation.OpenLines);
                    result.CurrentStep = MRAProcessingStep.Failed;
                    return result;
                }

                // Step 5: Create MRA invoice
                progressCallback?.Invoke("Creating MRA invoice...", MRAProcessingStep.CreatingMRAInvoice);
                result.CurrentStep = MRAProcessingStep.CreatingMRAInvoice;

                var invoiceResult = await CreateMRAInvoiceAsync(orderSummary.Tables[1], orderDetails.Tables[1], mraRequestCallback, mraResponseCallback);
                if (!invoiceResult.Success)
                {
                    result.Success = false;
                    result.Message = $"Failed to create MRA invoice: {invoiceResult.ErrorMessage}";
                    result.CurrentStep = MRAProcessingStep.Failed;
                    return result;
                }

                result.IrnCode = invoiceResult.IrnCode;
                result.QrCodeBase64 = invoiceResult.QrCodeBase64;
                result.HeaderId = orderSummary.Tables[1].Rows[0]["HEADER_ID"]?.ToString();

                // Step 6: Update Fusion Order
                progressCallback?.Invoke("Updating Fusion Order Management...", MRAProcessingStep.UpdatingFusionOrder);
                result.CurrentStep = MRAProcessingStep.UpdatingFusionOrder;

                var updateResult = await UpdateFusionOrderAsync(result.HeaderId, result.IrnCode);
                if (!updateResult.Success)
                {
                    result.Success = false;
                    result.Message = $"MRA invoice created but failed to update Fusion: {updateResult.Message}";
                    result.CurrentStep = MRAProcessingStep.Failed;
                    return result;
                }

                // Success!
                result.Success = true;
                result.Message = $"MRA interface completed successfully. IRN: {result.IrnCode}";
                result.CurrentStep = MRAProcessingStep.Completed;

                return result;
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Message = $"Error during MRA processing: {ex.Message}";
                result.ErrorDetails = ex.StackTrace;
                result.CurrentStep = MRAProcessingStep.Failed;
                return result;
            }
        }

        /// <summary>
        /// Step 1: Check if order is already interfaced to MRA
        /// </summary>
        private async Task<MRACheckResult> CheckMRAInterfaceStatusAsync(string orderNumber, Action<string, string> logCallback = null)
        {
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] CheckMRAInterfaceStatusAsync - Order: {orderNumber}, Instance: {_instance}");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ========== MRA CHECK PARAMETERS ==========");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Order Number: '{orderNumber}'");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Order Number Length: {orderNumber?.Length ?? 0}");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Instance: '{_instance}'");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ==========================================");

            var reportRunner = new FusionReportRunner(_fusionUsername, _fusionPassword, _instance);

            var parameters = new Dictionary<string, string>
            {
                { "source_order_number", orderNumber }
            };

            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Running MRA check report: {MRA_CHECK_REPORT}");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Parameter: source_order_number = '{orderNumber}'");
            var reportResult = await reportRunner.RunReportAsync(MRA_CHECK_REPORT, parameters, log: msg => logCallback?.Invoke(msg, "info"));

            if (!reportResult.Success)
            {
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] MRA check report FAILED: {reportResult.ErrorMessage}");
                throw new Exception($"Failed to check MRA status: {reportResult.ErrorMessage}");
            }

            // Debug: Log the raw XML data
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ========== RAW XML DATA ==========");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] {reportResult.RawXmlData}");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ========== END RAW XML ==========");

            // Debug: Log the dataset structure with ALL data
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] MRA check report SUCCESS. Tables count: {reportResult.DataSet.Tables.Count}");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ========== ALL TABLES DATA ==========");
            for (int i = 0; i < reportResult.DataSet.Tables.Count; i++)
            {
                var table = reportResult.DataSet.Tables[i];
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ----- Table[{i}]: Name={table.TableName}, Rows={table.Rows.Count}, Columns={table.Columns.Count} -----");

                // Log column names
                var columnNames = new List<string>();
                foreach (DataColumn col in table.Columns)
                {
                    columnNames.Add(col.ColumnName);
                }
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Table[{i}] Columns: {string.Join(", ", columnNames)}");

                // Log ALL rows data
                if (table.Rows.Count > 0)
                {
                    for (int rowIdx = 0; rowIdx < table.Rows.Count; rowIdx++)
                    {
                        var rowValues = new List<string>();
                        foreach (DataColumn col in table.Columns)
                        {
                            var val = table.Rows[rowIdx][col];
                            rowValues.Add($"{col.ColumnName}={val ?? "(null)"}");
                        }
                        System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Table[{i}] Row[{rowIdx}]: {string.Join(", ", rowValues)}");
                    }
                }
                else
                {
                    System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Table[{i}] has NO ROWS");
                }
            }
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ========== END ALL TABLES DATA ==========");

            // Tables[0] = parameters, Tables[1] = MRA data for this specific order
            // If order is NOT interfaced → Tables[1] will have 0 rows
            // If order IS interfaced → Tables[1] will have 1 row with MRA_TRX_NO
            bool isInterfaced = false;
            string mraTrxNo = string.Empty;

            // Check if Tables[1] exists
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ========== TABLE[1] ANALYSIS ==========");
            if (reportResult.DataSet.Tables.Count > 1)
            {
                DataTable dtMRA = reportResult.DataSet.Tables[1];
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Table[1] EXISTS - Name: {dtMRA.TableName}, Rows: {dtMRA.Rows.Count}, Columns: {dtMRA.Columns.Count}");

                // Log ALL columns
                var colNames = new List<string>();
                foreach (DataColumn col in dtMRA.Columns)
                {
                    colNames.Add(col.ColumnName);
                }
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Table[1] Columns: {string.Join(", ", colNames)}");

                // Log ALL rows with ALL column values
                if (dtMRA.Rows.Count > 0)
                {
                    System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Table[1] DATA ({dtMRA.Rows.Count} rows):");
                    for (int rowIdx = 0; rowIdx < dtMRA.Rows.Count; rowIdx++)
                    {
                        var rowVals = new List<string>();
                        foreach (DataColumn col in dtMRA.Columns)
                        {
                            var val = dtMRA.Rows[rowIdx][col];
                            rowVals.Add($"{col.ColumnName}='{val}'");
                        }
                        System.Diagnostics.Debug.WriteLine($"[MRAProcessor]   Row[{rowIdx}]: {string.Join(", ", rowVals)}");
                    }

                    // Check MRA_TRX_NO from first row
                    if (dtMRA.Columns.Contains("MRA_TRX_NO"))
                    {
                        mraTrxNo = dtMRA.Rows[0]["MRA_TRX_NO"]?.ToString() ?? string.Empty;
                        System.Diagnostics.Debug.WriteLine($"[MRAProcessor] MRA_TRX_NO from Row[0]: '{mraTrxNo}'");

                        // If MRA_TRX_NO has value → already interfaced
                        if (!string.IsNullOrWhiteSpace(mraTrxNo))
                        {
                            isInterfaced = true;
                            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] MRA_TRX_NO has value - ORDER IS INTERFACED");
                        }
                        else
                        {
                            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] MRA_TRX_NO is empty - ORDER NOT INTERFACED");
                        }
                    }
                    else
                    {
                        System.Diagnostics.Debug.WriteLine($"[MRAProcessor] WARNING: MRA_TRX_NO column not found in Table[1]!");
                    }
                }
                else
                {
                    System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Table[1] has NO ROWS - order not interfaced");
                }
            }
            else
            {
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Table[1] DOES NOT EXIST (Tables.Count={reportResult.DataSet.Tables.Count})");
            }
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ========== END TABLE[1] ANALYSIS ==========");

            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] FINAL RESULT - IsInterfaced: {isInterfaced}, MRA_TRX_NO: '{mraTrxNo}'");

            return new MRACheckResult
            {
                IsInterfaced = isInterfaced,
                Message = isInterfaced ? $"Order already interfaced to MRA (TRX: {mraTrxNo})" : "Order not yet interfaced",
                MraOrderNumber = orderNumber
            };
        }

        /// <summary>
        /// Step 2: Fetch order summary
        /// </summary>
        private async Task<DataSet> FetchOrderSummaryAsync(string orderNumber, Action<string, string> logCallback = null)
        {
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ========== FETCH ORDER SUMMARY ==========");
            var reportRunner = new FusionReportRunner(_fusionUsername, _fusionPassword, _instance);

            var parameters = new Dictionary<string, string>
            {
                { "INVENTORY_ORG_ID", INVENTORY_ORG_ID },
                { "ORG_ID", ORG_ID },
                { "SOURCE_ORDER_NUMBER", orderNumber }
            };

            var reportResult = await reportRunner.RunReportAsync(ORDER_SUMMARY_REPORT, parameters, log: msg => logCallback?.Invoke(msg, "info"));

            if (!reportResult.Success)
            {
                throw new Exception($"Failed to fetch order summary: {reportResult.ErrorMessage}");
            }

            // Debug: Log tables structure
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Order Summary - Tables count: {reportResult.DataSet.Tables.Count}");
            for (int i = 0; i < reportResult.DataSet.Tables.Count; i++)
            {
                var table = reportResult.DataSet.Tables[i];
                var cols = new List<string>();
                foreach (DataColumn col in table.Columns) cols.Add(col.ColumnName);
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Summary Table[{i}]: Name={table.TableName}, Rows={table.Rows.Count}, Columns: {string.Join(", ", cols)}");

                if (table.Rows.Count > 0)
                {
                    var vals = new List<string>();
                    foreach (DataColumn col in table.Columns) vals.Add($"{col.ColumnName}={table.Rows[0][col]}");
                    System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Summary Table[{i}] Row[0]: {string.Join(", ", vals)}");
                }
            }

            return reportResult.DataSet;
        }

        /// <summary>
        /// Step 3: Fetch order details
        /// </summary>
        private async Task<DataSet> FetchOrderDetailsAsync(string orderNumber, Action<string, string> logCallback = null)
        {
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ========== FETCH ORDER DETAILS ==========");
            var reportRunner = new FusionReportRunner(_fusionUsername, _fusionPassword, _instance);

            var parameters = new Dictionary<string, string>
            {
                { "INVENTORY_ORG_ID", INVENTORY_ORG_ID },
                { "ORG_ID", ORG_ID },
                { "SOURCE_ORDER_NUMBER", orderNumber }
            };

            var reportResult = await reportRunner.RunReportAsync(ORDER_DETAILS_REPORT, parameters, log: msg => logCallback?.Invoke(msg, "info"));

            if (!reportResult.Success)
            {
                throw new Exception($"Failed to fetch order details: {reportResult.ErrorMessage}");
            }

            // Debug: Log tables structure
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Order Details - Tables count: {reportResult.DataSet.Tables.Count}");
            for (int i = 0; i < reportResult.DataSet.Tables.Count; i++)
            {
                var table = reportResult.DataSet.Tables[i];
                var cols = new List<string>();
                foreach (DataColumn col in table.Columns) cols.Add(col.ColumnName);
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Details Table[{i}]: Name={table.TableName}, Rows={table.Rows.Count}, Columns: {string.Join(", ", cols)}");

                if (table.Rows.Count > 0)
                {
                    var vals = new List<string>();
                    foreach (DataColumn col in table.Columns) vals.Add($"{col.ColumnName}={table.Rows[0][col]}");
                    System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Details Table[{i}] Row[0]: {string.Join(", ", vals)}");
                }
            }

            return reportResult.DataSet;
        }

        /// <summary>
        /// Step 4: Validate all order lines are closed
        /// </summary>
        private OrderValidationResult ValidateOrderLines(DataTable orderLinesTable)
        {
            var result = new OrderValidationResult
            {
                AllLinesClosed = true,
                OpenLines = new List<string>()
            };

            if (orderLinesTable == null || orderLinesTable.Rows.Count == 0)
            {
                result.AllLinesClosed = true;
                result.Message = "No lines found (treated as valid)";
                return result;
            }

            // Debug: Log available columns
            var columnNames = new List<string>();
            foreach (DataColumn col in orderLinesTable.Columns)
            {
                columnNames.Add(col.ColumnName);
            }
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ValidateOrderLines - Available columns: {string.Join(", ", columnNames)}");
            System.Diagnostics.Debug.WriteLine($"[MRAProcessor] ValidateOrderLines - Rows: {orderLinesTable.Rows.Count}");

            // Check if LINE_STATUS column exists
            if (!orderLinesTable.Columns.Contains("LINE_STATUS"))
            {
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] WARNING: LINE_STATUS column not found! Skipping validation.");
                result.AllLinesClosed = true;
                result.Message = "Line status validation skipped (column not found)";
                return result;
            }

            foreach (DataRow row in orderLinesTable.Rows)
            {
                string status = row["LINE_STATUS"]?.ToString()?.ToUpper() ?? string.Empty;
                string lineNumber = orderLinesTable.Columns.Contains("LINE_NUMBER")
                    ? row["LINE_NUMBER"]?.ToString() ?? "Unknown"
                    : "Unknown";

                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Line {lineNumber}: Status = '{status}'");

                if (status != "CLOSED" && status != "AWAIT_BILLING" && status != "BILLED" && status != "SHIPPED" && status != "CANCELED")
                {
                    result.AllLinesClosed = false;
                    result.OpenLines.Add($"Line {lineNumber}: {status}");
                }
            }

            if (!result.AllLinesClosed)
            {
                result.Message = $"Found {result.OpenLines.Count} line(s) that are not closed/billed/shipped";
            }
            else
            {
                result.Message = "All lines are closed/billed/shipped";
            }

            return result;
        }

        /// <summary>
        /// Step 5: Create MRA invoice via API
        /// </summary>
        private async Task<MRAInvoiceCreationResult> CreateMRAInvoiceAsync(
            DataTable orderSummary,
            DataTable orderDetails,
            Action<string, object> mraRequestCallback = null,
            Action<bool, object> mraResponseCallback = null)
        {
            try
            {
                DataRow headerRow = orderSummary.Rows[0];

                // Build invoice object
                string orderType = headerRow["ORDER_TYPE_CODE"]?.ToString();
                DateTime orderDate = Convert.ToDateTime(headerRow["ORDER_DATE"]);
                string formattedDate = orderDate.ToString("yyyyMMdd HH:mm:ss");
                double totalOrderAmount = Convert.ToDouble(headerRow["ORDER_AMOUNT"]);
                string mraTan = headerRow["MRA_TAN"]?.ToString();
                string mraBrn = headerRow["MRA_BRN"]?.ToString();
                string mraId = headerRow["MRA_ID"]?.ToString();

                string invoiceTypeDesc = "STD";
                string reasonStated = "";
                string invoiceRefIdentifier = "";

                if (totalOrderAmount < 0)
                {
                    invoiceTypeDesc = "CRN";
                    reasonStated = "RETURN ORDER";
                    invoiceRefIdentifier = headerRow["REFERENCE_NO"]?.ToString();
                    if (string.IsNullOrEmpty(invoiceRefIdentifier))
                    {
                        invoiceRefIdentifier = headerRow["SOURCE_ORDER_NUMBER"]?.ToString();
                    }
                }

                if (orderType == "PRO-FORMA INVOICE")
                {
                    invoiceTypeDesc = "PRF";
                }

                string buname = "GRAYS INC BU";

                string pVatRegNo = "";
                try { pVatRegNo = headerRow["VATREGNO"]?.ToString(); } catch { }

                var invoice = new Invoice
                {
                    EbsMraId = mraId,
                    InvoiceCounter = headerRow["HEADER_ID"]?.ToString(),
                    TransactionType = headerRow["MRA_CUSTOMER_CAT"]?.ToString(),
                    PreviousNoteHash = "prevNote",
                    PersonType = "VATR",
                    InvoiceTypeDesc = invoiceTypeDesc,
                    Currency = "MUR",
                    InvoiceIdentifier = headerRow["SOURCE_ORDER_NUMBER"]?.ToString(),
                    TotalVatAmount = Math.Round(Math.Abs(Convert.ToDouble(headerRow["TAX_AMOUNT"])), 3),
                    TotalAmtWoVatCur = Math.Round(Math.Abs(Convert.ToDouble(headerRow["ORDER_AMOUNT"])) - Math.Abs(Convert.ToDouble(headerRow["TAX_AMOUNT"])), 3),
                    TotalAmtWoVatMur = Math.Round(Math.Abs(Convert.ToDouble(headerRow["ORDER_AMOUNT"])) - Math.Abs(Convert.ToDouble(headerRow["TAX_AMOUNT"])), 3),
                    InvoiceTotal = Math.Round(Math.Abs(Convert.ToDouble(headerRow["ORDER_AMOUNT"])), 3),
                    DiscountTotalAmount = Math.Round(Math.Abs(Convert.ToDouble(headerRow["DISCOUNT_AMOUNT"])), 3),
                    TotalAmtPaid = Math.Round(Math.Abs(Convert.ToDouble(headerRow["ORDER_AMOUNT"])), 3),
                    DateTimeInvoiceIssued = formattedDate,
                    SalesTransactions = "CASH",
                    ReasonStated = reasonStated,
                    InvoiceRefIdentifier = invoiceRefIdentifier,

                    Seller = new Seller
                    {
                        Name = buname,
                        TradeName = buname,
                        Tan = mraTan,
                        Brn = mraBrn,
                        BusinessAddr = "BEAU-PLAN",
                        BusinessPhoneNo = "2093000",
                        EbsCounterNo = "20"
                    },

                    Buyer = new Buyer
                    {
                        Name = headerRow["ACCOUNT_NAME"]?.ToString(),
                        Brn = headerRow["BRN"]?.ToString() ?? "",
                        BusinessAddr = headerRow["CUSTOMER_MAIN_CAT"]?.ToString(),
                        BuyerType = "VATR",
                        Tan = pVatRegNo
                    },

                    ItemList = new List<InvoiceItem>()
                };

                // Add line items
                int rowNumber = 1;
                foreach (DataRow itemRow in orderDetails.Rows)
                {
                    string taxCode = itemRow["TAX_CLASSIFICATION_CODE"]?.ToString();
                    string finalTaxCode;
                    if (taxCode == "6004") finalTaxCode = "TC01";
                    else if (taxCode == "23006") finalTaxCode = "TC03";
                    else finalTaxCode = "TC01";

                    string nature = itemRow["ITEM_NUMBER"]?.ToString().Contains("SGG") == true ? "SERVICES" : "GOODS";

                    invoice.ItemList.Add(new InvoiceItem
                    {
                        ItemNo = rowNumber.ToString(),
                        TaxCode = finalTaxCode,
                        Nature = nature,
                        ProductCodeMra = rowNumber.ToString(),
                        ProductCodeOwn = itemRow["ITEM_NUMBER"]?.ToString(),
                        ItemDesc = itemRow["DESCRIPTION"]?.ToString(),
                        Quantity = Convert.ToInt32(itemRow["ORIGINAL_QTY"]),
                        UnitPrice = Convert.ToDouble(itemRow["UNIT_LIST_PRICE"]),
                        Discount = Math.Round(Math.Abs(Convert.ToDouble(itemRow["DISCOUNT_AMOUNT"])), 3),
                        DiscountedValue = Math.Round(Math.Abs(Convert.ToDouble(itemRow["DISCOUNT_AMOUNT"])), 3),
                        AmtWoVatCur = Math.Round(Convert.ToDouble(itemRow["NET_AMOUNT"]) - Convert.ToDouble(itemRow["TAX_AMOUNT"]), 3),
                        AmtWoVatMur = Math.Round(Convert.ToDouble(itemRow["NET_AMOUNT"]) - Convert.ToDouble(itemRow["TAX_AMOUNT"]), 3),
                        VatAmt = Math.Round(Convert.ToDouble(itemRow["TAX_AMOUNT"]), 3),
                        TotalPrice = Math.Round(Convert.ToDouble(itemRow["NET_AMOUNT"]), 3)
                    });
                    rowNumber++;
                }

                // Serialize to JSON
                string jsonData = JsonConvert.SerializeObject(invoice, Formatting.Indented);
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Invoice JSON: {jsonData}");

                // Send MRA request info to JavaScript for Tab 2
                try
                {
                    mraRequestCallback?.Invoke(_mraApiUrl, invoice);
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Error sending MRA request data: {ex.Message}");
                }

                // Send to MRA API
                using (HttpClient client = new HttpClient())
                {
                    var content = new StringContent(jsonData, Encoding.UTF8, "application/json");
                    HttpResponseMessage response = await client.PostAsync(_mraApiUrl, content);
                    string responseBody = await response.Content.ReadAsStringAsync();

                    System.Diagnostics.Debug.WriteLine($"[MRAProcessor] MRA API Response: {responseBody}");

                    // Parse response
                    var apiResponse = JsonConvert.DeserializeObject<MRAApiResponse>(responseBody);
                    string irnCode = apiResponse?.Response?.ResponseId;
                    string qrCode = apiResponse?.Response?.FiscalisedInvoices?.FirstOrDefault()?.QrCode;

                    // Send MRA response info to JavaScript for Tab 2
                    bool isSuccess = !string.IsNullOrEmpty(irnCode);
                    try
                    {
                        mraResponseCallback?.Invoke(isSuccess, new {
                            httpStatus = (int)response.StatusCode,
                            responseId = irnCode,
                            qrCode = qrCode,
                            rawResponse = responseBody
                        });
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Error sending MRA response data: {ex.Message}");
                    }

                    return new MRAInvoiceCreationResult
                    {
                        Success = true,
                        IrnCode = irnCode,
                        QrCodeBase64 = qrCode,
                        RawResponse = responseBody
                    };
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor ERROR] Create invoice failed: {ex.Message}");
                return new MRAInvoiceCreationResult
                {
                    Success = false,
                    ErrorMessage = ex.Message
                };
            }
        }

        /// <summary>
        /// Step 6: Update Fusion Order Management with IRN code
        /// </summary>
        private async Task<OracleFusionUpdateResult> UpdateFusionOrderAsync(string headerId, string irnCode)
        {
            try
            {
                string baseUrl = _instance.ToUpper() == "PROD"
                    ? "https://efmh.fa.em3.oraclecloud.com"
                    : "https://efmh-test.fa.em3.oraclecloud.com";

                string endpoint = $"/fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/{headerId}";

                var updateRequest = new OracleFusionUpdateRequest
                {
                    AdditionalInformation = new List<AdditionalInformation>
                    {
                        new AdditionalInformation
                        {
                            HeaderEffBGRAYSprivateVO = new List<HeaderEffBGRAYSprivateVO>
                            {
                                new HeaderEffBGRAYSprivateVO
                                {
                                    HoldReleasedBy = irnCode
                                }
                            }
                        }
                    }
                };

                string json = JsonConvert.SerializeObject(updateRequest, Formatting.Indented);
                System.Diagnostics.Debug.WriteLine($"[MRAProcessor] Update JSON: {json}");

                using (var client = new HttpClient())
                {
                    client.BaseAddress = new Uri(baseUrl);
                    var byteArray = Encoding.ASCII.GetBytes($"{_fusionUsername}:{_fusionPassword}");
                    client.DefaultRequestHeaders.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", Convert.ToBase64String(byteArray));

                    var request = new HttpRequestMessage
                    {
                        Method = new HttpMethod("PATCH"),
                        RequestUri = new Uri(endpoint, UriKind.Relative),
                        Content = new StringContent(json, Encoding.UTF8, "application/json")
                    };

                    HttpResponseMessage response = await client.SendAsync(request);
                    string result = await response.Content.ReadAsStringAsync();

                    if (response.StatusCode == System.Net.HttpStatusCode.OK)
                    {
                        return new OracleFusionUpdateResult
                        {
                            Success = true,
                            Message = "Fusion order updated successfully"
                        };
                    }
                    else
                    {
                        return new OracleFusionUpdateResult
                        {
                            Success = false,
                            Message = $"Update failed: {response.StatusCode} - {result}"
                        };
                    }
                }
            }
            catch (Exception ex)
            {
                return new OracleFusionUpdateResult
                {
                    Success = false,
                    Message = $"Exception: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Convert DataRow to Dictionary for JSON serialization
        /// </summary>
        private Dictionary<string, object> ConvertDataRowToDictionary(DataRow row)
        {
            var dict = new Dictionary<string, object>();
            foreach (DataColumn column in row.Table.Columns)
            {
                dict[column.ColumnName] = row[column] == DBNull.Value ? null : row[column];
            }
            return dict;
        }

        /// <summary>
        /// Convert DataTable to List of Dictionaries for JSON serialization
        /// </summary>
        private List<Dictionary<string, object>> ConvertDataTableToList(DataTable table)
        {
            var list = new List<Dictionary<string, object>>();
            foreach (DataRow row in table.Rows)
            {
                list.Add(ConvertDataRowToDictionary(row));
            }
            return list;
        }
    }

    // Helper result classes
    public class MRAInvoiceCreationResult
    {
        public bool Success { get; set; }
        public string IrnCode { get; set; }
        public string QrCodeBase64 { get; set; }
        public string RawResponse { get; set; }
        public string ErrorMessage { get; set; }
    }

    public class OracleFusionUpdateResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
    }
}
