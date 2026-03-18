using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace WMSApp.MRA
{
    /// <summary>
    /// Data models for MRA invoice interface
    /// </summary>

    #region MRA Invoice Models

    public class Invoice
    {
        [JsonProperty("ebsMraId")]
        public string EbsMraId { get; set; }

        [JsonProperty("invoiceCounter")]
        public string InvoiceCounter { get; set; }

        [JsonProperty("transactionType")]
        public string TransactionType { get; set; }

        [JsonProperty("previousNoteHash")]
        public string PreviousNoteHash { get; set; }

        [JsonProperty("personType")]
        public string PersonType { get; set; }

        [JsonProperty("invoiceTypeDesc")]
        public string InvoiceTypeDesc { get; set; }

        [JsonProperty("currency")]
        public string Currency { get; set; }

        [JsonProperty("invoiceIdentifier")]
        public string InvoiceIdentifier { get; set; }

        [JsonProperty("totalVatAmount")]
        public double TotalVatAmount { get; set; }

        [JsonProperty("totalAmtWoVatCur")]
        public double TotalAmtWoVatCur { get; set; }

        [JsonProperty("totalAmtWoVatMur")]
        public double TotalAmtWoVatMur { get; set; }

        [JsonProperty("invoiceTotal")]
        public double InvoiceTotal { get; set; }

        [JsonProperty("discountTotalAmount")]
        public double DiscountTotalAmount { get; set; }

        [JsonProperty("totalAmtPaid")]
        public double TotalAmtPaid { get; set; }

        [JsonProperty("dateTimeInvoiceIssued")]
        public string DateTimeInvoiceIssued { get; set; }

        [JsonProperty("salesTransactions")]
        public string SalesTransactions { get; set; }

        [JsonProperty("reasonStated")]
        public string ReasonStated { get; set; }

        [JsonProperty("invoiceRefIdentifier")]
        public string InvoiceRefIdentifier { get; set; }

        [JsonProperty("seller")]
        public Seller Seller { get; set; }

        [JsonProperty("buyer")]
        public Buyer Buyer { get; set; }

        [JsonProperty("itemList")]
        public List<InvoiceItem> ItemList { get; set; }
    }

    public class Seller
    {
        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("tradeName")]
        public string TradeName { get; set; }

        [JsonProperty("tan")]
        public string Tan { get; set; }

        [JsonProperty("brn")]
        public string Brn { get; set; }

        [JsonProperty("businessAddr")]
        public string BusinessAddr { get; set; }

        [JsonProperty("businessPhoneNo")]
        public string BusinessPhoneNo { get; set; }

        [JsonProperty("ebsCounterNo")]
        public string EbsCounterNo { get; set; }
    }

    public class Buyer
    {
        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("brn")]
        public string Brn { get; set; }

        [JsonProperty("businessAddr")]
        public string BusinessAddr { get; set; }

        [JsonProperty("buyerType")]
        public string BuyerType { get; set; }
    }

    public class InvoiceItem
    {
        [JsonProperty("itemNo")]
        public string ItemNo { get; set; }

        [JsonProperty("taxCode")]
        public string TaxCode { get; set; }

        [JsonProperty("nature")]
        public string Nature { get; set; }

        [JsonProperty("productCodeMra")]
        public string ProductCodeMra { get; set; }

        [JsonProperty("productCodeOwn")]
        public string ProductCodeOwn { get; set; }

        [JsonProperty("itemDesc")]
        public string ItemDesc { get; set; }

        [JsonProperty("quantity")]
        public int Quantity { get; set; }

        [JsonProperty("unitPrice")]
        public double UnitPrice { get; set; }

        [JsonProperty("discount")]
        public double Discount { get; set; }

        [JsonProperty("discountedValue")]
        public double DiscountedValue { get; set; }

        [JsonProperty("amtWoVatCur")]
        public double AmtWoVatCur { get; set; }

        [JsonProperty("amtWoVatMur")]
        public double AmtWoVatMur { get; set; }

        [JsonProperty("vatAmt")]
        public double VatAmt { get; set; }

        [JsonProperty("totalPrice")]
        public double TotalPrice { get; set; }
    }

    #endregion

    #region MRA API Response Models

    public class MRAApiResponse
    {
        [JsonProperty("Response")]
        public MRAResponse Response { get; set; }
    }

    public class MRAResponse
    {
        [JsonProperty("ResponseId")]
        public string ResponseId { get; set; }

        [JsonProperty("FiscalisedInvoices")]
        public List<FiscalisedInvoice> FiscalisedInvoices { get; set; }
    }

    public class FiscalisedInvoice
    {
        [JsonProperty("Irn")]
        public string Irn { get; set; }

        [JsonProperty("QrCode")]
        public string QrCode { get; set; }
    }

    #endregion

    #region Oracle Fusion Update Models

    public class OracleFusionUpdateRequest
    {
        [JsonProperty("additionalInformation")]
        public List<AdditionalInformation> AdditionalInformation { get; set; }
    }

    public class AdditionalInformation
    {
        [JsonProperty("Category")]
        public string Category { get; set; } = "DOO_HEADERS_ADD_INFO";

        [JsonProperty("HeaderEffBGRAYSprivateVO")]
        public List<HeaderEffBGRAYSprivateVO> HeaderEffBGRAYSprivateVO { get; set; }
    }

    public class HeaderEffBGRAYSprivateVO
    {
        [JsonProperty("ContextCode")]
        public string ContextCode { get; set; } = "GRAYS";

        [JsonProperty("holdreleasedby")]
        public string HoldReleasedBy { get; set; }
    }

    #endregion

    #region MRA Processing Models

    public class MRAProcessingResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public string IrnCode { get; set; }
        public string QrCodeBase64 { get; set; }
        public string OrderNumber { get; set; }
        public string HeaderId { get; set; }
        public MRAProcessingStep CurrentStep { get; set; }
        public string ErrorDetails { get; set; }
    }

    public enum MRAProcessingStep
    {
        Initial,
        CheckingMRAStatus,
        FetchingOrderSummary,
        FetchingOrderDetails,
        ValidatingOrderLines,
        CreatingMRAInvoice,
        UpdatingFusionOrder,
        Completed,
        Failed
    }

    public class MRACheckResult
    {
        public bool IsInterfaced { get; set; }
        public string Message { get; set; }
        public string MraOrderNumber { get; set; }
    }

    public class OrderValidationResult
    {
        public bool AllLinesClosed { get; set; }
        public string Message { get; set; }
        public List<string> OpenLines { get; set; }
    }

    #endregion
}
