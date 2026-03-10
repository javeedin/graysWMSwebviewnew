using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Text;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using DevExpress.XtraEditors;
using DevExpress.XtraSplashScreen;
using DevExpress.XtraPivotGrid;
using System.Collections;
using DevExpress.XtraGrid.Views.Grid;
using System.IO;
using Outlook = Microsoft.Office.Interop.Outlook;
using DevExpress.Utils;
using System.Data.SqlClient;
using System.Threading;
using DevExpress.XtraBars.Alerter;
using System.Runtime.InteropServices;
using RestSharp;
using DevExpress.XtraReports.UI;
using DevExpress.XtraPrinting.BarCode;
using DevExpress.Spreadsheet;
using DevExpress.XtraRichEdit.API.Native;
using DevExpress.XtraRichEdit.Utils;
using DevExpress.Office.Utils;
using TableStyle = DevExpress.XtraRichEdit.API.Native.TableStyle;
using Table = DevExpress.XtraRichEdit.API.Native.Table;
using DevExpress.XtraSpreadsheet;
using DevExpress.XtraEditors.Repository;
using DevExpress.XtraGrid.Columns;
using DevExpress.Spreadsheet.Export;

namespace jvdpossample.forms
{
    public partial class FrmDebtorscontrol : DevExpress.XtraBars.FluentDesignSystem.FluentDesignForm
    {

        DataTable DTCart = new DataTable();

        DataTable DTselectedcustomers;

            public IList<Thread> _threads;

            DataTable DTapplications = new DataTable();

            DataTable Threadtable = new DataTable();

            DataTable websrvicedates = new DataTable();

            string instance_name;//= "PROD";
            string user;
            string password;
            string businessunit;// = "300000003234003";
            string inventory_org_id;//= "300000003277749";
            string Bu_name;
            SqlConnection abscon;


            string ppcbbusinessunitText;
            string ppcbinstanceText;
            string pptextusernameText;
            string pptextpasswordText;
            string pptbgridfontText;
            string ppmode;


        [DllImport("User32.dll", CharSet = CharSet.Auto)]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("User32.dll")]
        private static extern IntPtr GetWindowDC(IntPtr hWnd);

        //protected override void WndProc(ref Message m)
        //{
        //    //base.WndProc(ref m);
        //    //const int WM_NCPAINT = 0x85;
        //    //if (m.Msg == WM_NCPAINT)
        //    //{
        //    //    IntPtr hdc = GetWindowDC(m.HWnd);
        //    //    if ((int)hdc != 0)
        //    //    {
        //    //        Graphics g = Graphics.FromHdc(hdc);
        //    //        g.FillRectangle(Brushes.DarkBlue, new Rectangle(0, 0, 4800, 23));
        //    //        g.Flush();
        //    //        ReleaseDC(m.HWnd, hdc);
        //    //    }
        //    //}


        //    const int RESIZE_HANDLE_SIZE = 10;

        //    switch (m.Msg)
        //    {
        //        case 0x0084/*NCHITTEST*/ :
        //            base.WndProc(ref m);

        //            if ((int)m.Result == 0x01/*HTCLIENT*/)
        //            {
        //                Point screenPoint = new Point(m.LParam.ToInt32());
        //                Point clientPoint = this.PointToClient(screenPoint);
        //                if (clientPoint.Y <= RESIZE_HANDLE_SIZE)
        //                {
        //                    if (clientPoint.X <= RESIZE_HANDLE_SIZE)
        //                        m.Result = (IntPtr)13/*HTTOPLEFT*/ ;
        //                    else if (clientPoint.X < (Size.Width - RESIZE_HANDLE_SIZE))
        //                        m.Result = (IntPtr)12/*HTTOP*/ ;
        //                    else
        //                        m.Result = (IntPtr)14/*HTTOPRIGHT*/ ;
        //                }
        //                else if (clientPoint.Y <= (Size.Height - RESIZE_HANDLE_SIZE))
        //                {
        //                    if (clientPoint.X <= RESIZE_HANDLE_SIZE)
        //                        m.Result = (IntPtr)10/*HTLEFT*/ ;
        //                    else if (clientPoint.X < (Size.Width - RESIZE_HANDLE_SIZE))
        //                        m.Result = (IntPtr)2/*HTCAPTION*/ ;
        //                    else
        //                        m.Result = (IntPtr)11/*HTRIGHT*/ ;
        //                }
        //                else
        //                {
        //                    if (clientPoint.X <= RESIZE_HANDLE_SIZE)
        //                        m.Result = (IntPtr)16/*HTBOTTOMLEFT*/ ;
        //                    else if (clientPoint.X < (Size.Width - RESIZE_HANDLE_SIZE))
        //                        m.Result = (IntPtr)15/*HTBOTTOM*/ ;
        //                    else
        //                        m.Result = (IntPtr)17/*HTBOTTOMRIGHT*/ ;
        //                }
        //            }
        //            return;
        //    }
        //    base.WndProc(ref m);


        //}

//        [DllImport("Gdi32.dll", EntryPoint = "CreateRoundRectRgn")]
   //     private static extern IntPtr CreateRoundRectRgn
   //(
   //    int nLeftRect,     // x-coordinate of upper-left corner
   //    int nTopRect,      // y-coordinate of upper-left corner
   //    int nRightRect,    // x-coordinate of lower-right corner
   //    int nBottomRect,   // y-coordinate of lower-right corner
   //    int nWidthEllipse, // height of ellipse
   //    int nHeightEllipse // width of ellipse
   //);

        public FrmDebtorscontrol()
        {
            InitializeComponent();

            //this.FormBorderStyle = FormBorderStyle.None;
            tabPane1.Visible = true;
            //Region = System.Drawing.Region.FromHrgn(CreateRoundRectRgn(0, 0, this.Width, this.Height, 20, 20));
            ppmode = Properties.Settings.Default.mode; ;

            ppcbbusinessunitText = Properties.Settings.Default.businessunitname; ;
            ppcbinstanceText = Properties.Settings.Default.instancename; ;
            pptextusernameText = Properties.Settings.Default.username; ;
            pptextpasswordText = Properties.Settings.Default.password; ;
            pptbgridfontText = Properties.Settings.Default.gridfont; ;

            instance_name = Properties.Settings.Default.instancename;
            password = Properties.Settings.Default.password;
            user = Properties.Settings.Default.username;
            businessunit = Properties.Settings.Default.businessunitid; ; ;
            Bu_name = Properties.Settings.Default.businessunitname; ; ;
            //  textBoxbuname.Text = pbuname;
            inventory_org_id = Properties.Settings.Default.inventoryorgid;

            DTselectedcustomers = new DataTable();

            DataColumn dc;
            dc = new DataColumn("CUSTOMER_NUMBER", typeof(string));  //0
            dc = new DataColumn("CUSTOMER_NAME", typeof(string));  //0
            dc = new DataColumn("CUSTOMER_ACCOUNT_ID", typeof(string));  //0
            DTselectedcustomers.Columns.Add(dc);


            initialize();


        }


        public FrmDebtorscontrol(string puser, string ppassword, string pbu, string pinstance, string pinventoryorg, string pbuname)
        {
            InitializeComponent();

            instance_name = pinstance;
            password = ppassword;
            user = puser;
            businessunit = pbu;
            Bu_name = pbuname;
            //  textBoxbuname.Text = pbuname;
            inventory_org_id = pinventoryorg;

            initialize();
        }

        public void initialize()
        {

            DevExpress.Data.CurrencyDataController.DisableThreadingProblemsDetection = true;

            //try
            //{
            //    docin();
            //}
            //catch(Exception e9)
            //{

            //}

            submitbackgroundprocess("QUERYRECEIPTMETHODS");
            Threadtable = new DataTable();
            Threadtable.TableName = "Theadtable";
            Threadtable.Columns.Add("Threadname", typeof(string));
            Threadtable.Columns.Add("status", typeof(string));
            Threadtable.Columns.Add("startdate", typeof(string));
            Threadtable.Columns.Add("enddate", typeof(string));
            Threadtable.Columns.Add("notify", typeof(string));

            // datatable1 = new DataTable();
            websrvicedates.TableName = "GridTempTable";
            websrvicedates.Columns.Add("Date", typeof(string));
            websrvicedates.Columns.Add("reportname", typeof(string));
            websrvicedates.Columns.Add("status", typeof(string));
            websrvicedates.Columns.Add("COUNT", typeof(string));

            _threads = new List<Thread>();





            if (businessunit == "300000004907002")
            {
                abscon = new SqlConnection("Data Source=GRABS;Initial Catalog=SWORLD;User ID=query;Password=query");
                // cbbusinessunit.Enabled = false;
            }
            else
            {
                abscon = new SqlConnection("Data Source=GRABS;Initial Catalog=GRAYS;User ID=query;Password=query");
                //cbbusinessunit.Enabled = true;
            }

            DTCart = new DataTable();
            DTapplications = new DataTable();
            DataColumn dc;
            DataColumn dc1;

            DTselectedcustomers = new DataTable();

            DataColumn dcc;
            dcc = new DataColumn("CUSTOMER_NUMBER", typeof(string));  //0
            DTselectedcustomers.Columns.Add(dcc);

            dcc = new DataColumn("CUSTOMER_NAME", typeof(string));  //0
            DTselectedcustomers.Columns.Add(dcc);

            dcc = new DataColumn("CUSTOMER_ACCOUNT_ID", typeof(string));  //0
            DTselectedcustomers.Columns.Add(dcc);


            //  DTCart.Columns.Add(dc, typeof(string));
            //dc = new DataColumn("BatchNumber", typeof(string));
            //DTCart.Columns.Add(dc);
            //dc = new DataColumn("Referenceid", typeof(string));
            //DTCart.Columns.Add(dc);


            dc = new DataColumn("LINENO", typeof(string));
            DTCart.Columns.Add(dc);

            dc = new DataColumn("RST", typeof(string));
            DTCart.Columns.Add(dc);

            dc = new DataColumn("TRX_NUMBER", typeof(string));
            DTCart.Columns.Add(dc);

            dc = new DataColumn("SALES_ORDER", typeof(string));
            DTCart.Columns.Add(dc);

            dc = new DataColumn("SALESREP_NAME", typeof(string));
            DTCart.Columns.Add(dc);

            dc = new DataColumn("SALESREP_NUMBER", typeof(string));
            DTCart.Columns.Add(dc);


            dc = new DataColumn("ORDER_TYPE", typeof(string));
            DTCart.Columns.Add(dc);

            dc = new DataColumn("TRX_DATE", typeof(DateTime));
            DTCart.Columns.Add(dc);

            dc = new DataColumn("AMT_ORIGINAL", typeof(double));
            DTCart.Columns.Add(dc);

            dc = new DataColumn("AMT_REMAINING", typeof(double));
            DTCart.Columns.Add(dc);


            dc = new DataColumn("AMT_APPLIED", typeof(double));
            DTCart.Columns.Add(dc);

            dc = new DataColumn("CUSTOMER_TRX_ID", typeof(string));
            DTCart.Columns.Add(dc);

            //

            dc1 = new DataColumn("LINENO", typeof(string));
            DTapplications.Columns.Add(dc1);

            dc1 = new DataColumn("RST", typeof(string));
            DTapplications.Columns.Add(dc1);


            dc1 = new DataColumn("TRX_NUMBER", typeof(string));
            DTapplications.Columns.Add(dc1);

            dc1 = new DataColumn("SALES_ORDER", typeof(string));
            DTapplications.Columns.Add(dc1);

            dc1 = new DataColumn("SALESREP_NAME", typeof(string));
            DTapplications.Columns.Add(dc1);

            dc1 = new DataColumn("SALESREP_NUMBER", typeof(string));
            DTapplications.Columns.Add(dc1);


            dc1 = new DataColumn("ORDER_TYPE", typeof(string));
            DTapplications.Columns.Add(dc1);

            dc1 = new DataColumn("TRX_DATE", typeof(DateTime));
            DTapplications.Columns.Add(dc1);

            dc1 = new DataColumn("AMT_ORIGINAL", typeof(double));
            DTapplications.Columns.Add(dc1);

            dc1 = new DataColumn("AMT_REMAINING", typeof(double));
            DTapplications.Columns.Add(dc1);

            dc1 = new DataColumn("AMT_APPLIED", typeof(double));
            DTapplications.Columns.Add(dc1);

            dc1 = new DataColumn("CUSTOMER_TRX_ID", typeof(string));
            DTapplications.Columns.Add(dc1);




        }

        private void barButtonItem5_ItemClick(object sender, DevExpress.XtraBars.ItemClickEventArgs e)
        {
            tabPane1.SelectedPageIndex = 0;
            tabPane3.SelectedPageIndex = 1;
            flyoutPanel4.ShowPopup();
            //try
            //{
            //    getomarrecon();
            //}
            //catch
            //{

            //}
        }


        public void pivotforomar(DataSet ds1, PivotGridControl pvtview)
        {
            PivotGridField field;


            // gridControl2.DataBind();
            //     GridView pivotGridControl3 = new GridView(gridControl1);
            // PivotGridControl pivotGridControl3 = new PivotGridControl(DevExpress.XtraGrid.GridControl);
            //gridControl2.MainView = gridView2;

            DataTable pvt = new DataTable("mytable");

            pvt.Columns.Add(new DataColumn("ORDER_MONTH", typeof(string)));
            pvt.Columns.Add(new DataColumn("ORDER_TYPE_CODE", typeof(string)));
            pvt.Columns.Add(new DataColumn("SALES_ORDER", typeof(string)));
            //   pvt.Columns.Add(new DataColumn("FROM_AR", typeof(string)));
            // pvt.Columns.Add(new DataColumn("FROM_OM", typeof(string)));

            pvt.Columns.Add(new DataColumn("FROM_AR", typeof(double)));
            pvt.Columns.Add(new DataColumn("FROM_OM", typeof(double)));


            pvt.Columns.Add(new DataColumn("DIFF", typeof(double)));
            pvt.Columns.Add(new DataColumn("TRX_DATE", typeof(string)));
            pvt.Columns.Add(new DataColumn("TRX_MONTH", typeof(string)));
            pvt.Columns.Add(new DataColumn("CUSTOMER", typeof(string)));
            pvt.Columns.Add(new DataColumn("SALESREP", typeof(string)));





            try
            {

                foreach (DataRow dr in ds1.Tables[1].Rows)
                {

                    DataRow dr1 = pvt.NewRow();
                    //      dr1["TYPE"] = dr["TYPE"].ToString();
                    dr1["ORDER_MONTH"] = dr["ORDER_MONTH"].ToString();
                    dr1["ORDER_TYPE_CODE"] = dr["ORDER_TYPE_CODE"].ToString();
                    dr1["SALES_ORDER"] = dr["SALES_ORDER"].ToString();
                    dr1["FROM_AR"] = Convert.ToDouble(dr["FROM_AR"].ToString());
                    dr1["FROM_OM"] = Convert.ToDouble(dr["FROM_OM"].ToString());

                    dr1["DIFF"] = Convert.ToDouble(dr["DIFF"].ToString());
                    dr1["TRX_DATE"] = dr["TRX_DATE"].ToString();
                    dr1["TRX_MONTH"] = dr["TRX_MONTH"].ToString();
                    dr1["CUSTOMER"] = dr["CUSTOMER"].ToString();
                    dr1["SALESREP"] = dr["SALESREP"].ToString();



                    pvt.Rows.Add(dr1);

                }
            }
            catch (Exception e6)
            {
            }

            //    pivotGridControl3.Dispose();
            //  pivotGridControl3.CreateControl();

            pvtview.DataSource = pvt;

            //  string filed = pivotGridControl3.Fields(1);

            var pivotgridfields = pvtview.Fields;

            //  List<string> visibleFields = new List<string>() { "PRODNAME", "Reqquantity", "PRODUCTID","LOCATION"};



            try
            {
                PivotGridField field1 = pvtview.Fields["ORDER_MONTH"];
                PivotGridField field2 = pvtview.Fields["ORDER_TYPE_CODE"];
                PivotGridField field3 = pvtview.Fields["SALES_ORDER"];
                PivotGridField field4 = pvtview.Fields["FROM_AR"];
                PivotGridField field5 = pvtview.Fields["FROM_OM"];
                PivotGridField field6 = pvtview.Fields["DIFF"];
                PivotGridField field7 = pvtview.Fields["TRX_DATE"];
                PivotGridField field8 = pvtview.Fields["TRX_MONTH"];
                PivotGridField field9 = pvtview.Fields["CUSTOMER"];
                PivotGridField field10 = pvtview.Fields["SALESREP"];




                try
                {
                    pvtview.Fields.Remove(field1);
                }
                catch (Exception e6)
                { }

                try
                {

                    pvtview.Fields.Remove(field2);
                }
                catch (Exception e6)
                { }

                try
                {

                    pvtview.Fields.Remove(field3);
                }
                catch (Exception e6)
                { }

                try
                {

                    pvtview.Fields.Remove(field4);
                }
                catch (Exception e6)
                { }

                try
                {

                    pvtview.Fields.Remove(field5);
                }
                catch (Exception e6)
                { }

                try
                {

                    pvtview.Fields.Remove(field6);
                }
                catch (Exception e6)
                { }

                try
                {

                    pvtview.Fields.Remove(field7);
                }
                catch (Exception e6)
                { }

                try
                {

                    pvtview.Fields.Remove(field8);
                }
                catch (Exception e6)
                { }


                try
                {

                    pvtview.Fields.Remove(field9);
                }
                catch (Exception e6)
                { }


                try
                {

                    pvtview.Fields.Remove(field10);
                }
                catch (Exception e6)
                { }

            }
            catch (Exception e2)
            { }

            //  PivotGridField LINE_AMOUNT = new PivotGridField() { Caption = "LINE_AMOUNT", Area = PivotArea.DataArea };
            PivotGridField FROM_AR = new PivotGridField("FROM_AR", DevExpress.XtraPivotGrid.PivotArea.DataArea);
            /// FROM_AR.UnboundFieldName = "FROM_AR";
            //   FROM_AR.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;

            PivotGridField FROM_OM = new PivotGridField("FROM_OM", DevExpress.XtraPivotGrid.PivotArea.DataArea);
            //    FROM_OM.UnboundFieldName = "FROM_OM";
            // FROM_OM.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;

            PivotGridField DIFF = new PivotGridField("DIFF", DevExpress.XtraPivotGrid.PivotArea.DataArea);
            // DIFF.UnboundFieldName = "DIFF";
            //DIFF.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;

            PivotGridField ORDER_MONTH = new PivotGridField("ORDER_MONTH", DevExpress.XtraPivotGrid.PivotArea.RowArea);
            ORDER_MONTH.Caption = "ORDER_MONTH";

            PivotGridField ORDER_TYPE_CODE = new PivotGridField("ORDER_TYPE_CODE", DevExpress.XtraPivotGrid.PivotArea.RowArea);
            ORDER_TYPE_CODE.Caption = "ORDER_TYPE_CODE";

            PivotGridField SALES_ORDER = new PivotGridField("SALES_ORDER", DevExpress.XtraPivotGrid.PivotArea.RowArea);
            SALES_ORDER.Caption = "SALES_ORDER";

            PivotGridField TRX_DATE = new PivotGridField("TRX_DATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            TRX_DATE.Caption = "TRX_DATE";

            PivotGridField TRX_MONTH = new PivotGridField("TRX_MONTH", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            TRX_DATE.Caption = "TRX_MONTH";

            PivotGridField CUSTOMER = new PivotGridField("CUSTOMER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            TRX_DATE.Caption = "CUSTOMER";

            PivotGridField SALESREP = new PivotGridField("SALESREP", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            TRX_DATE.Caption = "SALESREP";


            try
            {

                pvtview.Fields.Remove(ORDER_MONTH);
                pvtview.Fields.Remove(ORDER_TYPE_CODE);
                pvtview.Fields.Remove(SALES_ORDER);
                pvtview.Fields.Remove(FROM_AR);
                pvtview.Fields.Remove(FROM_AR);


                pvtview.Fields.Remove(DIFF);
                pvtview.Fields.Remove(TRX_DATE);
                pvtview.Fields.Remove(TRX_MONTH);
                pvtview.Fields.Remove(CUSTOMER);
                pvtview.Fields.Remove(SALESREP);



            }
            catch (Exception e4)
            {

            }

            // Add fields to the PivotGridControl 
            //pivotGridControl3.Fields.AddRange(new PivotGridField[] { USERID, PRODNAME, Reqquantity });
            pvtview.Fields.AddRange(new PivotGridField[] {ORDER_MONTH,ORDER_TYPE_CODE,SALES_ORDER,FROM_AR,FROM_OM,
            DIFF ,TRX_DATE,TRX_MONTH,CUSTOMER,SALESREP});



            pvtview.Appearance.RowHeaderArea.Font = new Font("Tahoma", 10f);
            pvtview.Appearance.ColumnHeaderArea.Font = new Font("Tahoma", 10f);
            pvtview.Appearance.Cell.Font = new Font("Tahoma", 10f);
            //  pivotGridControl3.Appearance.Row.Font = new Font("Tahoma", 10f);


            FROM_AR.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            FROM_AR.CellFormat.FormatString = "n2";

            FROM_OM.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            FROM_OM.CellFormat.FormatString = "n2";

            DIFF.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            DIFF.CellFormat.FormatString = "n2";

        }


        DataSet DSreceipts = new DataSet();
        DataSet DSreceiptapplications = new DataSet();


        public void getreceiptdetails(string receiptnumber)
        {
            helperclass helper = null;
            helper = new helperclass();

            FusionRunReport report = null;

            report = new FusionRunReport();

            GraysProdReporting Preport = null;
            Preport = new GraysProdReporting();
            businessunit = Properties.Settings.Default.businessunitid;

            // GETTING RECEIPTS FROM FUSION 
            //  if (dateEdit2.EditValue != null && dateEdit1.EditValue != null)
            {
                DateTime fromdate;
                DateTime todate;
                string fromdate1 = "";
                string todate1 = "";

                try
                {

                    fromdate = Convert.ToDateTime(dateEdit2.EditValue.ToString());
                    todate = Convert.ToDateTime(dateEdit1.EditValue.ToString());
                    fromdate1 = fromdate.ToString("yyyy-MM-dd");
                    todate1 = todate.ToString("yyyy-MM-dd");
                }
                catch
                {

                }

                string status = null;

                report = new FusionRunReport();
                DSreceipts = new DataSet();
                DSreceiptapplications = new DataSet();
                if (instance_name == "TEST")
                {


                    if (businessunit == "300000004907002")
                    {

                        if (receiptnumber != "NORECIEPT")
                        {

                            DSreceiptapplications = report.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECIEPT_APPLICATION_SINGLE_BIP.xdo",
                             "shaik", "fusion1234", fromdate1, todate1, businessunit, receiptnumber, textBoxcustomername.Text, "", "",
                             "FROM_DATE", "TO_DATE", "ORG_ID", "CASH_RECEIPT_ID", "CUSTOMER_NAME", "", "");


                        }
                        else
                        {

                            //                 DSreceipts = report.runreport_parameter("/Custom/DEXPRESS/Receivables/SUGARWORLD/SW_AR_RECEIPTS_BIP.xdo", "shaik", "fusion1234", fromdate1, todate1, "FROM_DATE", "TO_DATE");


                            DSreceipts = report.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECEIPTS_BIP_NEW.xdo",
                                       "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbcustomernumber2.Text, "",
                                       "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "ACCOUNT_NUMBER", "");


                            DSreceiptapplications = report.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECEIPT_APPLICATIONS_BIP.xdo",
                              "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbcustomernumber2.Text, "",
                              "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "ACCOUNT_NUMBER", "");

                        }



                    }
                    else
                    {

                        if (receiptnumber != "NORECIEPT")  //NORECIEPT
                        {

                            DSreceiptapplications = report.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECIEPT_APPLICATION_SINGLE_BIP.xdo",
                              "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, receiptnumber, "", "",
                              "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "CASH_RECEIPT_ID", "", "");

                            try
                            {
                                addapplicationtodt(DSreceiptapplications);
                            }
                            catch
                            {

                            }

                        }
                        else
                        {

                            DSreceipts = report.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECEIPTS_BIP_NEW.xdo",
                                "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbcustomernumber2.Text, "",
                                "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "ACCOUNT_NUMBER", "");

                            DSreceiptapplications = report.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECEIPT_APPLICATIONS_BIP.xdo",
                              "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbcustomernumber2.Text, "",
                              "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "ACCOUNT_NUMBER", "");
                        }
                    }


                }
                else if (instance_name == "PROD")
                {

                    if (businessunit == "300000004907002")
                    {

                        if (receiptnumber != "NORECIEPT")
                        {

                            DSreceiptapplications = Preport.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECIEPT_APPLICATION_SINGLE_BIP.xdo",
                             "shaik", "fusion1234", fromdate1, todate1, businessunit, receiptnumber, textBoxcustomername.Text, "", "",
                             "FROM_DATE", "TO_DATE", "ORG_ID", "CASH_RECEIPT_ID", "CUSTOMER_NAME", "", "");


                        }
                        else
                        {

                            //                 DSreceipts = report.runreport_parameter("/Custom/DEXPRESS/Receivables/SUGARWORLD/SW_AR_RECEIPTS_BIP.xdo", "shaik", "fusion1234", fromdate1, todate1, "FROM_DATE", "TO_DATE");


                            DSreceipts = Preport.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECEIPTS_BIP_NEW.xdo",
                                       "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbcustomernumber2.Text, "",
                                       "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "ACCOUNT_NUMBER", "");


                            DSreceiptapplications = Preport.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECEIPT_APPLICATIONS_BIP.xdo",
                              "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbcustomernumber2.Text, "",
                              "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "", "");

                        }

                        //  DSreceipts = prodreport.runreport_parameter("/Custom/DEXPRESS/Receivables/SUGARWORLD/SW_MICROS_RECEIPTS_BIP.xdo", "shaik", "fusion1234", fromdate1, todate1, "FROM_DATE", "TO_DATE");

                        //  DSreceipts = report.runreport_parameter("/Custom/DEXPRESS/Receivables/SUGARWORLD/SW_AR_RECEIPTS_BIP.xdo", "shaik", "fusion1234", fromdate1, todate1, "FROM_DATE", "TO_DATE");

                        //      DSreceipts = Preport.runreport_parameter("/Custom/DEXPRESS/Receivables/SUGARWORLD/SW_AR_RECEIPTS_BIP.xdo", "shaik", "fusion1234", fromdate1, todate1, "FROM_DATE", "TO_DATE");

                        //       DSreceiptapplications = Preport.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECIEPT_APPLICATION_SINGLE_BIP.xdo",
                        //                                "shaik", "fusion1234", "", "", businessunit, "", receiptnumber, "", "",
                        //                              "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "RECEIPT_NUMBER", "", "");




                    }
                    else
                    {


                        if (receiptnumber != "NORECIEPT")
                        {

                            DSreceiptapplications = Preport.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECIEPT_APPLICATION_SINGLE_BIP.xdo",
                              "shaik", "fusion1234", "", "", businessunit, "", receiptnumber, "", "",
                              "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "CASH_RECEIPT_ID", "", "");

                        }
                        else
                        {

                            DSreceipts = Preport.runreport_parameter_new_10("/Custom/DEXPRESS/Receivables/AR_RECEIPTS_BIP_NEW.xdo",
                            "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbcustomernumber2.Text, tbreceiptstatus.Text, tbfromamount.Text, tbtoamount.Text, "",
                            "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "ACCOUNT_NUMBER", "STATUS", "FROM_AMOUNT", "TO_AMOUNT", "");

                            DSreceiptapplications = Preport.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_RECEIPT_APPLICATIONS_BIP.xdo",
                              "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbcustomernumber2.Text, tbreceiptstatus.Text,
                              "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "ACCOUNT_NUMBER", "STATUS");

                        }

                    }
                }

                if (receiptnumber != "NORECIEPT") //NORECIEPT
                {

                    try
                    {
                        DataTable DTreceiptsapp = DSreceiptapplications.Tables[1];


                        //   INVENTORY_ON_HAND_FOR_SALESREPS_SHOPS_BIP

                        helper.setgridproperties_new(DSreceiptapplications, gridView15, gridControl14, "Analysis", helper.getnumbercharcols(DTreceiptsapp, "N"), "nopaint", helper.getnumbercharcols(DTreceiptsapp, "C"), spreadsheetControl1);
                        //   helper.setgridproperties_new(DSreceipts, gridView9, gridControl9, "Analysis", helper.getnumbercharcols(DTreceipts, "N"), "nopaint", helper.getnumbercharcols(DTreceipts, "C"), spreadsheetControl1);
                    }
                    catch
                    {

                    }

                }
                else
                {


                }

            }

            if (marqueeProgressBarControl1.InvokeRequired)
            {
                marqueeProgressBarControl1.Invoke((MethodInvoker)delegate ()
                {

                    marqueeProgressBarControl1.Visible = false;

                });
            }

            

        }

        DataSet DSomar;

        public void getomarrecon()
        {
            var result = XtraMessageBox.Show("Do you Want to Refresh the Data ?, This will take several minutes !", "Confirmation", MessageBoxButtons.YesNo);

            // IF 1
            if (result.ToString() == "Yes")
            {
                try
                {
                    SplashScreenManager.ShowForm(typeof(WaitForm1));
                }
                catch (Exception e5)
                {

                }
                helperclass helper = null;
                helper = new helperclass();

                FusionRunReport report = null;

                report = new FusionRunReport();

                GraysProdReporting Preport = null;
                Preport = new GraysProdReporting();

                DataSet DSpivot = null;
                DSomar = new DataSet();
                //SALES_BY_MONTH_ALL_DM



                //      gridControl13.DataSource = null;
                //    gridView12.RefreshData();

                // DSpricelist = report.runreport("/Custom/DEXPRESS/ORDER MANAGEMENT/GRAYS_PRICET_LIST_NEW_BIP.xdo", "shaik", "fusion1234");

                try
                {
                    DataSet DStotaldebtors = null;


                    if (instance_name == "TEST")
                    {
                        //     DStotaldebtors = Preport.runreport_parameter("/Custom/DEXPRESS/AR_OM_RECON_BIP/AR_OM_RECON_BIP.xdo", "shaik", "fusion1234",
                        //                businessunit, "", "ORG_ID", "");

                        DSomar = report.runreport_parameter("/Custom/DEXPRESS/DEBTORS_CONTROL/AR_OM_RECON_PIVOT_BIP_V2.xdo", "shaik", "fusion1234",
                            businessunit, tbordermonth.Text, "ORG_ID", "ORDER_MONTH");

                    }
                    else if (instance_name == "PROD")
                    {


                        //         DStotaldebtors = Preport.runreport_parameter("/Custom/DEXPRESS/DEBTORS_CONTROL/AR_OM_RECON_BIP.xdo", "shaik", "fusion1234",
                        //               businessunit, "", "ORG_ID", "");

                        DSomar = Preport.runreport_parameter("/Custom/DEXPRESS/DEBTORS_CONTROL/AR_OM_RECON_PIVOT_BIP_V2.xdo", "shaik", "fusion1234",
                             businessunit, tbordermonth.Text, "ORG_ID", "ORDER_MONTH");


                    }




                    pivotforomar(DSomar, pivotGridControl1);

                    //   INVENTORY_ON_HAND_FOR_SALESREPS_SHOPS_BIP

                    try
                    {
                        //DataTable DTdebtors = DStotaldebtors.Tables[1];

                        //helper.setgridproperties_new(DStotaldebtors, gridView1, gridControl1, "Analysis", helper.getnumbercharcols(DTdebtors, "N"), "nopaint", helper.getnumbercharcols(DTdebtors, "C"), spreadsheetControl1);

                        //                   gridControl1.DataSource = null;
                        //                  gridView1.RefreshData();
                        //                gridView1.Columns.Clear();
                        //              gridControl1.DataSource = DStotaldebtors.Tables[1];
                        gridView1.OptionsBehavior.ReadOnly = true;
                        //gridView1.OptionsSelection.MultiSelect = false;
                        gridView1.OptionsView.ShowFooter = true;
                        gridView1.OptionsView.ShowAutoFilterRow = false;
                        gridView1.OptionsView.ShowIndicator = false;
                        gridView1.OptionsView.ColumnAutoWidth = true;
                        gridView1.Appearance.Row.Font = new Font("Tahoma", 12f);
                        gridView1.HorzScrollVisibility = DevExpress.XtraGrid.Views.Base.ScrollVisibility.Always;
                        gridView1.OptionsView.ColumnAutoWidth = false;
                        gridView1.OptionsView.BestFitMaxRowCount = -1;
                        gridView1.BestFitColumns();
                    }
                    catch (Exception e5)
                    {

                    }


                }
                catch (Exception e5)
                {

                }

            }

            try
            {
                SplashScreenManager.CloseForm();
            }
            catch (Exception e5)
            {

            }


        }

        private void simpleButton2_Click(object sender, EventArgs e)
        {
            try
            {
                SplashScreenManager.ShowForm(typeof(WaitForm1));
            }
            catch (Exception e5)
            {

            }


            DataRow row = websrvicedates.NewRow();
            row["Date"] = DateTime.Now.ToString();
            row["reportname"] = "Query Receipts";
            row["status"] = "initializing";

            websrvicedates.Rows.Add(row);

            gridControl2.DataSource = null;
            gridView2.RefreshData();

            gridControl10.DataSource = null;
            gridView10.RefreshData();

            marqueeProgressBarControl1.Visible = true;
            //   stkmovment();

            Thread thread = new Thread(() => getreceiptdetails("NORECIEPT"));
            thread.IsBackground = true;
            Thread.Sleep(1000);
            thread.Name = string.Format("Query Receipts");
            _threads.Add(thread);

            //Task<string> task = new Task<string>(stkmovment);
            //task.Start();
            //string x;
            //x = await task;


            //       Thread.Sleep(1000);
            //  thread.Name = string.Format("Fusion Client{0}", "Stock Movement");
            //  _threads.Add(thread);

            thread.Start();

            DataRow row1 = Threadtable.NewRow();
            row1["Threadname"] = thread.Name;
            row1["status"] = thread.ThreadState;
            row1["startdate"] = DateTime.Now.ToString();
            row1["enddate"] = "";
            row1["notify"] = "";

            Threadtable.Rows.Add(row1);


            timer1.Enabled = true;

            showalert("Request for Receipts details submitted", "info");


            // getreceiptdetails("NORECIEPT");
            try
            {
                SplashScreenManager.CloseForm();
                flyoutPanel3.HidePopup();
            }
            catch (Exception e5)
            {

            }
        }



        public void showalert(string caption, string Message)
        {
            Message msg = new Message();
            //    String Message = " items add";
            // alertControl1.Show(this, msg.Caption, msg.Text, "", msg.Image, msg);
            AlertInfo info = new AlertInfo(caption, Message);

            alertControl1.AppearanceCaption.Name = caption;
            alertControl1.LookAndFeel.SkinMaskColor = Color.Yellow;
            alertControl1.LookAndFeel.SkinMaskColor2 = Color.Yellow;
            alertControl1.Show(this, info);
        }


        private void barButtonItem1_ItemClick(object sender, DevExpress.XtraBars.ItemClickEventArgs e)
        {
            tabPane1.SelectedPageIndex = 1;
            tabPane3.SelectedPageIndex = 0;

            flyoutPanel3.OwnerControl = gridControl2;

            flyoutPanel3.ShowPopup();
        }

        private void simpleButton1_Click(object sender, EventArgs e)
        {
            flyoutPanel3.HidePopup();
        }

        private void barButtonItem4_ItemClick(object sender, DevExpress.XtraBars.ItemClickEventArgs e)
        {
            tabPane1.SelectedPageIndex = 3;
            var result = XtraMessageBox.Show("Do you Want to Refresh the Data ?, This will take several minutes !", "Confirmation", MessageBoxButtons.YesNo);

            // IF 1
            if (result.ToString() == "Yes")
            {


                getcustomers("", "QUERY", "BALANCES");
            }

        }

        GraysProdReporting prodreport = new GraysProdReporting();

        DataSet DScustomerbalances;
        DataTable DTcustomerbalances;
        DataTable DTdistinctcustomers;

        public void getcustomers(string price_list, string mode, string where)
        {
            try
            {
                SplashScreenManager.ShowForm(typeof(WaitForm2));
            }
            catch (Exception e6)
            { }


            helperclass helper = null;
            helper = new helperclass();

            FusionRunReport report = null;
            report = new FusionRunReport();


            string fromdate1 = "";
            try
            {
                DateTime fromdate = Convert.ToDateTime(dateEdit4.EditValue.ToString());

                fromdate1 = fromdate.ToString("MM-dd-yyyy");
            }
            catch
            {

            }

            //if (!cbbusinessunit.Text.Contains("GRAYS INC BU"))
            //{
            //    price_list = null;
            //}

            DScustomerbalances = new DataSet();

            if (instance_name == "TEST")
            {

                DScustomerbalances = report.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_CUSTOMER_BAL_SUMMARY_BIP.xdo", "shaik", "fusion1234",
                  Bu_name, "", "", "", "", "", "",
                 "BU_NAME", "", "", "", "", "", "");
                /// DSdoofficer = prodreport.runreport("/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/DOO_OFFICER_BIP.xdo", "shaik", "fusion1234");

            }
            else if (instance_name == "PROD")
            {

                if (where == "BALANCES")
                {
                    if (businessunit == "300000004907002")
                    {
                        DScustomerbalances = prodreport.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_CUSTOMER_BAL_SUMMARY_BIP.xdo", "shaik", "fusion1234",
                      Bu_name, "", "", "", "", "", "",
                    "BU_NAME", "", "", "", "", "", "");
                    }
                    else
                    {

                        DScustomerbalances = prodreport.runreport_parameter_new("/Custom/DEXPRESS/Receivables/AR_CUSTOMER_BAL_SUMMARY_BIP.xdo", "shaik", "fusion1234",
                          Bu_name, "", "", "", "", "", "",
                        "BU_NAME", "", "", "", "", "", "");
                    }
                }

                else
                {

                    if (businessunit == "300000004907002")
                    {
                        try
                        {
                            //            DScustomers = prodreport.runreport_parameter("Custom/OQ/Customer Stmt/SUGARWORLD/CUSTOMER_STATEMENT_SUMMARY_BIP.xdo", "shaik", "fusion1234",
                            //fromdate1, businessunit, "p_date_fr", "BUSINESS_UNIT_ID");

                            DScustomerbalances = prodreport.runreport_parameter("/Custom/OQ/Customer Stmt/SW_Customer_Statement_Summary_BIP.xdo", "shaik", "fusion1234",
              fromdate1, businessunit, "p_date_fr", "BUSINESS_UNIT_ID");
                        }
                        catch (Exception e9)
                        {

                        }
                    }
                    else
                    {

                        DScustomerbalances = prodreport.runreport_parameter("/Custom/OQ/Customer Stmt/CUSTOMER_STATEMENT_SUMMARY_BIP.xdo", "shaik", "fusion1234",
                      fromdate1, businessunit, "p_date_fr", "BUSINESS_UNIT_ID");
                    }
                }

                //   DScustomers = prodreport.runreport_parameter("/Custom/DEXPRESS/Receivables/CUSTOMER_MASTER_BIP_FOR_OM.xdo", "shaik", "fusion1234", price_list, "", "PRICE_LIST", "");

                //   DSdoofficer = prodreport.runreport("/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/DOO_OFFICER_BIP.xdo", "shaik", "fusion1234");

            }
            try
            {
                DTcustomerbalances = DScustomerbalances.Tables[1];

                //DataView view = new DataView(DTcustomerbalances);
                //DTdistinctcustomers = view.ToTable(true, "Column1", "Column2");

                if (mode == "QUERY")
                {
                    helper.setgridproperties_new(DScustomerbalances, gridView3, gridControl3, "Analysis", helper.getnumbercharcols(DTcustomerbalances, "N"), "nofreeze", helper.getnumbercharcols(DTcustomerbalances, "C"), spreadsheetControl1);
                    gridView3.OptionsSelection.MultiSelect = true;
                    gridView3.OptionsSelection.MultiSelectMode = DevExpress.XtraGrid.Views.Grid.GridMultiSelectMode.CellSelect;
                    gridView3.Appearance.Row.Font = new Font("Tahoma", 10f);
                    gridView3.OptionsView.ColumnAutoWidth = false;
                    gridView3.OptionsView.BestFitMaxRowCount = -1;
                    gridView3.BestFitColumns();

                }
                else if (mode == "STATEMENT")
                {
                    helper.setgridproperties_new(DScustomerbalances, gridView7, gridControl7, "Analysis", helper.getnumbercharcols(DTcustomerbalances, "N"), "nofreeze", helper.getnumbercharcols(DTcustomerbalances, "C"), spreadsheetControl1);

                    gridView7.OptionsSelection.MultiSelect = true;
                    gridView7.OptionsSelection.MultiSelectMode = DevExpress.XtraGrid.Views.Grid.GridMultiSelectMode.CellSelect;
                    gridView7.Appearance.Row.Font = new Font("Tahoma", 10f);
                    gridView7.OptionsView.ColumnAutoWidth = false;
                    gridView7.OptionsView.BestFitMaxRowCount = -1;
                    gridView7.BestFitColumns();
                }



            }
            catch (Exception e4)
            { }

            try
            {
                SplashScreenManager.CloseForm();
            }
            catch (Exception e8)
            {
            }

        }

        //private void options_CustomizeCell(CustomizePivotCellEventArgs e)
        //{

        //    if (e.ExportArea == PivotExportArea.Row && e.ValueItemInfo.Field != null
        //        && e.Value == null && e.ValueItemInfo.Value != null)
        //    {
        //        e.Value = e.ValueItemInfo.Field.GetValueText(e.ValueItemInfo.Value);
        //        e.Handled = true;

        //    }
        //}

        string rmode;

        public void accounthistory(string customernumber, string mode)
        {
            //  string customer_number = gridView11.GetRowCellValue(gridView11.FocusedRowHandle, "ACCOUNT_NUMBER").ToString();


            if (customernumber != null)
            {
                rmode = "SINGLE";
                //  flyoutPanel13.OwnerControl = tabPane2;
                // label57.Text = textcustomername.Text;

                getcustomerbalancedetails(Bu_name, customernumber, null, "SINGLE", "", "", "", mode, "",tbclass.Text);
                //   fusioncreditcheck(textcustomernumber.Text, "GRAYS INC BU");
                //   flyoutPanel13.OwnerControl = groupControl7;
                flyoutPanel12.Height = 700;
                flyoutPanel12.OwnerControl = panel1;
                flyoutPanel12.ShowPopup();



            }
        }

        DataSet DSbalance;

        public void getcustomerbalancedetails(string bu_name, string customer_number, string customername, string mode,
            string fromdate1, string todate1, string type, string bumode, string class1,string customer_class)
        {
            FusionRunReport report = null;
            report = new FusionRunReport();
            Fusion_Integration help = new Fusion_Integration();
            bu_name = Bu_name;
            helperclass helper = null;
            helper = new helperclass();

            DataSet DSbalancetemp;

            DateTime fromdate;
            DateTime todate;
            string fromdate11 = "";
            string todate11 = "";

            DateTime ordfromdate;
            DateTime ordtodate;
            string ordfromdate1 = "";
            string ordtodate1 = "";
            DateTime startdate;
            int i = 0;
            string loop = "Y";
           
            string enddate = "";
            //string customer_number = null;
            //try
            //{
            //    customer_number = gridView3.GetRowCellValue(gridView3.FocusedRowHandle, "ACCOUNT_NUMBER").ToString();
            //}
            //catch (Exception e8)
            //{
            //    showalert("Info", "Select the customer");
            //}

            // DataSet onhand = report.runreport("/Custom/DEXPRESS/STORETRANSACTIONS.xdo", "shaik", "fusion1234");

            Fusion_Integration fusion_Integration = new Fusion_Integration();


            try
            {
                DSbalance = new DataSet();
                if (instance_name == "TEST")
                {
                    if (bumode == "S")
                    {
                        DSbalance = report.runreport_parameter_new
                          ("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_BIP.xdo", "shaik", "fusion1234",
                          bu_name, customer_number, customername, fromdate1, todate1, type, "",
                          "BU_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "FROM_DATE", "TO_DATE", "TYPE", "");
                    }
                    else if (bumode == "RA")
                    {
                        DSbalance = report.runreport_parameter_new
                          ("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_INVOICES_BIP.xdo", "shaik", "fusion1234",
                          bu_name, customer_number, customername, fromdate1, todate1, type, class1,
                          "BU_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "FROM_DATE", "TO_DATE", "TYPE", "CLASS");
                    }
                    else
                    {
                        DSbalance = report.runreport_parameter_new
                      ("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_BIP_ALLG_BU.xdo", "shaik", "fusion1234",
                      bu_name, customer_number, customername, fromdate1, todate1, type, "",
                      "BU_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "FROM_DATE", "TO_DATE", "TYPE", "");
                    } //SW BU 300000004907002


                    //DSbalance = report.runreport_3_parameter
                    //  ("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_BIP.xdo", "shaik", "fusion1234",
                    //  bu_name, customer_number, "", "BU_NAME", "ACCOUNT_NUMBER", "CLASS");
                }
                else if (instance_name == "PROD")
                {
                    if (bumode == "S")
                    {
                        DSbalance = prodreport.runreport_parameter_new
                          ("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_BIP.xdo", "shaik", "fusion1234",
                          bu_name, customer_number, customername, fromdate1, todate1, type, tbclass.Text,
                          "BU_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "FROM_DATE", "TO_DATE", "TYPE", "CUSTOMER_CLASS_CODE");
                    }
                    else if (bumode == "RA")
                    {
                        //bu_name = "GRAYS INC BU"; // CHECK THIS LATER
                        DSbalance = prodreport.runreport_parameter_new
                          ("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_INVOICES_BIP.xdo", "shaik", "fusion1234",
                          bu_name, customer_number, customername, fromdate1, todate1, type, class1,
                          "BU_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "FROM_DATE", "TO_DATE", "TYPE", "CLASS");
                    }
                    else
                    {

                        string st = cbremainingst.CheckState.ToString();

                        DateTime date = adstartdate;
                        string startdate1 = adstartdate.ToString("yyyy-MM-dd");

                        startdate = adstartdate;

                        for (i = 0; i <= 40000; i++)
                        {
                             
                              //F-01 S=11
                            date = date.AddDays(Convert.ToDouble(5));

                            if (date.Date > adenddate.Date)
                            {
                                enddate = adenddate.ToString("yyyy-MM-dd");   //F-10  20
                                i = 40000;
                            }
                            else
                            {
                                enddate = date.ToString("yyyy-MM-dd");
                            }


                        DSbalancetemp = new DataSet();
                            if (st == "Unchecked")
                        {
                                //  DSbalancetemp = prodreport.runreport_parameter_new
                                //("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_BIP_ALLG_BU.xdo", "shaik", "fusion1234",
                                //bu_name, customer_number, customername, startdate1, enddate, type, tbordertypesearch.Text,
                                //"BU_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "FROM_DATE", "TO_DATE", "TYPE", "ORDER_TYPE");

                                DSbalancetemp = fusion_Integration.runfusionreport_new_10
                        ("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_BIP_ALLG_BU.xdo", "shaik", "fusion1234",
                        bu_name, customer_number, customername, startdate1, enddate, type, tbordertypesearch.Text, tbclass.Text, "","",
                        "BU_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "FROM_DATE", "TO_DATE", "TYPE", "ORDER_TYPE", "CUSTOMER_CLASS_CODE", "","",instance_name);

                        }
                        else
                        {
                                //DSbalancetemp = prodreport.runreport_parameter_new
                                //("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_BIP_ALLG_BU_REMAINING.xdo", "shaik", "fusion1234",
                                //bu_name, customer_number, customername, startdate1, enddate, type, tbordertypesearch.Text,
                                //"BU_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "FROM_DATE", "TO_DATE", "TYPE", "ORDER_TYPE");

                                DSbalancetemp = fusion_Integration.runfusionreport_new_10
                           ("/Custom/DEXPRESS/Receivables/AR_PAYMENT_SCHEDULES_BIP_ALLG_BU_REMAINING.xdo", "shaik", "fusion1234",
                           bu_name, customer_number, customername, startdate1, enddate, type, tbordertypesearch.Text, tbclass.Text, "","",
                           "BU_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "FROM_DATE", "TO_DATE", "TYPE", "ORDER_TYPE", "CUSTOMER_CLASS_CODE", "","",instance_name);
                            }



                            if (rbparams.InvokeRequired)
                            {
                                rbparams.Invoke((MethodInvoker)delegate ()
                                {

                                    try
                                    {

                                        //rbparams.Text = rbparams.Text + Environment.NewLine;
                                        rbparams.Text = rbparams.Text + "DETAILS " + startdate1 + "-" + enddate + "-" + "- RC=" + DSbalancetemp.Tables[1].Rows.Count + "-" + instance_name + "-" + Environment.NewLine;


                                    }
                                    catch (Exception e9)
                                    {
                                        rbparams.Text = rbparams.Text + "Count 0" + Environment.NewLine;
                                    }
                                });
                            }

                            try
                            {
                                DSbalance.Merge(DSbalancetemp.Tables[1]);
                            }
                            catch
                            {

                            }

                        startdate = date.AddDays(1);
                            startdate1 = startdate.ToString("yyyy-MM-dd");
                        }

                    } //SW BU 300000004907002

                }

                DataTable DTsumm = DSbalance.Tables[0];

                if (mode == "RA")
                {

                    helper.setgridproperties_new(DSbalance, gridView14, gridControl13, "Analysis", helper.getnumbercharcols(DTsumm, "N"), "nofreeze", helper.getnumbercharcols(DTsumm, "C"), spreadsheetControl1);
                }
                //   if (customer_number == "" || customer_number == null)
                else if (mode == "MULTIPLE")
                {
                    //helper.setgridproperties_new(DSbalance, gridView5, gridControl5, "", helper.getnumbercharcols(DTsumm, "N"), "nopaint", helper.getnumbercharcols(DTsumm, "C"), spreadsheetControl1);

                    //try
                    //{
                    //    pivotaccountdetails(DSbalance, pivotGridControl3);
                    //    pivotacctdetailsbymonth(pvt, pivotGridControl5);
                    //}
                    //catch (Exception e7)
                    //{
                    //    MessageBox.Show("Error in Pivot", "info");
                    //}



                }
                else if (mode == "SINGLE")
                {
                    helper.setgridproperties_new(DSbalance, gridView4, gridControl4, "Analysis", helper.getnumbercharcols(DTsumm, "N"), "nofreeze", helper.getnumbercharcols(DTsumm, "C"), spreadsheetControl1);

                    try
                    {
                        pivotaccountdetails(DSbalance, pivotGridControl4);
                    }
                    catch (Exception e7)
                    {
                        MessageBox.Show("Error in Pivot", "info");
                    }



                }



            }
            catch (Exception e5)
            {
                //showalert("info", "No Data found");
            }
            //   flyoutPanel13.HidePopup();
        }


        private void viewAccountDetailsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            accountdetails("S");
        }
        public void accountdetails(String MODE)
        {


            if (gridView3.RowCount > 0)
            {
                try
                {
                    string customer_number = gridView3.GetRowCellValue(gridView3.FocusedRowHandle, "ACCOUNT_NUMBER").ToString();
                    string CUSTOMER_NAME = gridView3.GetRowCellValue(gridView3.FocusedRowHandle, "ACCOUNT_NAME").ToString();
                    //accounthistory(customer_number, MODE);

                    string st = cbremainingst.CheckState.ToString();
                    string ordertype = tbordertypesearch.Text;

                    try
                    {
                        SplashScreenManager.ShowForm(typeof(WaitForm1));
                    }
                    catch (Exception e5)
                    {

                    }

                    FrmViewAccountDetailsOnly ad = new FrmViewAccountDetailsOnly(MODE,customer_number,Bu_name,st,ordertype, CUSTOMER_NAME);
                    ad.Show();

                    try
                    {
                        SplashScreenManager.CloseForm();
                    }
                    catch (Exception e5)
                    {

                    }

                }
                catch (Exception e7)
                {

                }
            }
            else
            {
                MessageBox.Show("Please Select the Customer", "Info");
            }
        }

        private void flyoutPanel12_ButtonClick(object sender, DevExpress.Utils.FlyoutPanelButtonClickEventArgs e)
        {
            flyoutPanel12.HidePopup();
        }

        private void barButtonItem3_ItemClick(object sender, DevExpress.XtraBars.ItemClickEventArgs e)
        {
            tabPane1.SelectedPageIndex = 2;
            tabPane4.SelectedPageIndex = 0;
            flyoutPanel23.ShowPopup();
        }
        public void getaccountdetails(String customernumber, string name, string mode)
        {
            if (mode == "RA")
            {
                tabPane3.SelectedPageIndex = 2;
            }
            else
            {
                tabPane1.SelectedPageIndex = 2;
            }
            //var result = XtraMessageBox.Show("Do you Want to Refresh the Data ?, This will take several minutes !", "Confirmation", MessageBoxButtons.YesNo);

            // IF 1
            //if (result.ToString() == "Yes")
            {

                try
                {
                    SplashScreenManager.ShowForm(typeof(WaitForm1));
                }
                catch (Exception e5)
                {

                }


                string fromdate1 = "";
                string todate1 = "";

                if (mode == "AD")
                {
                    try
                    {

                        DateTime fromdate = Convert.ToDateTime(dateEdit7.EditValue.ToString());
                        DateTime todate = Convert.ToDateTime(dateEdit6.EditValue.ToString());

                        fromdate1 = fromdate.ToString("yyyy-MM-dd");
                        todate1 = todate.ToString("yyyy-MM-dd");

                        getcustomerbalancedetails(Bu_name, customernumber, tbscustomer.Text, "MULTIPLE", fromdate1, todate1, tbtransactiontype.Text, "AD", "",tbclass.Text);

                    }
                    catch (Exception e6)
                    {

                    }

                }
                else if (mode == "RA")

                {

                    try
                    {

                        DateTime fromdate = Convert.ToDateTime(tbfromorderdate1.EditValue.ToString());
                        DateTime todate = Convert.ToDateTime(tbtoorderdate1.EditValue.ToString());

                        fromdate1 = fromdate.ToString("yyyy-MM-dd");
                        todate1 = todate.ToString("yyyy-MM-dd");

                        getcustomerbalancedetails(Bu_name, customernumber, "", "RA", fromdate1, todate1, "", "RA", "INV", tbclass.Text);

                    }
                    catch (Exception e6)
                    {

                    }

                }





                try
                {
                    SplashScreenManager.CloseForm();
                }
                catch (Exception e5)
                {

                }

            }

            if (marqueeProgressBarControl1.InvokeRequired)
            {
                marqueeProgressBarControl1.Invoke((MethodInvoker)delegate ()
                {

                    marqueeProgressBarControl1.Visible = false;

                });
            }

        }

        private void exportToExcelToolStripMenuItem_Click(object sender, EventArgs e)
        {
            DateTime dt = DateTime.Now;

            string time = dt.ToString("-HH-mm-ss");

            try
            {

                var pivotExportOptions = new DevExpress.XtraPivotGrid.PivotXlsxExportOptions();
                pivotExportOptions.ExportType = DevExpress.Export.ExportType.WYSIWYG;
                pivotGridControl1.ExportToXlsx("c:/fusion/aromrecon-" + time + ".xlsx", pivotExportOptions);

                // string FileName = "C:\\fusion\\invctlstkmovesummary-" + time + ".xls";
                //gridControl1.ExportToXls(FileName);
            }
            catch (Exception e6)
            {

            }

        }

        private void barButtonItem6_ItemClick(object sender, DevExpress.XtraBars.ItemClickEventArgs e)
        {
            tabPane1.SelectedPageIndex = 4;
            refreshbackorders();
        }


        public void refreshbackorders()
        {

            var result = XtraMessageBox.Show("Do you Want to Refresh the Data ?, This will take several minutes !", "Confirmation", MessageBoxButtons.YesNo);

            // IF 1
            if (result.ToString() == "Yes")
            {
                try
                {
                    SplashScreenManager.ShowForm(typeof(WaitForm1));
                }
                catch (Exception e5)
                {

                }

                getpendingorders();


                try
                {
                    SplashScreenManager.CloseForm();
                }
                catch (Exception e5)
                {

                }


            }



        }

        DataTable pvt;

        public void pivotaccountdetails(DataSet ds1, PivotGridControl pvtview)
        {
            PivotGridField field;
            pvt = new DataTable("mytable");

            pvt.Columns.Add(new DataColumn("ACCOUNT_NAME", typeof(string)));
            pvt.Columns.Add(new DataColumn("ACCOUNT_NUMBER", typeof(string)));
            pvt.Columns.Add(new DataColumn("TRX_NUMBER", typeof(string)));
            pvt.Columns.Add(new DataColumn("SALES_ORDER", typeof(string)));
            pvt.Columns.Add(new DataColumn("ORDER_TYPE", typeof(string)));
            pvt.Columns.Add(new DataColumn("TRX_DATE", typeof(string)));
            pvt.Columns.Add(new DataColumn("GL_DATE", typeof(string)));
            pvt.Columns.Add(new DataColumn("DUE_DATE", typeof(string)));
            pvt.Columns.Add(new DataColumn("DAYS_DUE", typeof(string)));
            pvt.Columns.Add(new DataColumn("CURRENCY", typeof(string)));
            pvt.Columns.Add(new DataColumn("STATUS", typeof(string)));
            pvt.Columns.Add(new DataColumn("CLASS", typeof(string)));
            pvt.Columns.Add(new DataColumn("BUSINES_UNIT", typeof(string)));
            pvt.Columns.Add(new DataColumn("CUSTOMER_CLASS_CODE", typeof(string)));
            pvt.Columns.Add(new DataColumn("TRX_TYPE", typeof(string)));
            pvt.Columns.Add(new DataColumn("AMT_ORIGINAL", typeof(double)));
            pvt.Columns.Add(new DataColumn("AMT_REMAINING", typeof(double)));
            pvt.Columns.Add(new DataColumn("ACCT_AMT_REMAINING", typeof(double)));
            pvt.Columns.Add(new DataColumn("AMOUNT_ON_ACCOUNT", typeof(double)));
            pvt.Columns.Add(new DataColumn("AMOUNT_APPLIED", typeof(double)));

            pvt.Columns.Add(new DataColumn("EXCHANGE_RATE", typeof(double)));
            pvt.Columns.Add(new DataColumn("TRX_MONTH", typeof(string)));
            pvt.Columns.Add(new DataColumn("GL_MONTH", typeof(string)));

            pvt.Columns.Add(new DataColumn("SALESREP_NAME", typeof(string)));
            pvt.Columns.Add(new DataColumn("SALESREP_NUMBER", typeof(string)));
            pvt.Columns.Add(new DataColumn("INV_COMMENTS", typeof(string)));
            pvt.Columns.Add(new DataColumn("REC_COMMENTS", typeof(string)));
            pvt.Columns.Add(new DataColumn("PAYMENT_TERMS", typeof(string)));
            pvt.Columns.Add(new DataColumn("CREDIT_LIMIT", typeof(string)));
            pvt.Columns.Add(new DataColumn("GL_YEAR", typeof(string)));
            pvt.Columns.Add(new DataColumn("SHIP_TO_CUSTOMER", typeof(string)));


            int c1 = ds1.Tables.Count;

            try
            {

                foreach (DataRow dr in ds1.Tables[c1-1].Rows)
                {

                    DataRow dr1 = pvt.NewRow();


                    dr1["ACCOUNT_NAME"] = dr["ACCOUNT_NAME"].ToString();
                    dr1["ACCOUNT_NUMBER"] = dr["ACCOUNT_NUMBER"].ToString();
                    dr1["TRX_NUMBER"] = dr["TRX_NUMBER"].ToString();
                    dr1["SALES_ORDER"] = dr["SALES_ORDER"].ToString();
                    dr1["ORDER_TYPE"] = dr["ORDER_TYPE"].ToString();
                    dr1["TRX_DATE"] = dr["TRX_DATE"].ToString();
                    dr1["GL_DATE"] = dr["GL_DATE"].ToString();
                    dr1["DUE_DATE"] = dr["DUE_DATE"].ToString();
                    dr1["DAYS_DUE"] = dr["DAYS_DUE"].ToString();
                    dr1["CURRENCY"] = dr["CURRENCY"].ToString();
                    dr1["STATUS"] = dr["STATUS"].ToString();
                    dr1["CLASS"] = dr["CLASS"].ToString();
                    dr1["BUSINES_UNIT"] = dr["BUSINES_UNIT"].ToString();
                    dr1["CUSTOMER_CLASS_CODE"] = dr["CUSTOMER_CLASS_CODE"].ToString();
                    dr1["TRX_TYPE"] = dr["TRX_TYPE"].ToString();
                    dr1["AMT_ORIGINAL"] = Convert.ToDouble(dr["AMT_ORIGINAL"].ToString());
                    dr1["AMT_REMAINING"] = Convert.ToDouble(dr["AMT_REMAINING"].ToString());

                    dr1["ACCT_AMT_REMAINING"] = Convert.ToDouble(dr["ACCT_REMAINING"].ToString());

                    dr1["AMOUNT_ON_ACCOUNT"] = Convert.ToDouble(dr["ON_ACCOUNT"].ToString());
                    dr1["AMOUNT_APPLIED"] = Convert.ToDouble(dr["APPLIED"].ToString());
                    dr1["EXCHANGE_RATE"] = 0;// Convert.ToDouble(dr["EXCHANGE_RATE"].ToString());
                    dr1["TRX_MONTH"] = dr["TRX_MONTH"].ToString();
                    dr1["GL_MONTH"] = dr["GL_MONTH"].ToString();
                    dr1["SALESREP_NAME"] = dr["SALESREP_NAME"].ToString();
                    dr1["SALESREP_NUMBER"] = dr["SALESREP_NUMBER"].ToString();
                    dr1["INV_COMMENTS"] = dr["INV_COMMENTS"].ToString();

                    dr1["REC_COMMENTS"] = dr["REC_COMMENTS"].ToString();

                    dr1["PAYMENT_TERMS"] = dr["PAYMENT_TERMS"].ToString();

                    dr1["CREDIT_LIMIT"] = dr["CREDIT_LIMIT"].ToString();
                    dr1["GL_YEAR"] = dr["GL_YEAR"].ToString();
                    dr1["SHIP_TO_CUSTOMER"] = dr["SHIP_TO_CUSTOMER"].ToString().ToUpper();

                    pvt.Rows.Add(dr1);

                }


            }

            catch (Exception e6)
            {

            }


            pvtview.DataSource = pvt;

            var pivotgridfields = pvtview.Fields;

            PivotGridField field1 = pvtview.Fields["ACCOUNT_NAME"];
            PivotGridField field2 = pvtview.Fields["ACCOUNT_NUMBER"];
            PivotGridField field3 = pvtview.Fields["TRX_NUMBER"];
            PivotGridField field4 = pvtview.Fields["SALES_ORDER"];
            PivotGridField field5 = pvtview.Fields["ORDER_TYPE"];
            PivotGridField field6 = pvtview.Fields["TRX_DATE"];
            PivotGridField field7 = pvtview.Fields["GL_DATE"];
            PivotGridField field8 = pvtview.Fields["DUE_DATE"];
            PivotGridField field9 = pvtview.Fields["DAYS_DUE"];
            PivotGridField field10 = pvtview.Fields["CURRENCY"];
            PivotGridField field11 = pvtview.Fields["STATUS"];
            PivotGridField field12 = pvtview.Fields["CLASS"];
            PivotGridField field13 = pvtview.Fields["BUSINES_UNIT"];
            PivotGridField field14 = pvtview.Fields["CUSTOMER_CLASS_CODE"];
            PivotGridField field15 = pvtview.Fields["TRX_TYPE"];
            PivotGridField field16 = pvtview.Fields["AMT_ORIGINAL"];
            PivotGridField field17 = pvtview.Fields["AMT_REMAINING"];
            PivotGridField field18 = pvtview.Fields["ACCT_AMT_REMAINING"];
            PivotGridField field19 = pvtview.Fields["AMOUNT_ON_ACCOUNT"];
            PivotGridField field20 = pvtview.Fields["AMOUNT_APPLIED"];
            PivotGridField field21 = pvtview.Fields["EXCHANGE_RATE"];
            PivotGridField field22 = pvtview.Fields["TRX_MONTH"];
            PivotGridField field23 = pvtview.Fields["GL_MONTH"];
            PivotGridField field24 = pvtview.Fields["SALESREP_NAME"];
            PivotGridField field25 = pvtview.Fields["SALESREP_NUMBER"];
            PivotGridField field26 = pvtview.Fields["INV_COMMENTS"];
            PivotGridField field27 = pvtview.Fields["REC_COMMENTS"];

            PivotGridField field28 = pvtview.Fields["PAYMENT_TERMS"];
            PivotGridField field29 = pvtview.Fields["CREDIT_LIMIT"];
            PivotGridField field30 = pvtview.Fields["GL_YEAR"];
            PivotGridField field31 = pvtview.Fields["SHIP_TO_CUSTOMER"];



            try
            {
                pvtview.Fields.Remove(field1);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field2);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field3);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field4);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field5);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field6);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field7);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field8);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field9);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field10);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field11);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field12);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field13);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field14);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field15);
            }
            catch (Exception e6)
            { }



            try
            {

                pvtview.Fields.Remove(field16);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field17);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field18);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field19);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field20);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field21);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field22);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field23);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field24);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field25);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field26);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field27);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field28);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field29);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field30);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field31);
            }
            catch (Exception e6)
            { }


            //PivotGridField TRX_NUMBER = new PivotGridField();      

            //PivotGridField SALES_ORDER = new PivotGridField(); ;
            //PivotGridField ORDER_TYPE = new PivotGridField(); ;
            //PivotGridField TRX_DATE = new PivotGridField(); ;
            //PivotGridField SALESREP_NAME = new PivotGridField(); ;
            //PivotGridField TRX_MONTH = new PivotGridField();
            //PivotGridField CURRENCY = new PivotGridField();

            //TRX_NUMBER.UnboundFieldName = "TRX_NUMBER";
            //SALES_ORDER.UnboundFieldName = "SALES_ORDER";
            //ORDER_TYPE.UnboundFieldName = "ORDER_TYPE";
            //TRX_DATE.UnboundFieldName = "TRX_DATE";
            //TRX_MONTH.UnboundFieldName = "TRX_MONTH";
            //SALESREP_NAME.UnboundFieldName = "SALESREP_NAME";

            PivotGridField ACCOUNT_NAME = new PivotGridField("ACCOUNT_NAME", DevExpress.XtraPivotGrid.PivotArea.RowArea);
            PivotGridField ACCOUNT_NUMBER = new PivotGridField("ACCOUNT_NUMBER", DevExpress.XtraPivotGrid.PivotArea.RowArea);

            PivotGridField SHIP_TO_CUSTOMER = new PivotGridField("SHIP_TO_CUSTOMER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);


            PivotGridField GL_DATE = new PivotGridField("GL_DATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField DUE_DATE = new PivotGridField("DUE_DATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField DAYS_DUE = new PivotGridField("DAYS_DUE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField STATUS = new PivotGridField("STATUS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField CLASS = new PivotGridField("CLASS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField BUSINES_UNIT = new PivotGridField("BUSINES_UNIT", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField CUSTOMER_CLASS_CODE = new PivotGridField("CUSTOMER_CLASS_CODE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField TRX_TYPE = new PivotGridField("TRX_TYPE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField AMT_ORIGINAL = new PivotGridField("AMT_ORIGINAL", DevExpress.XtraPivotGrid.PivotArea.DataArea);

            PivotGridField AMT_REMAINING = new PivotGridField("AMT_REMAINING", DevExpress.XtraPivotGrid.PivotArea.DataArea);
            PivotGridField AMOUNT_ON_ACCOUNT = new PivotGridField("AMOUNT_ON_ACCOUNT", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField AMOUNT_APPLIED = new PivotGridField("AMOUNT_APPLIED", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField EXCHANGE_RATE = new PivotGridField("EXCHANGE_RATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);



            PivotGridField SALESREP_NUMBER = new PivotGridField("SALESREP_NUMBER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);

            //PivotGridField INV_COMMENTS = new PivotGridField("INV_COMMENTS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField REC_COMMENTS = new PivotGridField("REC_COMMENTS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);

            PivotGridField PAYMENT_TERMS = new PivotGridField("PAYMENT_TERMS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField CREDIT_LIMIT = new PivotGridField("CREDIT_LIMIT", DevExpress.XtraPivotGrid.PivotArea.FilterArea);

            ACCOUNT_NAME.UnboundFieldName = "ACCOUNT_NAME";
            ACCOUNT_NUMBER.UnboundFieldName = "ACCOUNT_NUMBER";
            SHIP_TO_CUSTOMER.UnboundFieldName = "SHIP_TO_CUSTOMER";

            GL_DATE.UnboundFieldName = "GL_DATE";
            DUE_DATE.UnboundFieldName = "DUE_DATE";
            DAYS_DUE.UnboundFieldName = "DAYS_DUE";

            STATUS.UnboundFieldName = "STATUS";
            CLASS.UnboundFieldName = "CLASS";
            BUSINES_UNIT.UnboundFieldName = "BUSINES_UNIT";
            CUSTOMER_CLASS_CODE.UnboundFieldName = "CUSTOMER_CLASS_CODE";
            TRX_TYPE.UnboundFieldName = "TRX_TYPE";

            //AMT_ORIGINAL.UnboundFieldName = "AMT_ORIGINAL";
            //AMT_REMAINING.UnboundFieldName = "AMT_REMAINING";
            //// ACCT_AMT_REMAINING.UnboundFieldName = "ACCT_AMT_REMAINING";
            //AMOUNT_ON_ACCOUNT.UnboundFieldName = "AMOUNT_ON_ACCOUNT";
            //AMOUNT_APPLIED.UnboundFieldName = "AMOUNT_APPLIED";
            //EXCHANGE_RATE.UnboundFieldName = "EXCHANGE_RATE";



            //     ACCT_AMT_REMAINING.= "MUR AMT";




            SALESREP_NUMBER.UnboundFieldName = "SALESREP_NUMBER";


            REC_COMMENTS.UnboundFieldName = "REC_COMMENTS";


            PAYMENT_TERMS.UnboundFieldName = "PAYMENT_TERMS";
            CREDIT_LIMIT.UnboundFieldName = "CREDIT_LIMIT";

            //AMT_REMAINING.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
            //AMOUNT_ON_ACCOUNT.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
            //AMOUNT_APPLIED.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
            //EXCHANGE_RATE.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;


            if (rmode == null)
            {
                PivotGridField GL_YEAR = new PivotGridField("GL_YEAR", DevExpress.XtraPivotGrid.PivotArea.ColumnArea);
 
                PivotGridField GL_MONTH = new PivotGridField("GL_MONTH", DevExpress.XtraPivotGrid.PivotArea.ColumnArea);
                PivotGridField TRX_MONTH = new PivotGridField("TRX_MONTH", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField TRX_NUMBER = new PivotGridField("TRX_NUMBER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField SALES_ORDER = new PivotGridField("SALES_ORDER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField ORDER_TYPE = new PivotGridField("ORDER_TYPE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField TRX_DATE = new PivotGridField("TRX_DATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField SALESREP_NAME = new PivotGridField("SALESREP_NAME", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField CURRENCY = new PivotGridField("CURRENCY", DevExpress.XtraPivotGrid.PivotArea.ColumnArea);
                PivotGridField ACCT_AMT_REMAINING = new PivotGridField("ACCT_AMT_REMAINING", DevExpress.XtraPivotGrid.PivotArea.DataArea);
                PivotGridField INV_COMMENTS = new PivotGridField("INV_COMMENTS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);

                ACCT_AMT_REMAINING.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
                ACCT_AMT_REMAINING.CellFormat.FormatString = "n2";

                // SALESREP_NAME.UnboundFieldName = "INV_COMMENTS";
                GL_YEAR.UnboundFieldName = "GL_YEAR";
                TRX_NUMBER.UnboundFieldName = "TRX_NUMBER";
                SALES_ORDER.UnboundFieldName = "SALES_ORDER";
                ORDER_TYPE.UnboundFieldName = "ORDER_TYPE";
                TRX_DATE.UnboundFieldName = "TRX_DATE";
                TRX_MONTH.UnboundFieldName = "TRX_MONTH";
                SALESREP_NAME.UnboundFieldName = "SALESREP_NAME";
                CURRENCY.UnboundFieldName = "CURRENCY";
                GL_MONTH.UnboundFieldName = "GL_MONTH";
                //    ACCT_AMT_REMAINING.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
                ACCT_AMT_REMAINING.Caption = "MUR AMT";

                pvtview.Fields.AddRange(new PivotGridField[] {ACCOUNT_NAME,ACCOUNT_NUMBER,GL_YEAR,GL_MONTH,TRX_NUMBER,SALES_ORDER,ORDER_TYPE,GL_DATE,DUE_DATE,
                    DAYS_DUE,CURRENCY,STATUS,CLASS,BUSINES_UNIT,CUSTOMER_CLASS_CODE,TRX_TYPE,AMT_ORIGINAL,AMT_REMAINING,
                    ACCT_AMT_REMAINING,AMOUNT_ON_ACCOUNT,AMOUNT_APPLIED,EXCHANGE_RATE,TRX_MONTH,TRX_DATE,SALESREP_NAME,SALESREP_NUMBER,INV_COMMENTS,REC_COMMENTS,
            PAYMENT_TERMS,CREDIT_LIMIT,SHIP_TO_CUSTOMER});
            }
            else if (rmode == "SINGLE")
            {
                PivotGridField GL_YEAR = new PivotGridField("GL_YEAR", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField INV_COMMENTS = new PivotGridField("INV_COMMENTS", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField GL_MONTH = new PivotGridField("GL_MONTH", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField TRX_MONTH = new PivotGridField("TRX_MONTH", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField TRX_NUMBER = new PivotGridField("TRX_NUMBER", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField SALES_ORDER = new PivotGridField("SALES_ORDER", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField ORDER_TYPE = new PivotGridField("ORDER_TYPE", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField TRX_DATE = new PivotGridField("TRX_DATE", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField SALESREP_NAME = new PivotGridField("SALESREP_NAME", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField CURRENCY = new PivotGridField("CURRENCY", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField ACCT_AMT_REMAINING = new PivotGridField("ACCT_AMT_REMAINING", DevExpress.XtraPivotGrid.PivotArea.DataArea);
                ACCT_AMT_REMAINING.Caption = "MUR AMT";
                //      ACCT_AMT_REMAINING.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
                //      ACCT_AMT_REMAINING.UnboundFieldName = "MUR AMT";

                //  ACCT_AMT_REMAINING.FieldName = "MUR AMT";

                TRX_NUMBER.UnboundFieldName = "TRX_NUMBER";
                GL_YEAR.UnboundFieldName = "GL_YEAR";

                SALES_ORDER.UnboundFieldName = "SALES_ORDER";
                ORDER_TYPE.UnboundFieldName = "ORDER_TYPE";
                TRX_DATE.UnboundFieldName = "TRX_DATE";
                TRX_MONTH.UnboundFieldName = "TRX_MONTH";
                SALESREP_NAME.UnboundFieldName = "SALESREP_NAME";
                CURRENCY.UnboundFieldName = "CURRENCY";
                GL_MONTH.UnboundFieldName = "GL_MONTH";
                INV_COMMENTS.UnboundFieldName = "INV_COMMENTS";

                pvtview.Fields.AddRange(new PivotGridField[] {ACCOUNT_NAME,ACCOUNT_NUMBER,GL_YEAR,GL_MONTH,TRX_DATE,TRX_NUMBER,SALES_ORDER,ORDER_TYPE,GL_DATE,DUE_DATE,
                    DAYS_DUE,CURRENCY,STATUS,CLASS,BUSINES_UNIT,CUSTOMER_CLASS_CODE,TRX_TYPE,AMT_ORIGINAL,AMT_REMAINING,
                    ACCT_AMT_REMAINING,AMOUNT_ON_ACCOUNT,AMOUNT_APPLIED,EXCHANGE_RATE,TRX_MONTH,SALESREP_NAME,SALESREP_NUMBER,INV_COMMENTS,REC_COMMENTS,
            PAYMENT_TERMS,CREDIT_LIMIT,SHIP_TO_CUSTOMER});

                ACCT_AMT_REMAINING.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
                ACCT_AMT_REMAINING.CellFormat.FormatString = "n2";
                // ACCT_AMT_REMAINING.UnboundFieldName = "MUR AMT";
            }




            pvtview.Appearance.RowHeaderArea.Font = new Font("Tahoma", 10f);
            pvtview.Appearance.ColumnHeaderArea.Font = new Font("Tahoma", 10f);
            pvtview.Appearance.Cell.Font = new Font("Tahoma", 10f);
            //  pivotGridControl3.Appearance.Row.Font = new Font("Tahoma", 10f);


            AMT_ORIGINAL.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            AMT_ORIGINAL.CellFormat.FormatString = "n2";


            AMT_REMAINING.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            AMT_REMAINING.CellFormat.FormatString = "n2";



            AMOUNT_ON_ACCOUNT.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            AMOUNT_ON_ACCOUNT.CellFormat.FormatString = "n2";

            AMOUNT_APPLIED.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            AMOUNT_APPLIED.CellFormat.FormatString = "n2";

            EXCHANGE_RATE.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            EXCHANGE_RATE.CellFormat.FormatString = "n2";

        }

        public void pivotacctdetailsbymonth(DataTable dt, PivotGridControl pvtview)
        {
            pvtview.DataSource = dt;

            var pivotgridfields = pvtview.Fields;

            PivotGridField field1 = pvtview.Fields["ACCOUNT_NAME"];
            PivotGridField field2 = pvtview.Fields["ACCOUNT_NUMBER"];
            PivotGridField field3 = pvtview.Fields["TRX_NUMBER"];
            PivotGridField field4 = pvtview.Fields["SALES_ORDER"];
            PivotGridField field5 = pvtview.Fields["ORDER_TYPE"];
            PivotGridField field6 = pvtview.Fields["TRX_DATE"];
            PivotGridField field7 = pvtview.Fields["GL_DATE"];
            PivotGridField field8 = pvtview.Fields["DUE_DATE"];
            PivotGridField field9 = pvtview.Fields["DAYS_DUE"];
            PivotGridField field10 = pvtview.Fields["CURRENCY"];
            PivotGridField field11 = pvtview.Fields["STATUS"];
            PivotGridField field12 = pvtview.Fields["CLASS"];
            PivotGridField field13 = pvtview.Fields["BUSINES_UNIT"];
            PivotGridField field14 = pvtview.Fields["CUSTOMER_CLASS_CODE"];
            PivotGridField field15 = pvtview.Fields["TRX_TYPE"];
            PivotGridField field16 = pvtview.Fields["AMT_ORIGINAL"];
            PivotGridField field17 = pvtview.Fields["AMT_REMAINING"];
            PivotGridField field18 = pvtview.Fields["ACCT_AMT_REMAINING"];
            PivotGridField field19 = pvtview.Fields["AMOUNT_ON_ACCOUNT"];
            PivotGridField field20 = pvtview.Fields["AMOUNT_APPLIED"];
            PivotGridField field21 = pvtview.Fields["EXCHANGE_RATE"];
            PivotGridField field22 = pvtview.Fields["TRX_MONTH"];
            PivotGridField field23 = pvtview.Fields["GL_MONTH"];
            PivotGridField field24 = pvtview.Fields["SALESREP_NAME"];
            PivotGridField field25 = pvtview.Fields["SALESREP_NUMBER"];
            PivotGridField field26 = pvtview.Fields["INV_COMMENTS"];
            PivotGridField field27 = pvtview.Fields["REC_COMMENTS"];

            PivotGridField field28 = pvtview.Fields["PAYMENT_TERMS"];
            PivotGridField field29 = pvtview.Fields["CREDIT_LIMIT"];
            PivotGridField field30 = pvtview.Fields["GL_YEAR"];


            try
            {
                pvtview.Fields.Remove(field1);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field2);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field3);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field4);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field5);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field6);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field7);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field8);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field9);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field10);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field11);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field12);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field13);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field14);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field15);
            }
            catch (Exception e6)
            { }



            try
            {

                pvtview.Fields.Remove(field16);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field17);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field18);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field19);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field20);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field21);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field22);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field23);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field24);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field25);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field26);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field27);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field28);
            }
            catch (Exception e6)
            { }

            try
            {

                pvtview.Fields.Remove(field29);
            }
            catch (Exception e6)
            { }


            try
            {

                pvtview.Fields.Remove(field30);
            }
            catch (Exception e6)
            { }

            //PivotGridField TRX_NUMBER = new PivotGridField();      

            //PivotGridField SALES_ORDER = new PivotGridField(); ;
            //PivotGridField ORDER_TYPE = new PivotGridField(); ;
            //PivotGridField TRX_DATE = new PivotGridField(); ;
            //PivotGridField SALESREP_NAME = new PivotGridField(); ;
            //PivotGridField TRX_MONTH = new PivotGridField();
            //PivotGridField CURRENCY = new PivotGridField();

            //TRX_NUMBER.UnboundFieldName = "TRX_NUMBER";
            //SALES_ORDER.UnboundFieldName = "SALES_ORDER";
            //ORDER_TYPE.UnboundFieldName = "ORDER_TYPE";
            //TRX_DATE.UnboundFieldName = "TRX_DATE";
            //TRX_MONTH.UnboundFieldName = "TRX_MONTH";
            //SALESREP_NAME.UnboundFieldName = "SALESREP_NAME";

            PivotGridField ACCOUNT_NAME = new PivotGridField("ACCOUNT_NAME", DevExpress.XtraPivotGrid.PivotArea.RowArea);
            PivotGridField ACCOUNT_NUMBER = new PivotGridField("ACCOUNT_NUMBER", DevExpress.XtraPivotGrid.PivotArea.RowArea);



            PivotGridField GL_DATE = new PivotGridField("GL_DATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField DUE_DATE = new PivotGridField("DUE_DATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField DAYS_DUE = new PivotGridField("DAYS_DUE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField STATUS = new PivotGridField("STATUS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField CLASS = new PivotGridField("CLASS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField BUSINES_UNIT = new PivotGridField("BUSINES_UNIT", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField CUSTOMER_CLASS_CODE = new PivotGridField("CUSTOMER_CLASS_CODE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField TRX_TYPE = new PivotGridField("TRX_TYPE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField AMT_ORIGINAL = new PivotGridField("AMT_ORIGINAL", DevExpress.XtraPivotGrid.PivotArea.FilterArea);

            PivotGridField AMT_REMAINING = new PivotGridField("AMT_REMAINING", DevExpress.XtraPivotGrid.PivotArea.DataArea);
            PivotGridField AMOUNT_ON_ACCOUNT = new PivotGridField("AMOUNT_ON_ACCOUNT", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField AMOUNT_APPLIED = new PivotGridField("AMOUNT_APPLIED", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField EXCHANGE_RATE = new PivotGridField("EXCHANGE_RATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);



            PivotGridField SALESREP_NUMBER = new PivotGridField("SALESREP_NUMBER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);

            //PivotGridField INV_COMMENTS = new PivotGridField("INV_COMMENTS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField REC_COMMENTS = new PivotGridField("REC_COMMENTS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);

            PivotGridField PAYMENT_TERMS = new PivotGridField("PAYMENT_TERMS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
            PivotGridField CREDIT_LIMIT = new PivotGridField("CREDIT_LIMIT", DevExpress.XtraPivotGrid.PivotArea.FilterArea);

            ACCOUNT_NAME.UnboundFieldName = "ACCOUNT_NAME";
            ACCOUNT_NUMBER.UnboundFieldName = "ACCOUNT_NUMBER";

            GL_DATE.UnboundFieldName = "GL_DATE";
            DUE_DATE.UnboundFieldName = "DUE_DATE";
            DAYS_DUE.UnboundFieldName = "DAYS_DUE";

            STATUS.UnboundFieldName = "STATUS";
            CLASS.UnboundFieldName = "CLASS";
            BUSINES_UNIT.UnboundFieldName = "BUSINES_UNIT";
            CUSTOMER_CLASS_CODE.UnboundFieldName = "CUSTOMER_CLASS_CODE";
            TRX_TYPE.UnboundFieldName = "TRX_TYPE";
            //AMT_ORIGINAL.UnboundFieldName = "AMT_ORIGINAL";
            //AMT_REMAINING.UnboundFieldName = "AMT_REMAINING";
            //// ACCT_AMT_REMAINING.UnboundFieldName = "ACCT_AMT_REMAINING";
            //AMOUNT_ON_ACCOUNT.UnboundFieldName = "AMOUNT_ON_ACCOUNT";
            //AMOUNT_APPLIED.UnboundFieldName = "AMOUNT_APPLIED";
            EXCHANGE_RATE.UnboundFieldName = "EXCHANGE_RATE";







            SALESREP_NUMBER.UnboundFieldName = "SALESREP_NUMBER";


            REC_COMMENTS.UnboundFieldName = "REC_COMMENTS";


            PAYMENT_TERMS.UnboundFieldName = "PAYMENT_TERMS";
            CREDIT_LIMIT.UnboundFieldName = "CREDIT_LIMIT";

            //AMT_REMAINING.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
            //AMOUNT_ON_ACCOUNT.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
            //AMOUNT_APPLIED.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
            //EXCHANGE_RATE.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;


            if (rmode == null)
            {
                PivotGridField GL_YEAR = new PivotGridField("GL_YEAR", DevExpress.XtraPivotGrid.PivotArea.ColumnArea);

                PivotGridField GL_MONTH = new PivotGridField("GL_MONTH", DevExpress.XtraPivotGrid.PivotArea.ColumnArea);
                PivotGridField TRX_MONTH = new PivotGridField("TRX_MONTH", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField TRX_NUMBER = new PivotGridField("TRX_NUMBER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField SALES_ORDER = new PivotGridField("SALES_ORDER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField ORDER_TYPE = new PivotGridField("ORDER_TYPE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField TRX_DATE = new PivotGridField("TRX_DATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField SALESREP_NAME = new PivotGridField("SALESREP_NAME", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField CURRENCY = new PivotGridField("CURRENCY", DevExpress.XtraPivotGrid.PivotArea.RowArea);
                PivotGridField ACCT_AMT_REMAINING = new PivotGridField("ACCT_AMT_REMAINING", DevExpress.XtraPivotGrid.PivotArea.DataArea);
                PivotGridField INV_COMMENTS = new PivotGridField("INV_COMMENTS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);

                ACCT_AMT_REMAINING.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
                ACCT_AMT_REMAINING.CellFormat.FormatString = "n2";

                // SALESREP_NAME.UnboundFieldName = "INV_COMMENTS";
                GL_YEAR.UnboundFieldName = "GL_YEAR";
                TRX_NUMBER.UnboundFieldName = "TRX_NUMBER";
                SALES_ORDER.UnboundFieldName = "SALES_ORDER";
                ORDER_TYPE.UnboundFieldName = "ORDER_TYPE";
                TRX_DATE.UnboundFieldName = "TRX_DATE";
                TRX_MONTH.UnboundFieldName = "TRX_MONTH";
                SALESREP_NAME.UnboundFieldName = "SALESREP_NAME";
                CURRENCY.UnboundFieldName = "CURRENCY";
                GL_MONTH.UnboundFieldName = "GL_MONTH";
                //  ACCT_AMT_REMAINING.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
                ACCT_AMT_REMAINING.UnboundFieldName = "MUR AMT";

                pvtview.Fields.AddRange(new PivotGridField[] {ACCOUNT_NAME,ACCOUNT_NUMBER,GL_YEAR,GL_MONTH,TRX_NUMBER,SALES_ORDER,ORDER_TYPE,GL_DATE,DUE_DATE,
                    DAYS_DUE,CURRENCY,STATUS,CLASS,BUSINES_UNIT,CUSTOMER_CLASS_CODE,TRX_TYPE,AMT_ORIGINAL,AMT_REMAINING,
                    ACCT_AMT_REMAINING,AMOUNT_ON_ACCOUNT,AMOUNT_APPLIED,EXCHANGE_RATE,TRX_MONTH,TRX_DATE,SALESREP_NAME,SALESREP_NUMBER,INV_COMMENTS,REC_COMMENTS,
            PAYMENT_TERMS,CREDIT_LIMIT});
            }
            else if (rmode == "SINGLE")
            {
                PivotGridField GL_YEAR = new PivotGridField("GL_YEAR", DevExpress.XtraPivotGrid.PivotArea.ColumnArea);
                PivotGridField INV_COMMENTS = new PivotGridField("INV_COMMENTS", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField GL_MONTH = new PivotGridField("GL_MONTH", DevExpress.XtraPivotGrid.PivotArea.ColumnArea);
                PivotGridField TRX_MONTH = new PivotGridField("TRX_MONTH", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField TRX_NUMBER = new PivotGridField("TRX_NUMBER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField SALES_ORDER = new PivotGridField("SALES_ORDER", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField ORDER_TYPE = new PivotGridField("ORDER_TYPE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField TRX_DATE = new PivotGridField("TRX_DATE", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField SALESREP_NAME = new PivotGridField("SALESREP_NAME", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField CURRENCY = new PivotGridField("CURRENCY", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                PivotGridField ACCT_AMT_REMAINING = new PivotGridField("ACCT_AMT_REMAINING", DevExpress.XtraPivotGrid.PivotArea.FilterArea);
                // ACCT_AMT_REMAINING.UnboundType = DevExpress.Data.UnboundColumnType.Decimal;
                ACCT_AMT_REMAINING.UnboundFieldName = "MUR AMT";

                TRX_NUMBER.UnboundFieldName = "TRX_NUMBER";
                GL_YEAR.UnboundFieldName = "GL_YEAR";

                SALES_ORDER.UnboundFieldName = "SALES_ORDER";
                ORDER_TYPE.UnboundFieldName = "ORDER_TYPE";
                TRX_DATE.UnboundFieldName = "TRX_DATE";
                TRX_MONTH.UnboundFieldName = "TRX_MONTH";
                SALESREP_NAME.UnboundFieldName = "SALESREP_NAME";
                CURRENCY.UnboundFieldName = "CURRENCY";
                GL_MONTH.UnboundFieldName = "GL_MONTH";
                INV_COMMENTS.UnboundFieldName = "INV_COMMENTS";

                pvtview.Fields.AddRange(new PivotGridField[] {ACCOUNT_NAME,ACCOUNT_NUMBER,GL_YEAR,GL_MONTH,TRX_DATE,TRX_NUMBER,SALES_ORDER,ORDER_TYPE,GL_DATE,DUE_DATE,
                    DAYS_DUE,CURRENCY,STATUS,CLASS,BUSINES_UNIT,CUSTOMER_CLASS_CODE,TRX_TYPE,AMT_ORIGINAL,AMT_REMAINING,
                    ACCT_AMT_REMAINING,AMOUNT_ON_ACCOUNT,AMOUNT_APPLIED,EXCHANGE_RATE,TRX_MONTH,SALESREP_NAME,SALESREP_NUMBER,INV_COMMENTS,REC_COMMENTS,
            PAYMENT_TERMS,CREDIT_LIMIT});

                ACCT_AMT_REMAINING.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
                ACCT_AMT_REMAINING.CellFormat.FormatString = "n2";
                ACCT_AMT_REMAINING.UnboundFieldName = "MUR AMT";
            }




            pvtview.Appearance.RowHeaderArea.Font = new Font("Tahoma", 10f);
            pvtview.Appearance.ColumnHeaderArea.Font = new Font("Tahoma", 10f);
            pvtview.Appearance.Cell.Font = new Font("Tahoma", 10f);
            //  pivotGridControl3.Appearance.Row.Font = new Font("Tahoma", 10f);


            AMT_ORIGINAL.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            AMT_ORIGINAL.CellFormat.FormatString = "n2";


            AMT_REMAINING.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            AMT_REMAINING.CellFormat.FormatString = "n2";



            AMOUNT_ON_ACCOUNT.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            AMOUNT_ON_ACCOUNT.CellFormat.FormatString = "n2";

            AMOUNT_APPLIED.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            AMOUNT_APPLIED.CellFormat.FormatString = "n2";

            EXCHANGE_RATE.CellFormat.FormatType = DevExpress.Utils.FormatType.Numeric;
            EXCHANGE_RATE.CellFormat.FormatString = "n2";



        }




        public void getpendingorders()
        {
            FusionRunReport report = null;
            report = new FusionRunReport();
            Fusion_Integration help = new Fusion_Integration();

            helperclass helper = null;
            helper = new helperclass();

            DataSet DSorderdetails = new DataSet();

            if (instance_name == "PROD")
            {
                DSorderdetails = prodreport.runreport_parameter
                              ("/Custom/DEXPRESS/ORDER MANAGEMENT/PENDING_PDA_ORDERS_BIP.xdo", "shaik", "fusion1234",
                                   businessunit, inventory_org_id, "ORG_ID", "INVENTORY_ORG_ID");

            }
            else if (instance_name == "TEST")
            {

                DSorderdetails = report.runreport_parameter
                             ("/Custom/DEXPRESS/ORDER MANAGEMENT/PENDING_PDA_ORDERS_BIP.xdo", "shaik", "fusion1234",
                                  businessunit, inventory_org_id, "ORG_ID", "INVENTORY_ORG_ID");
            }

            try
            {

                DataTable DTorderdetails = DSorderdetails.Tables[1];
                // int columcount = DSorderdetails.Tables[1].Columns.Count;
                //   populatepivot(ds1);
                //getnumbercharcols(dts);
                //  gridView2.OptionsBehavior.ReadOnly = true;

                helper.setgridproperties_new(DSorderdetails, gridView6, gridControl6, "Analysis", helper.getnumbercharcols(DTorderdetails, "N"), "paint", helper.getnumbercharcols(DTorderdetails, "C"), spreadsheetControl1);
            }
            catch (Exception e6)
            {
                MessageBox.Show("No Data Found", "info");
            }


        }

        private void gridControl3_Click(object sender, EventArgs e)
        {

        }

        private void gridControl3_DoubleClick(object sender, EventArgs e)
        {
            accountdetails("S");
        }

        DateTime adstartdate;
        DateTime adenddate;

        string asstartdate;
        string asenddate;

        private void flyoutPanel23_ButtonClick(object sender, DevExpress.Utils.FlyoutPanelButtonClickEventArgs e)
        {

            try
            {

                adstartdate = Convert.ToDateTime(dateEdit7.EditValue.ToString());
                adenddate = Convert.ToDateTime(dateEdit6.EditValue.ToString());

                asstartdate = adstartdate.ToString("yyyy-MM-dd");
                asenddate = adenddate.ToString("yyyy-MM-dd");

                //

            }
            catch (Exception e6)
            {

            }

            if (e.Button.Caption == "Search")
            {

                DataRow row = websrvicedates.NewRow();
                row["Date"] = DateTime.Now.ToString();
                row["reportname"] = "Query Account Details";
                row["status"] = "initializing";

                websrvicedates.Rows.Add(row);

                gridControl5.DataSource = null;
                gridView5.RefreshData();

                //gridControl10.DataSource = null;
                //gridView10.RefreshData();


                //   stkmovment();

                marqueeProgressBarControl1.Visible = true;


                Thread thread = new Thread(() => getaccountdetails(tbscustomernumber.Text, tbscustomer.Text, "AD"));
                thread.IsBackground = true;
                Thread.Sleep(1000);
                thread.Name = string.Format("Query Account Details");
                _threads.Add(thread);

                //Task<string> task = new Task<string>(stkmovment);
                //task.Start();
                //string x;
                //x = await task;


                //       Thread.Sleep(1000);
                //  thread.Name = string.Format("Fusion Client{0}", "Stock Movement");
                //  _threads.Add(thread);

                thread.Start();

                DataRow row1 = Threadtable.NewRow();
                row1["Threadname"] = thread.Name;
                row1["status"] = thread.ThreadState;
                row1["startdate"] = DateTime.Now.ToString();
                row1["enddate"] = "";
                row1["notify"] = "";

                Threadtable.Rows.Add(row1);


                timer1.Enabled = true;

                showalert("Request for Account Details submitted", "info");



                // getaccountdetails(tbscustomernumber.Text, tbscustomer.Text, "AD");
                flyoutPanel23.HidePopup();
            }
            else
            {
                flyoutPanel23.HidePopup();
            }
        }

        private void exportExcelToolStripMenuItem_Click(object sender, EventArgs e)
        {


            try
            {
                var pivotExportOptions = new DevExpress.XtraPivotGrid.PivotXlsExportOptions();
                pivotExportOptions.ExportType = DevExpress.Export.ExportType.WYSIWYG;
                pivotGridControl3.OptionsPrint.PageSettings.PaperKind = System.Drawing.Printing.PaperKind.A3;

                pivotGridControl3.ShowPrintPreview();
            }
            catch
            {

            }

            //DateTime dt = DateTime.Now;

            //string time = dt.ToString("-HH-mm-ss");

            //try
            //{
            //    string FileName = "C:\\fusion\\accountdetails-" + time + ".xls";
            //    //     pivotGridControl9.ExportToXls(FileName);



            //    ////  PivotXlsxExportOptions options = new PivotXlsxExportOptions();
            //    //    //   options.CustomizeCell += options_CustomizeCell;
            //    //  //  pivotGridControl3.ExportToXlsx(FileName, options);
            //    //  pivotGridControl3.ExportToXlsx(FileName);


            //    var pivotExportOptions = new DevExpress.XtraPivotGrid.PivotXlsxExportOptions();
            //    // pivotExportOptions.AllowCellMerge=false;
            //    pivotExportOptions.ExportType = DevExpress.Export.ExportType.WYSIWYG;
            //    pivotGridControl3.ExportToXlsx("C:\\fusion\\accountdetails-" + time + ".xls", pivotExportOptions);

            //    System.Diagnostics.Process.Start("C:\\fusion\\accountdetails-" + time + ".xls");


            //}
            //catch (Exception e6)
            //{

            //}

        }

        private void exportToExcelToolStripMenuItem1_Click(object sender, EventArgs e)
        {

            try
            {
                var pivotExportOptions = new DevExpress.XtraPivotGrid.PivotXlsExportOptions();
                pivotExportOptions.ExportType = DevExpress.Export.ExportType.WYSIWYG;
                pivotGridControl4.OptionsPrint.PageSettings.PaperKind = System.Drawing.Printing.PaperKind.A3;

                pivotGridControl4.ShowPrintPreview();
            }
            catch
            {

            }

            //DateTime dt = DateTime.Now;

            //string time = dt.ToString("-HH-mm-ss");

            //try
            //{
            //    string FileName = "C:\\fusion\\accountdetails-" + time + ".xls";
            //    //     pivotGridControl9.ExportToXls(FileName);

            //    var pivotExportOptions = new DevExpress.XtraPivotGrid.PivotXlsxExportOptions();
            //    pivotExportOptions.ExportType = DevExpress.Export.ExportType.WYSIWYG;

            //    pivotGridControl4.ExportToXlsx(FileName, pivotExportOptions);

            //    //PivotXlsxExportOptions options = new PivotXlsxExportOptions();
            //    //options.CustomizeCell += options_CustomizeCell;
            //    //pivotGridControl4.ExportToXlsx(FileName);//, options);

            //    System.Diagnostics.Process.Start("C:\\fusion\\accountdetails-" + time + ".xls");


            //}
            //catch (Exception e6)
            //{

            //}


            //DateTime dt = DateTime.Now;

            //string time = dt.ToString("-HH-mm-ss");

            //try
            //{
            //    string FileName = "C:\\fusion\\accountdetails-" + time + ".xls";
            //    //     pivotGridControl9.ExportToXls(FileName);

            //    var pivotExportOptions = new DevExpress.XtraPivotGrid.PivotXlsxExportOptions();
            //    pivotExportOptions.ExportType = DevExpress.Export.ExportType.WYSIWYG;

            //    pivotGridControl4.ExportToXlsx("pivot.xlsx", pivotExportOptions);

            //    //PivotXlsxExportOptions options = new PivotXlsxExportOptions();
            //    //options.CustomizeCell += options_CustomizeCell;
            //    pivotGridControl4.ExportToXlsx(FileName);//, options);

            //    System.Diagnostics.Process.Start("C:\\fusion\\accountdetails-" + time + ".xls");


            //}
            //catch (Exception e6)
            //{

            //}
        }

        private void pivotGridControl3_Click(object sender, EventArgs e)
        {

        }

        private void queryCustomerBalancesToolStripMenuItem_Click(object sender, EventArgs e)
        {
            tabPane6.SelectedPageIndex = 0;
            flyoutPanel2.ShowPopup();
        }

        public void querycustomerbalance()
        {
            // tabPane1.SelectedPageIndex = 3;

            tabPane6.SelectedPageIndex = 0;

            var result = XtraMessageBox.Show("Do you Want to Refresh the Data ?, This will take several minutes !", "Confirmation", MessageBoxButtons.YesNo);

            // IF 1
            if (result.ToString() == "Yes")
            {

                try
                {
                    getcustomers("", "STATEMENT", "STMT");
                }
                catch
                {

                }
            }
        }

        private void emailCustomerStatementsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            tabPane6.SelectedPageIndex = 0;
            flyoutPanel1.ShowPopup();
        }

        string statementfilename = null;

        public void emailstatements(GridView view, DateTime fdate, string username)
        {

            string folderName = @"c:\fusion\statements\";

            DateTime datetime1 = DateTime.Now;
            string time = datetime1.ToString("h mm tt");


            //string fromdate1 = fdate.ToString("yyyy-MM-dd");

            string fromdate1 = fdate.ToString("MM-dd-yyyy");

            string Month = datetime1.ToString("MMM");
            string year = datetime1.ToString("yyyy");



            string subfolder = username + "\\" + Month + "-" + year;
            string pathString = System.IO.Path.Combine(folderName, subfolder);
            System.IO.Directory.CreateDirectory(pathString);



            ArrayList rows = new ArrayList();
            ArrayList rowsorignal = new ArrayList();

            DataTable dt = new DataTable();
            //    dt = ARDETAILS.Tables[1].Clone();



            Int32[] selectedRowHandles = view.GetSelectedRows();

            for (int i = 0; i < selectedRowHandles.Length; i++)
            {
                int selectedRowHandle = selectedRowHandles[i];
                if (selectedRowHandle >= 0)
                    rows.Add(view.GetDataRow(selectedRowHandle));
            }

            string customer_number = "";
            string customer_name = "";
            string balance = "";
            string emailid = "";
            string emailstatus = "";
            string EMAIL_STAT = "";

            StreamWriter logwriter = new StreamWriter(pathString + "//" + Month + year + time + "errorlog.txt");

            using (StreamWriter writer = new StreamWriter(pathString + "//" + Month + year + time + "Sucesslog.txt"))
            {
                writer.WriteLine("Month" + "|" + "customer_number" + "|" + "customer_name" + "|" + "balance" + "|" + "Email" + "|" + "STMTStatus" + "|" + "EmailStatus");

                for (int i = 0; i < rows.Count; i++)
                {
                    DataRow row = rows[i] as DataRow;
                    customer_number = row["ACCOUNT_NUMBER"].ToString();
                    customer_name = row["ACCOUNT_NAME"].ToString();
                    balance = row["AMT_REMAINING"].ToString();

                    emailid = row["EMAIL"].ToString();

                    EMAIL_STAT = row["EMAIL_STAT"].ToString();

                    //  emailid = "jshaik@grays.mu";


                    try
                    {
                        //   ordernumber1 = gridView1.GetRowCellValue(gridView1.FocusedRowHandle, "SOURCE_ORDER_NUMBER").ToString();
                        //   orderdate = Convert.ToDateTime(gridView1.GetRowCellValue(gridView1.FocusedRowHandle, "ORDER_DATE").ToString());
                        //  statementfilename = generatestatement(customer_number, fromdate1, pathString, EMAIL_STAT.ToUpper());
                        statementfilename = generatestatement(customer_number, fromdate1, pathString, EMAIL_STAT.ToUpper());


                        tbcount.Text = i.ToString();
                        try
                        {

                            string Body3 = "First Line" + " < br />" + " second line";



                            string body1 = "Dear Sir/Madam \r\n," + ":" + Environment.NewLine +
                            "Kindly ignore previous Customer Statement email sent today and please consider this one.\n\n" + Environment.NewLine +
                            "Please find attached your Statement of Account.\n\n" + Environment.NewLine;
                            string body2 = "Kindly ignore this mail if payment already effected after statement ending date.\n\n" + Environment.NewLine;


                            //emailstatus = sendEMailThroughOUTLOOK(emailid, "Dear Sir/Madam \n\n," + Environment.NewLine +
                            //    " Please find attached your Statement of Account for Jan-19 and Feb-19 periods.\n\n" + Environment.NewLine +
                            //     "Kindly ignore this mail if payment already effected after statement ending date.\n\n" + Environment.NewLine +
                            //    "Sincerely,\n" +
                            //    " Accounts Receivables Department.\n" +
                            //    "Grays Inc", "Grays Inc Ltd - Your Customer Statement", statementfilename, "");
                            // string body = 


                            if (EMAIL_STAT.ToUpper() == "YES")
                            {
                                if (businessunit == "300000004907002")
                                {

                                    emailstatus = sendEMailThroughOUTLOOK(emailid, Body3,
                                        "Sugarworld Ltd  - Your Customer Statement", statementfilename, "", customer_number, customer_name);

                                }
                                else

                                {
                                    emailstatus = sendEMailThroughOUTLOOK(emailid, Body3,
                      "Grays Inc Ltd - Your Customer Statement", statementfilename, "", customer_number, customer_name);

                                }
                            }
                            else
                            {
                                emailstatus = "SUCCESS"
;
                            }

                            if (emailstatus == "SUCCESS")
                            {
                                if (EMAIL_STAT.ToUpper() == "NO")
                                {

                                    writer.WriteLine(Month + "-" + year + "|" + customer_number + "|" + customer_name + "|" + balance + "|" + emailid + "|" + "STMT SUCCESS" + "|" + " SEND BY POST");

                                }
                                else
                                {
                                    writer.WriteLine(Month + "-" + year + "|" + customer_number + "|" + customer_name + "|" + balance + "|" + emailid + "|" + "STMT SUCCESS" + "|" + "EMAIL SUCCESS");

                                }
                            }
                            else
                            {
                                logwriter.WriteLine(Month + "-" + year + "|" + customer_number + "|" + customer_name + "|" + balance + "|" + emailid + "|" + "STMT SUCCESS" + "|" + "EMAIL ERROR");

                            }
                        }
                        catch (Exception er)
                        {
                            logwriter.WriteLine(Month + "-" + year + "|" + customer_number + "|" + customer_name + "|" + balance + "|" + emailid + "|" + "STMT SUCCESS" + "|" + "EMAIL ERROR");
                        }
                    }
                    catch (Exception)
                    {
                        logwriter.WriteLine(Month + "-" + year + "|" + customer_number + "|" + customer_name + "|" + balance + "|" + emailid + "|" + "STMT ERROR" + "|" + "EMAIL ERROR");
                    }




                    // object[] obj = row.ItemArray;

                    //  pricelist = row["NAME"].ToString();

                    //    addtogrid(row);

                }

            }
            logwriter.Close();


        }

        private void openFileToolStripMenuItem_Click(object sender, EventArgs e)
        {
            fileopen("statement");
        }

        public void fileopen(string type)
        {
            OpenFileDialog ofd = new OpenFileDialog();
            System.Windows.Forms.DialogResult dr = ofd.ShowDialog();



            if (dr == DialogResult.OK)

            {
                readfiletogrid(ofd.FileName);
            }
            try
            {
                SplashScreenManager.ShowForm(typeof(WaitForm1));
            }
            catch (Exception e5)
            {

            }




            SplashScreenManager.CloseForm();
        }

        public void readfiletogrid(string filename)
        {

            helperclass helper = null;
            helper = new helperclass();

            System.IO.StreamReader file = new System.IO.StreamReader(filename);
            string[] columnnames = file.ReadLine().Split('|');
            DataTable dt = new DataTable();
            foreach (string c in columnnames)
            {
                dt.Columns.Add(c);
            }
            string newline;
            while ((newline = file.ReadLine()) != null)
            {
                DataRow dr = dt.NewRow();
                string[] values = newline.Split('|');
                for (int i = 0; i < values.Length; i++)
                {
                    dr[i] = values[i];
                }
                dt.Rows.Add(dr);
            }
            file.Close();

            DataSet ds = new DataSet();
            ds.Tables.Add(dt);

            helper.setgridproperties_new(ds, gridView8, gridControl8, "", helper.getnumbercharcols(dt, "N"), "paint", helper.getnumbercharcols(dt, "C"), spreadsheetControl1);

            //  gridControl8.DataSource = dt;

        }
        string singlestatementfilename = "";

        public void openstatementlayout(string username, string customernumber, DateTime fdate)
        {

            string folderName = @"c:\fusion\statements\";

            DateTime datetime1 = DateTime.Now;


            //string fromdate1 = fdate.ToString("yyyy-MM-dd");

            string fromdate1 = fdate.ToString("MM-dd-yyyy");


            string subfolder = username + "\\" + fromdate1;
            string pathString = System.IO.Path.Combine(folderName, subfolder);
            System.IO.Directory.CreateDirectory(pathString);

            string ordernumber1 = null;

            DateTime orderdate;
            try
            {
                //   ordernumber1 = gridView1.GetRowCellValue(gridView1.FocusedRowHandle, "SOURCE_ORDER_NUMBER").ToString();
                //   orderdate = Convert.ToDateTime(gridView1.GetRowCellValue(gridView1.FocusedRowHandle, "ORDER_DATE").ToString());

                singlestatementfilename = generatestatement(customernumber, fromdate1, pathString, "");
                tbtoemail.Text = tbemail1.Text;

                //tbsubject.Text = "Grays Inc Payment Receipt";
                //rtbody.Text = "Dear Sir/Madam " + "\r\n" + Environment.NewLine +

                //               " Please find attached receipt for your Payemnt ." + "\r\n" + Environment.NewLine +
                //               " Kindly ignore this mail if you have already received the receipt." + "\r\n" + Environment.NewLine +


                //                "Sincerely, " + "\r\n" + Environment.NewLine +
                //                "Accounts Receivables Department," + "\r\n" + Environment.NewLine +
                //                "Grays Inc";

                pdfViewer1.LoadDocument(singlestatementfilename);
                flyoutPanel16.Height = 700;
                flyoutPanel16.OwnerControl = panel1;
                flyoutPanel16.ShowPopup();
            }
            catch (Exception e4)
            {
                singlestatementfilename = "";
            }


        }


        public string generatereceipt(string receiptnumber)
        {

            string folderName = @"c:\fusion\receipts\";

            DateTime datetime1 = DateTime.Now;
            DateTime fdate = DateTime.Now;
            string time = datetime1.ToString("h mm tt");

            string fromdate1 = fdate.ToString("MM-dd-yyyy");

            //string fromdate1 = fdate.ToString("yyyy-MM-dd");

            // string fromdate1 = fdate.ToString("MM-dd-yyyy");

            string Month = datetime1.ToString("MMM");
            string year = datetime1.ToString("yyyy");



            string subfolder = user + "\\" + Month + "-" + year;
            string pathString = System.IO.Path.Combine(folderName, subfolder);
            System.IO.Directory.CreateDirectory(pathString);

            FusionRunReport report = null;
            report = new FusionRunReport();
            Fusion_Integration help = new Fusion_Integration();
            string filename = null;
            helperclass helper = null;
            helper = new helperclass();

            if (instance_name == "TEST")
            {

                filename = report.runreport_parameter_pdf
              ("/Custom/OQ/AR/RECEIPT/AR_RECEIPT_PDF_REP.xdo", "shaik", "fusion1234", receiptnumber, Bu_name, "P_REC_NUM", "P_ORG_NAME",
              filename, folderName);

            }
            else
            {

                filename = prodreport.runreport_parameter_pdf
               ("/Custom/OQ/AR/RECEIPT/AR_RECEIPT_PDF_REP.xdo", "shaik", "fusion1234", receiptnumber, Bu_name, "P_REC_NUM", "P_org_name",
              filename, folderName);

            }

            return filename;

        }

        public string generatestatement(string customer_number, string fromdate, string folderName, string Email_Status)
        {
            //string folderName = @"c:\fusion\";

            //DateTime datetime1 = DateTime.Now;


            //string fromdate1 = datetime1.ToString("yyyy-MM-dd");

            //string subfolder = username + "\\" + fromdate1;
            //string pathString = System.IO.Path.Combine(folderName, subfolder);
            //System.IO.Directory.CreateDirectory(pathString);

            DateTime datetime1 = DateTime.Now;

            string Month = datetime1.ToString("MMM");
            string year = datetime1.ToString("yyyy");

            FusionRunReport report = null;
            report = new FusionRunReport();
            Fusion_Integration help = new Fusion_Integration();
            string filename = null;
            helperclass helper = null;
            helper = new helperclass();

            string stfilename = "";
            if (Email_Status == "YES")
            {
                stfilename = "EMAILSTMT-" + Month + "-" + year + "-";
            }
            else
            {
                stfilename = "POSTSTMT-" + Month + "-" + year + "-";
            }

            string ordernumber1 = null;
            DateTime orderdate;
            try
            {

                // string ordertype = cbpordertype.SelectedItem.ToString();
                //  string fromdate1 = orderdate.ToString("yyyy-MM-dd");
                //string todate1 = orderdate.ToString("yyyy-MM-dd");
                if (instance_name == "TEST")
                {

                    filename = report.runreport_parameter_pdf
                  ("/Custom/OQ/Customer Stmt/Customer_Statement_Rep.xdo", "shaik", "fusion1234", customer_number, fromdate, "p_cust_no", "p_date_fr",
                  stfilename, folderName);



                }
                else if (instance_name == "PROD")
                {

                    if (businessunit == "300000004907002")
                    {
                        filename = prodreport.runreport_parameter_pdf_n
              ("/Custom/OQ/Customer Stmt/SW_Customer_Statement.xdo", "shaik", "fusion1234",
              customer_number, fromdate, businessunit, "", "",
              "p_cust_no", "p_date_fr", "BUSINESS_UNIT_ID", "", "",
              stfilename, folderName);

                    }
                    else
                    {

                        filename = prodreport.runreport_parameter_pdf_n
                  ("/Custom/OQ/Customer Stmt/Customer_Statement_Rep.xdo", "shaik", "fusion1234",
                  customer_number, fromdate, businessunit, "", "",
                  "p_cust_no", "p_date_fr", "BUSINESS_UNIT_ID", "", "",
                  stfilename, folderName);
                    }

                }



            }
            catch (Exception e8)
            {
                MessageBox.Show("Error in Printing", "error");
            }

            return filename;
        }


        private void menuStrip6_ItemClicked(object sender, ToolStripItemClickedEventArgs e)
        {

        }

        private void simpleButton18_Click(object sender, EventArgs e)
        {

        }

        private void flyoutPanel16_ButtonClick(object sender, DevExpress.Utils.FlyoutPanelButtonClickEventArgs e)
        {

            string status = "";
            if (e.Button.Caption == "SEND EMAIL")
            {
                status = sendEMailThroughOUTLOOK(tbtoemail.Text, rtbody.Text, tbsubject.Text, singlestatementfilename, tbsubject.Text,
                    tbs2customernumber.Text, tbs2customername.Text);

                if (status == "SUCCESS")
                {
                    MessageBox.Show("Email Sent", "info");
                    //  flyoutPanel16.HideBeakForm();
                }
                else
                {
                    MessageBox.Show("Error Check email address and resend", "info");
                }

            }
            else if (e.Button.Caption == "CANCEL")
            {
                flyoutPanel16.HideBeakForm();

            }

        }

        private void flyoutPanel25_ButtonClick(object sender, DevExpress.Utils.FlyoutPanelButtonClickEventArgs e)
        {
            if (e.Button.Caption == "View Statement")
            {
                openstatementlayout("javeed", tbs2customernumber.Text, Convert.ToDateTime(dateEdit5.EditValue.ToString()));
                flyoutPanel25.HidePopup();
            }
            else
            {
                flyoutPanel25.HidePopup();
            }

        }
        public void openstatementparameterform(GridView view)
        {
            string customer_number = "";
            string customer_name = "";
            string email = "";

            if (view.RowCount > 0)
            {
                customer_number = view.GetRowCellValue(view.FocusedRowHandle, "ACCOUNT_NUMBER").ToString();
                customer_name = view.GetRowCellValue(view.FocusedRowHandle, "ACCOUNT_NAME").ToString();
                try
                {
                    email = view.GetRowCellValue(view.FocusedRowHandle, "EMAIL").ToString();
                }
                catch (Exception E7)
                {
                    email = view.GetRowCellValue(view.FocusedRowHandle, "EMAIL_ADDRESS").ToString();
                }


                tbs2customernumber.Text = customer_number;
                tbs2customername.Text = customer_name;
                tbemail1.Text = email;

                setbody(customer_number, customer_name, email);

                flyoutPanel25.ShowPopup();
            }
        }

        private void viewSingleStatementToolStripMenuItem_Click(object sender, EventArgs e)
        {
            try
            {
                tabPane6.SelectedPageIndex = 0;
                flyoutPanel25.OwnerControl = gridControl7;
                flyoutPanel25.ShowPopup();
                openstatementparameterform(gridView7);
            }
            catch (Exception e8)
            {
                MessageBox.Show(e8.Message, "error");
            }
        }

        private void gridControl7_Click(object sender, EventArgs e)
        {

        }


        public string sendEMailThroughOUTLOOK(string emailid, string body, string subect, string filename, string attname,
            string customernumber, string customername)
        {
            try
            {
                //   var application = new Application();
                // Create the Outlook application.
                Microsoft.Office.Interop.Outlook.Application oApp = new Microsoft.Office.Interop.Outlook.Application();
                // Create a new mail item.
                Microsoft.Office.Interop.Outlook.MailItem oMsg = (Outlook.MailItem)oApp.CreateItem(Outlook.OlItemType.olMailItem);
                // Set HTMLBody. 
                //add the body of the email
                //Outlook.NameSpace session = oMsg.Session;
                //   Outlook.Accounts accounts = oApp.Session.Accounts;//["AR@grays.mu"];

                // Microsoft.Office.Interop.Outlook.Accounts olAccountList;

                //  account.SmtpAddress = "hhuet@grays.mu";
                //oMsg.SendUsingAccount = accounts;

                //string sender = oMsg.SenderName;
                //sender = "Javeed";
                // oMsg.SenderName = sender;
                string body1 = "";

                if (businessunit == "300000004907002")
                {
                    body1 = "Customer Number :" + customernumber + "\r\n" + Environment.NewLine +
                           "Customer Name :" + customername + "\r\n" + Environment.NewLine +
                           "Customer Email :" + emailid + "\r\n" + Environment.NewLine +
                           "\r\n" + Environment.NewLine +
                            "\r\n" + Environment.NewLine +
                           "Dear Sir/Madam ,\r\n" + Environment.NewLine +
                           "Please find attached your Statement of Account.\n\n" + Environment.NewLine +
                           "Kindly ignore this mail if payment is already effected after statement ending date.\n\n" + Environment.NewLine +
                            "Sincerely, \r\n" + Environment.NewLine +
                           "Accounts Receivables Department,\r\n" +
                           "SugarWorld. \r\n" +
                           "               \r\n" +
                           " For any queries please contact please contact  finance1@aventuredusucre.com, \r\n" +
                           " finance1@aventuredusucre.com, finance3@aventuredusucre.com";

                }
                else
                {
                    //  oMsg.HTMLBody = body;
                    body1 = "Customer Number :" + customernumber + "\r\n" + Environment.NewLine +
                                 "Customer Name :" + customername + "\r\n" + Environment.NewLine +
                                 "Customer Email :" + emailid + "\r\n" + Environment.NewLine +
                                 "\r\n" + Environment.NewLine +
                                  "\r\n" + Environment.NewLine +
                                 "Dear Sir/Madam ,\r\n" + Environment.NewLine +
                                 "Please find attached your Statement of Account.\n\n" + Environment.NewLine +
                                 "Kindly ignore this mail if payment is already effected after statement ending date.\n\n" + Environment.NewLine +
                                  "Sincerely, \r\n" + Environment.NewLine +
                                 "Accounts Receivables Department,\r\n" +
                                 "Grays Inc. \r\n" +
                                 "               \r\n" +
                                 "Note: This is an unattended mailbox.Do not reply on this email address.\r\n" +
                                 "      For information about statement please contact AR@grays.mu \r\n" +
                                 "      For information about invoice details  please contact Invoicing@grays.mu";
                }
                // oMsg.HTMLBody = body1 + "\n\n" + body2 + "\n\n" + body3;
                oMsg.HTMLBody = body1.Replace("\r\n", "<br />");
                //oMsg.HTMLBody = body3.Replace("\r\n", "<br />");
                // oMsg.HTMLBody = body1.Replace("\r\n", "<br />");
                //Add an attachment.
                String sDisplayName = attname;
                int iPosition = (int)oMsg.Body.Length + 1;
                int iAttachType = (int)Outlook.OlAttachmentType.olByValue;
                //now attached the file
                Outlook.Attachment oAttach = oMsg.Attachments.Add
                                             (filename, iAttachType, iPosition, sDisplayName);
                //Subject line

                oMsg.Subject = subect + " for Customer:" + customernumber + "-" + customername;
                // Add a recipient.
                Outlook.Recipients oRecips = (Outlook.Recipients)oMsg.Recipients;
                // Change the recipient in the next line if necessary.

                // splitting the email address 
                Outlook.Recipient oRecip = null;
                //   oMsg.SenderEmailAddress = "support@mycompany.com";
                //       oMsg.Sender.Address = new//

                IList<string> names = emailid.Split(',').Reverse().ToList<string>();
                foreach (var item in names)
                {
                    oRecip = (Outlook.Recipient)oRecips.Add(item);
                }

                //Outlook.Recipient oRecip = (Outlook.Recipient)oRecips.Add(emailid);
                oRecip.Resolve();
                // Send.
                //oMsg.Sender = "Javeed";
                oMsg.Send();
                // Clean up.
                oRecip = null;
                oRecips = null;
                oMsg = null;
                oApp = null;
                return "SUCCESS";

                //  MessageBox.Show("You Email Sent ", "Info");
                //flyoutPanel16.HidePopup();

            }//end of try block
            catch (Exception ex)
            {
                return "ERROR";
                //   MessageBox.Show("Error Sending Email", "Info");
            }//end of catch
        }//end of Email Method


        private void flyoutPanel1_ButtonClick(object sender, DevExpress.Utils.FlyoutPanelButtonClickEventArgs e)
        {
            if (e.Button.Caption == "Generate Statement")
            {
                if (tbauthorizecode.Text == "GRSTMT" || tbauthorizecode.Text == "SWSTMT")
                {
                    try
                    {
                        emailstatements(gridView7, Convert.ToDateTime(dateEdit3.EditValue.ToString()), user);
                        flyoutPanel1.HidePopup();
                        tbauthorizecode.Text = "";
                    }
                    catch
                    {

                    }
                }
                else
                {
                    MessageBox.Show("Invalid passcode", "Error");
                    tbauthorizecode.Text = "";
                }

            }
            else
            {
                tbauthorizecode.Text = "";
                flyoutPanel1.HidePopup();
            }

        }

        private void printDraftStatementToolStripMenuItem_Click(object sender, EventArgs e)
        {


            flyoutPanel25.OwnerControl = gridControl3;
            openstatementparameterform(gridView3);
        }

        public void setbody(string customernumber, string customername, string emailid)
        {
            string body1 = "";
            if (businessunit == "300000004907002")
            {
                body1 = "Customer Number :" + customernumber + "\r\n" + Environment.NewLine +
                       "Customer Name :" + customername + "\r\n" + Environment.NewLine +
                       "Customer Email :" + emailid + "\r\n" + Environment.NewLine +
                       "\r\n" + Environment.NewLine +
                        "\r\n" + Environment.NewLine +
                       "Dear Sir/Madam ,\r\n" + Environment.NewLine +
                       "Please find attached your Statement of Account.\n\n" + Environment.NewLine +
                       "Kindly ignore this mail if payment is already effected after statement ending date.\n\n" + Environment.NewLine +
                        "Sincerely, \r\n" + Environment.NewLine +
                       "Accounts Receivables Department,\r\n" +
                       "SugarWorld. \r\n" +
                       "               \r\n" +
                       " For any queries please contact please contact  finance1@aventuredusucre.com, \r\n" +
                       " finance1@aventuredusucre.com, finance3@aventuredusucre.com";

            }
            else
            {
                //  oMsg.HTMLBody = body;
                body1 = "Customer Number :" + customernumber + "\r\n" + Environment.NewLine +
                             "Customer Name :" + customername + "\r\n" + Environment.NewLine +
                             "Customer Email :" + emailid + "\r\n" + Environment.NewLine +
                             "\r\n" + Environment.NewLine +
                              "\r\n" + Environment.NewLine +
                             "Dear Sir/Madam ,\r\n" + Environment.NewLine +
                             "Kindly ignore previous Customer Statement email sent today and please consider this one.\n\n" + Environment.NewLine +
                             "Please find attached your Statement of Account.\n\n" + Environment.NewLine +
                             "Kindly ignore this mail if payment is already effected after statement ending date.\n\n" + Environment.NewLine +
                              "Sincerely, \r\n" + Environment.NewLine +
                             "Accounts Receivables Department,\r\n" +
                             "Grays Inc. \r\n" +
                             "               \r\n" +
                             "Note: This is an unattended mailbox.Do not reply on this email address.\r\n" +
                             "      For information about statement please contact AR@grays.mu \r\n" +
                             "      For information about invoice details  please contact Invoicing@grays.mu";
            }


            rtbody.Text = body1;
        }

        private void flyoutPanel2_ButtonClick(object sender, DevExpress.Utils.FlyoutPanelButtonClickEventArgs e)
        {
            if (e.Button.Caption == "Search")
            {
                try
                {
                    querycustomerbalance();
                    flyoutPanel2.HidePopup();
                }
                catch
                {

                }
            }
            else
            {
                flyoutPanel2.HidePopup();
            }
        }

        RepositoryItemButtonEdit edit2, edit3;

        private void FrmDebtorscontrol_Load(object sender, EventArgs e)
        {
            xtraTabControl1.ShowTabHeader = DevExpress.Utils.DefaultBoolean.False;
            cbbusinessunit.Text = Bu_name;
            label28.Text = instance_name;
            label28.Visible = false;
            xtraTabControl1.SelectedTabPageIndex = 1;
            //tabPane1.SelectedPageIndex = 1;
            tabPane3.SelectedPageIndex = 0;

            //flyoutPanel3.OwnerControl = gridControl2;

            //flyoutPanel3.ShowPopup();
            label48.Text = "Query Receipts";


            edit2 = new RepositoryItemButtonEdit();
            edit2.Assign(repositoryItemButtonEdit1);
            edit2.Buttons[0].Enabled = false;
            edit2.Buttons[0].ToolTip = string.Empty;
            //edit2.Buttons[1].Enabled = true;
            //edit2.Buttons[1].ToolTip = "Issue";

            gridControl16.RepositoryItems.Add(edit2);
            //gridControl16.RepositoryItems.Add(edit3);
            gridControl16.ForceInitialize();

            //tabPane1. ItemSize = new Size(0, 1);

            try
            {
                docin();
            }
            catch
            {

            }

            try
            {
                if (businessunit == "300000004907002")
                {

                    //cbbusinessunit.Items.Clear();
                    cbbusinessunit.Enabled = false;
                }
                else
                {
                    cbbusinessunit.Items.Clear();
                    //cbbusinessunit.Items.Add("SUGARWORLD");
                    cbbusinessunit.Items.Add("GRAYS INC BU");
                    cbbusinessunit.Items.Add("BELLEVUE RUM");
                    cbbusinessunit.Items.Add("GRAYS DISTILLING BU");


                }

            }
            catch (Exception e5)
            {

            }



        }

        private void button1_Click(object sender, EventArgs e)
        {

            if (cbbusinessunit.Text == "GRAYS INC BU")
            {
                businessunit = "300000003234003";
                inventory_org_id = "300000003277749";
                Bu_name = "GRAYS INC BU";
                //  cbsubinventory.Text = "DUTY PAID";
            }
            else if (cbbusinessunit.Text.Contains("GRAYS DISTILLING BU"))
            {

                businessunit = "300000007957224";
                inventory_org_id = "300000003277749";
                Bu_name = "GRAYS DISTILLING BU";
                //  cbsubinventory.Text = "STORES";

            }

            else if (cbbusinessunit.Text == "BELLEVUE RUM")
            {
                businessunit = "300000007957207";
                inventory_org_id = "300000003277749";
                Bu_name = "BELLEVUE RUM BU";
                // cbsubinventory.Text = "STORES";
            }
        }

        private void viewAccountDetailsForMultipleBUToolStripMenuItem_Click(object sender, EventArgs e)
        {
            accountdetails("M");
        }

        private void menuStrip8_ItemClicked(object sender, ToolStripItemClickedEventArgs e)
        {

        }

        private void saveReceiptToolStripMenuItem_Click(object sender, EventArgs e)
        {

        }

        private void applyToolStripMenuItem_Click(object sender, EventArgs e)
        {

        }

        private void unApplyToolStripMenuItem_Click(object sender, EventArgs e)
        {

        }

        private void toolStripMenuItem1_Click(object sender, EventArgs e)
        {

        }

        private void button3_Click(object sender, EventArgs e)
        {
            // mode = "RA";
            tabPane3.SelectedPageIndex = 2;
            if (tbrelatedcust.Text.Length > 0)
            {
                getaccountdetails(tbrelatedcust.Text, "", "RA");

                setcartattributes(gridView14);
            }
            else
            {
                getaccountdetails(tbcustomernumber1.Text, "", "RA");
                setcartattributes(gridView14);
            }

        }

        private void hideHeaderDetailsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            splitContainer1.Panel1Collapsed = true;

        }

        private void showHeaderDetailsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            splitContainer1.Panel1Collapsed = false;
        }

        DataSet DScart = new DataSet("DScart");
        DataSet DSapp = new DataSet("DSapp");


        public void AddtoCart(DevExpress.XtraGrid.Views.Grid.GridView view, string mode)
        {

            helperclass helper = null;
            helper = new helperclass();
            ArrayList rows = new ArrayList();

            //if (mode == "INT")
            //{
            //    view.SelectAll();
            //}


            Int32[] selectedRowHandles = view.GetSelectedRows();

            String status1, status2, status3, status4, status5, status6;

            try
            {

                DScart.Tables.Remove(DTCart);
                //  DTCart.Clear();

            }
            catch (Exception e2)
            { }

            for (int i = 0; i < selectedRowHandles.Length; i++)
            {
                int selectedRowHandle = selectedRowHandles[i];
                if (selectedRowHandle >= 0)
                    rows.Add(view.GetDataRow(selectedRowHandle));
            }

            int rcount = DTCart.Rows.Count;//  rows.Count;


            if (rcount == 0)
            {
                rcount = 1;
            }
            else
            {
                rcount = rcount + 1;
            }

            string LINENO = "";

            //  gridView1.BeginUpdate();
            for (int i = 0; i < rows.Count; i++)
            {
                DataRow row = rows[i] as DataRow;
                // Change the field value.
                //     row["Discontinued"] = true;

                string TRX_NUMBER = row["TRX_NUMBER"].ToString();
                string SALES_ORDER = row["SALES_ORDER"].ToString();
                string SALESREP_NAME = row["SALESREP_NAME"].ToString();
                string SALESREP_NUMBER = row["SALESREP_NUMBER"].ToString();
                string ORDER_TYPE = row["ORDER_TYPE"].ToString();
                DateTime TRX_DATE = Convert.ToDateTime(row["TRX_DATE"].ToString());
                double AMT_ORIGINAL = Convert.ToDouble(row["AMT_ORIGINAL"].ToString());
                double AMT_REMAINING = Convert.ToDouble(row["AMT_REMAINING"].ToString());
                string CUSTOMER_TRX_ID = row["CUSTOMER_TRX_ID"].ToString();
                double AMT_APPLIED = Convert.ToDouble(row["AMT_APPLIED"].ToString());

                LINENO = (rcount + i).ToString();

                try
                {
                    DTCart.Rows.Add(LINENO, "NEW", TRX_NUMBER, SALES_ORDER, SALESREP_NAME, SALESREP_NUMBER, ORDER_TYPE,
                    TRX_DATE, AMT_ORIGINAL, AMT_REMAINING, AMT_APPLIED, CUSTOMER_TRX_ID);
                }
                catch (Exception e5)
                {

                }
                try
                {
                    DScart.Tables.Add(DTCart);
                    helper.setgridproperties_new(DScart, gridView15, gridControl14, "", helper.getnumbercharcols(DTCart, "N"), "nopaint", helper.getnumbercharcols(DTCart, "C"), spreadsheetControl1);
                }
                catch (Exception E6)
                { }
            }
        }



        public void finalapplication(DevExpress.XtraGrid.Views.Grid.GridView view, string mode)
        {

            helperclass helper = null;
            helper = new helperclass();
            ArrayList rows = new ArrayList();

            //if (mode == "INT")
            //{
            //    view.SelectAll();
            //}
            DTapplications.Clear();

            view.SelectAll();

            Int32[] selectedRowHandles = view.GetSelectedRows();

            String status1, status2, status3, status4, status5, status6;



            try
            {

                DSapp.Tables.Remove(DTapplications);
                //  DTCart.Clear();

            }
            catch (Exception e2)
            { }

            for (int i = 0; i < selectedRowHandles.Length; i++)
            {
                int selectedRowHandle = selectedRowHandles[i];
                if (selectedRowHandle >= 0)
                    rows.Add(view.GetDataRow(selectedRowHandle));
            }

            int rcount = DTapplications.Rows.Count;//  rows.Count;


            if (rcount == 0)
            {
                rcount = 1;
            }
            else
            {
                rcount = rcount + 1;
            }

            string LINENO = "";

            //  gridView1.BeginUpdate();
            for (int i = 0; i < rows.Count; i++)
            {
                DataRow row = rows[i] as DataRow;
                // Change the field value.
                //     row["Discontinued"] = true;
                string RST = row["RST"].ToString();

                string TRX_NUMBER = row["TRX_NUMBER"].ToString();
                string SALES_ORDER = row["SALES_ORDER"].ToString();

                string CUSTOMER_TRX_ID = row["CUSTOMER_TRX_ID"].ToString();

                string SALESREP_NAME = row["SALESREP_NAME"].ToString();
                string SALESREP_NUMBER = row["SALESREP_NUMBER"].ToString();

                string ORDER_TYPE = row["ORDER_TYPE"].ToString();
                DateTime TRX_DATE = Convert.ToDateTime(row["TRX_DATE"].ToString());

                double AMT_ORIGINAL = Convert.ToDouble(row["AMT_ORIGINAL"].ToString());
                double AMT_REMAINING = Convert.ToDouble(row["AMT_REMAINING"].ToString());

                double AMT_APPLIED = Convert.ToDouble(row["AMT_APPLIED"].ToString());
                double balance = AMT_ORIGINAL - (Math.Abs(AMT_REMAINING) + Math.Abs(AMT_APPLIED));

                if (RST == "NEW")
                {
                    LINENO = (rcount + i).ToString();
                    try
                    {
                        DTapplications.Rows.Add(LINENO, "NEW", TRX_NUMBER, SALES_ORDER, SALESREP_NAME, SALESREP_NUMBER, ORDER_TYPE,
                        TRX_DATE, AMT_ORIGINAL, AMT_REMAINING, AMT_APPLIED, CUSTOMER_TRX_ID);
                    }
                    catch (Exception e5)
                    {
                        MessageBox.Show(e5.Message);
                    }
                }
            }

            //   DSapp.Tables.Add(DTapplications);
            //            helper.setgridproperties_new(DSapp, gridView15, gridControl14, "", helper.getnumbercharcols(DTapplications, "N"), "nopaint", helper.getnumbercharcols(DTapplications, "C"), spreadsheetControl1);

        }


        public void setcartattributes(GridView view1)
        {
            try
            {
                //DevExpress.XtraGrid.Columns.GridColumn AMT_REMAINING = view1.Columns.ColumnByFieldName("AMT_REMAINING");

                //AMT_REMAINING.OptionsColumn.AllowEdit = true;

                //AMT_REMAINING.AppearanceCell.BackColor = Color.Yellow;

                DevExpress.XtraGrid.Columns.GridColumn AMT_APPLIED = view1.Columns.ColumnByFieldName("AMT_APPLIED");
                view1.OptionsBehavior.ReadOnly = false;

                AMT_APPLIED.OptionsColumn.AllowEdit = true;
                AMT_APPLIED.OptionsColumn.ReadOnly = false;


                AMT_APPLIED.AppearanceCell.BackColor = Color.Yellow;
            }
            catch
            {

            }

        }

        private void editReceiptToolStripMenuItem_Click(object sender, EventArgs e)
        {
            editreceipt();
        }

        public void editreceipt()
        { 
            try
            {
                DScart.Clear();
                gridControl13.DataSource = null;
                gridView14.RefreshData();
                gridControl14.DataSource = null;
                gridView15.RefreshData();

                tbreceiptamount2.Text = "";
                tbappliedamount2.Text = "";
                tbselectedamount1.Text = "";
                tbunapplied2.Text = "";

                tbcustomername1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "CUSTOMER_NAME").ToString();
                tbcustomernumber1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "ACCOUNT_NUMBER").ToString();
                tbreceiptmethod1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "RECEIPT_METHOD").ToString();
                string PAYMENT_METHOD = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "PAYMENT_METHOD").ToString();
                tbreceiptnumber1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "RECEIPT_NUMBER").ToString();
                string COMMENTS = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "COMMENTS").ToString();
                tbreceiptdate1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "RECEIPT_DATE").ToString();
                string RECEIPT_MONTH = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "RECEIPT_MONTH").ToString();
                string RECEIPT_YEAR = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "RECEIPT_YEAR").ToString();
                string ACCOUNTING_DATE = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "ACCOUNTING_DATE").ToString();
                string INVOICE_CURRENCY_CODE = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "INVOICE_CURRENCY_CODE").ToString();
                tbstatus2.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "STATUS").ToString();
                string DEPOSIT_DATE = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "DEPOSIT_DATE").ToString();
                string STATE = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "STATE").ToString();
                string BU_NAME = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "BU_NAME").ToString();
                string DUE_DATE = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "DUE_DATE").ToString();
                string BANKING_REFNO = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "BANKING_REFNO").ToString();
                string BANKED_AT_HO = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "BANKED_AT_HO").ToString();
                tblodgementref1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "LODGEMENTREF").ToString();

                tbcashreceiptid1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "CASH_RECEIPT_ID").ToString();

                tbreceiptamount1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "AMOUNT").ToString();

                tbreceiptamount1.Text = string.Format("{0:n}", Convert.ToDouble(tbreceiptamount1.Text));

                string ACCTD_AMOUNT = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "ACCTD_AMOUNT").ToString();

                tbappliedamount1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "AMOUNT_APPLIED").ToString();

                tbappliedamount1.Text = string.Format("{0:n}", Convert.ToDouble(tbappliedamount1.Text));

                tbunappliedamount1.Text = (Convert.ToDouble(tbreceiptamount1.Text) + Convert.ToDouble(tbappliedamount1.Text)).ToString();

                tbunappliedamount1.Text = string.Format("{0:n}", Convert.ToDouble(tbunappliedamount1.Text));

                //getreceiptdetails(tbreceiptnumber1.Text);
                getreceiptdetails(tbcashreceiptid1.Text);
                totals();
                setcartattributes(gridView15);

                tabPane3.SelectedPageIndex = 2;

                //            tbstatus2
                //tbcustomernumber1
                //tbcustomername1
                //tbreceiptdate1
                //tbappliedamount1
                //tbreceiptnumber1
                //tbreceiptmethod1
                //tbcurrency1
                //tbreceiptamount1
            }
            catch (Exception e7)
            {
                MessageBox.Show(e7.Message, "error");
            }


        }

        private void applyToolStripMenuItem1_Click(object sender, EventArgs e)
        {
            try
            {
                AddtoCart(gridView14, "");

            }
            catch (Exception E8)
            {
                MessageBox.Show("Error adding to cart", "info");
            }
            try
            {
                DeleteSelectedRows(gridView14, "ADD");
            }
            catch
            {
                MessageBox.Show("Error deleting ", "info");
            }
            try
            {
                totals();
            }
            catch
            {
                MessageBox.Show("Error in totals", "info");
            }
            try
            {
                setcartattributes(gridView15);
            }
            catch
            {
                MessageBox.Show("Error in attributes", "info");
            }
        }


        public void totals()
        {

            try
            {
                double RECEIPT_AMOUNT = 0;
                double AMOUNT_APPLIED = 0;
                double AMT_REMAINING = 0;
                double balance = 0;

                // tbreceiptamount1.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "AMOUNT").ToString();
                // RECEIPT AMOUNT 
                tbreceiptamount2.Text = tbreceiptamount1.Text;
                RECEIPT_AMOUNT = Convert.ToDouble(tbreceiptamount1.Text);
                tbreceiptamount2.Text = string.Format("{0:n}", Convert.ToDouble(tbreceiptamount2.Text));

                // selected amount 
                //AMT_REMAINING = Convert.ToDouble(gridView15.Columns["AMT_REMAINING"].SummaryItem.SummaryValue.ToString());
                //tbselectedamount1.Text = AMT_REMAINING.ToString();
                //tbselectedamount1.Text = string.Format("{0:n}", Convert.ToDouble(tbselectedamount1.Text));

                // AMOUNT APPLIED
                AMOUNT_APPLIED = Convert.ToDouble(gridView15.Columns["AMT_APPLIED"].SummaryItem.SummaryValue.ToString());

                tbappliedamount2.Text = (Convert.ToDouble(AMOUNT_APPLIED)).ToString();
                //   AMOUNT_APPLIED = Convert.ToDouble(tbappliedamount1.Text);
                tbappliedamount2.Text = string.Format("{0:n}", Convert.ToDouble(tbappliedamount2.Text));

                // BALANCE
                balance = RECEIPT_AMOUNT - Math.Abs(AMOUNT_APPLIED);
                tbunapplied2.Text = balance.ToString();
                tbunapplied2.Text = string.Format("{0:n}", Convert.ToDouble(tbunapplied2.Text));
            }
            catch
            {

            }
        }

        private void DeleteSelectedRows(DevExpress.XtraGrid.Views.Grid.GridView view, string mode)
        {

            try
            {
                if (view == null || view.SelectedRowsCount == 0) return;
                DataRow[] rows = new DataRow[view.SelectedRowsCount];
                for (int i = 0; i < view.SelectedRowsCount; i++)
                    rows[i] = view.GetDataRow(view.GetSelectedRows()[i]);
                view.BeginSort();
                try
                {
                    foreach (DataRow row in rows)
                    {
                        if (mode == "APP")
                        {
                            string RST = row["RST"].ToString();
                            //    if (RST == "NEW")
                            //  {                         //     DT.Rows[i]["TRX_NUMBER"].ToString();
                            row.Delete();
                            // }
                        }
                        else
                        {
                            row.Delete();
                        }
                    }
                }
                finally
                {
                    view.EndSort();
                }
            }
            catch
            {

            }

        }

        private void textBox4_TextChanged(object sender, EventArgs e)
        {

        }

        private void textBox2_TextChanged(object sender, EventArgs e)
        {

        }

        private void unApplyToolStripMenuItem1_Click(object sender, EventArgs e)
        {
            var result = XtraMessageBox.Show("Do you Want to remove lines ?", "Confirmation", MessageBoxButtons.YesNo);
            //     DXDialog dlg = new DXDialog();

            // IF 1
            if (result.ToString() == "Yes")
            {
                DeleteSelectedRows(gridView15, "APP");
                totals();
            }

        }

        private void retriveApplicationsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            var result = XtraMessageBox.Show("Do you Want to retrive lines ?", "Confirmation", MessageBoxButtons.YesNo);

            // IF 1
            if (result.ToString() == "Yes")
            {
                //getreceiptdetails(tbreceiptnumber1.Text);

                getreceiptdetails(tbcashreceiptid1.Text);

                totals();
                setcartattributes(gridView15);
            }
        }


        public void addapplicationtodt(DataSet ds1)
        {
            DTCart.Clear();

            foreach (DataRow row in ds1.Tables[1].Rows)
            {

                string LINENO = row["LINENO"].ToString();
                string RST = row["RST"].ToString();
                string TRX_NUMBER = row["TRX_NUMBER"].ToString();
                string SALES_ORDER = row["SALES_ORDER"].ToString();
                string SALESREP_NAME = row["SALESREP_NAME"].ToString();
                string SALESREP_NUMBER = row["SALESREP_NUMBER"].ToString();
                string ORDER_TYPE = row["ORDER_TYPE"].ToString();
                DateTime TRX_DATE = Convert.ToDateTime(row["TRX_DATE"].ToString());
                double AMT_ORIGINAL = Convert.ToDouble(row["AMT_ORIGINAL"].ToString());
                double AMT_REMAINING = Convert.ToDouble(row["AMT_REMAINING"].ToString());
                double AMT_APPLIED = Convert.ToDouble(row["AMT_APPLIED"].ToString());

                DTCart.Rows.Add(LINENO, RST, TRX_NUMBER, SALES_ORDER, SALESREP_NAME, SALESREP_NUMBER, ORDER_TYPE,
                 TRX_DATE, AMT_ORIGINAL, AMT_REMAINING, AMT_APPLIED);
            }


        }


        private void applyReceiptToolStripMenuItem_Click(object sender, EventArgs e)
        {
            //  DTCart.Clear();
            //AddtoCart(gridView15,"INT");

            var result = XtraMessageBox.Show("Do you Want to apply the reciept ?", "Confirmation", MessageBoxButtons.YesNo);

            // IF 1
            if (result.ToString() == "Yes")
            {
                totals();


                double unapplied1 = Convert.ToDouble(tbunappliedamount1.Text);
                double balance = Convert.ToDouble(tbunapplied2.Text);

                if (balance >= 0)
                {
                    //tbunapplied2
                    //tbunappliedamount1


                    finalapplication(gridView15, "INT");
                    setcartattributes(gridView15);

                    Fusion_Integration fusion = new Fusion_Integration();
                    DateTime appdate;
                    string appdate1;

                    try
                    {
                        appdate = Convert.ToDateTime(dateEditapplicationdate.EditValue.ToString());
                        appdate1 = appdate.ToString("yyyy-MM-dd");

                        // string checking the application date

                        string date_st = validateapplicationdate(gridView15);

                        //Properties.Settings.Default.password

                        if (date_st == "PASS")
                        {

                            string status = fusion.applyreceipt(Properties.Settings.Default.username, Properties.Settings.Default.password, instance_name, DTapplications, tbreceiptnumber1.Text, appdate1, tbcashreceiptid1.Text, tbcustomername1.Text);

                            if (status == "SUCCESS")
                            {
                                MessageBox.Show("Receipt Applied Successfully", "info");
                            }
                        }
                    }
                    catch
                    {
                        MessageBox.Show("Select the application date", "info");
                    }

                }

                else
                {
                    MessageBox.Show("Total Applied amount is less than the available balance , Adjust the amount and try again", "info");
                }

            }

        }

        private void refreshTotalsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            try
            {
                totals();
            }
            catch
            {

            }
        }

        private void saveLayoutToolStripMenuItem_Click(object sender, EventArgs e)
        {
            label24.Text = savelayout(pivotGridControl4);
        }

        private void restoreLayoutToolStripMenuItem_Click(object sender, EventArgs e)
        {
            label24.Text = restorelayout(pivotGridControl4);
        }

        public string restorelayout(PivotGridControl pvt)
        {
            string filename = "";

            OpenFileDialog openFileDialog1 = new OpenFileDialog
            {
                //  InitialDirectory = @"D:\",
                Title = "Browse Pivot grid layouts",

                CheckFileExists = true,
                CheckPathExists = true,

                DefaultExt = "xml",
                Filter = "pivot grid layouts (*.xml)|*.xml",
                FilterIndex = 2,
                RestoreDirectory = true,

                ReadOnlyChecked = true,
                ShowReadOnly = true
            };

            if (openFileDialog1.ShowDialog() == DialogResult.OK)
            {
                filename = openFileDialog1.FileName;
                //  label66.Text = filename;
            }



            pvt.ForceInitialize();
            pvt.RestoreLayoutFromXml(filename, OptionsLayoutBase.FullLayout);
            // pivotGridControl8.res

            return filename;
        }


        public string savelayout(PivotGridControl pvt)
        {
            string filename = "";
            //pivotGridControl8.SaveLayoutToXml(filename,OptionsLayoutBase.FullLayout);
            try
            {
                SaveFileDialog saveFileDialog1 = new SaveFileDialog();
                // saveFileDialog1.InitialDirectory = @ "C:\";      
                saveFileDialog1.Title = "Pivot Grid Layout Files";
                //saveFileDialog1.CheckFileExists = true;
                //saveFileDialog1.CheckPathExists = true;
                saveFileDialog1.DefaultExt = "xml";
                saveFileDialog1.Filter = "XML files(.xml)|*.xml|all Files(TB.*)|*.*";
                saveFileDialog1.FilterIndex = 1;
                //saveFileDialog1.RestoreDirectory = true;

                if (saveFileDialog1.ShowDialog() == DialogResult.OK)
                {
                    filename = saveFileDialog1.FileName;
                    //label66.Text = filename;
                }
            }
            catch
            {
                MessageBox.Show("Error in save file dialog box", "error");
            }

            try
            {
                pvt.SaveLayoutToXml(filename, OptionsLayoutBase.FullLayout);
            }
            catch
            {
                MessageBox.Show("Error in saving layout", "error");
            }

            return filename;

        }

        private void restoreLayoutToolStripMenuItem1_Click(object sender, EventArgs e)
        {
            label26.Text = restorelayout(pivotGridControl3);
        }

        private void saveLayoutToolStripMenuItem1_Click(object sender, EventArgs e)
        {

            label26.Text = savelayout(pivotGridControl3);

        }

        private void saveLayoutToolStripMenuItem2_Click(object sender, EventArgs e)
        {
            label25.Text = savelayout(pivotGridControl5);
        }

        private void restoreLayoutToolStripMenuItem2_Click(object sender, EventArgs e)
        {
            label25.Text = restorelayout(pivotGridControl5);
        }

        private void showRowTotalsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            pivotGridControl4.OptionsView.ShowRowTotals = true;

        }

        private void hideRowTotalsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            pivotGridControl4.OptionsView.ShowRowTotals = false;
        }


        public string validateapplicationdate(GridView view)
        {

            string DateStatus = "PASS";
            helperclass helper = null;
            helper = new helperclass();
            ArrayList rows = new ArrayList();

            //if (mode == "INT")
            //{
            //    view.SelectAll();
            //}


            Int32[] selectedRowHandles = view.GetSelectedRows();

            String status1, status2, status3, status4, status5, status6;

            DateTime appdate = Convert.ToDateTime(dateEditapplicationdate.EditValue.ToString());
            String appdate1 = appdate.ToString("yyyy-MM-dd");


            for (int i = 0; i < selectedRowHandles.Length; i++)
            {
                int selectedRowHandle = selectedRowHandles[i];
                if (selectedRowHandle >= 0)
                    rows.Add(view.GetDataRow(selectedRowHandle));
            }
            for (int i = 0; i < rows.Count; i++)
            {
                DataRow row = rows[i] as DataRow;
                // Change the field value.
                //     row["Discontinued"] = true;

                string TRX_NUMBER = row["TRX_DATE"].ToString();

                DateTime trx_date = Convert.ToDateTime(TRX_NUMBER);

                if (appdate < trx_date)
                {
                    MessageBox.Show("Application Date should not be less than Invoice Date ", "error");
                    DateStatus = "FAILED";
                    break;
                }

            }

            return DateStatus;

        }

        public void getpaymentmethod(DevExpress.XtraGrid.Views.Grid.GridView view)
        {
            helperclass helper = null;
            helper = new helperclass();
            ArrayList rows = new ArrayList();

            //if (mode == "INT")
            //{
            //    view.SelectAll();
            //}


            Int32[] selectedRowHandles = view.GetSelectedRows();

            String status1, status2, status3, status4, status5, status6;

            try
            {

                DScart.Tables.Remove(DTCart);
                //  DTCart.Clear();

            }
            catch (Exception e2)
            { }

            for (int i = 0; i < selectedRowHandles.Length; i++)
            {
                int selectedRowHandle = selectedRowHandles[i];
                if (selectedRowHandle >= 0)
                    rows.Add(view.GetDataRow(selectedRowHandle));
            }

            int rcount = DTCart.Rows.Count;//  rows.Count;

            if (rcount == 0)
            {
                rcount = 1;
            }
            else
            {
                rcount = rcount + 1;
            }

            string LINENO = "";

            //  gridView1.BeginUpdate();
            for (int i = 0; i < rows.Count; i++)
            {
                DataRow row = rows[i] as DataRow;
                // Change the field value.
                //     row["Discontinued"] = true;

                // string TRX_NUMBER = row["TRX_NUMBER"].ToString();
                string SALES_ORDER = row["SALES_ORDER"].ToString();
                try
                {
                    row["PAYMENT_METHOD"] = getabspaymentmode(SALES_ORDER);
                    string result = getabspaymentmode(SALES_ORDER);

                    IList<string> names = result.Split('-').ToList<string>();
                    int i1 = 1;
                    foreach (var item in names)
                    {
                        if (i1 == 1)
                        {
                            row["PAYMENT_METHOD"] = item.ToString();
                            i1 = 2;
                        }
                        else if (i1 == 2)
                        {
                            row["ABS_ORDER_AMOUNT"] = item.ToString();

                        }
                    }


                }
                catch
                {
                    row["PAYMENT_METHOD"] = "Error";
                }

            }

        }

        public string getabspaymentmode(string order)
        {
            try
            {
                string mode = "";

                DataSet ds = new DataSet();
                string sql = "select paytype+'-'+ cast(totalamount as varchar) from vwSalesTrn1  where transno = '" + order + "'";

                SqlDataAdapter adapt = new SqlDataAdapter(sql, abscon);
                adapt.Fill(ds);


                try
                {
                    DataTable DTptlist = ds.Tables[0];


                    foreach (DataRow row in DTptlist.Rows)
                    {
                        mode = row["column1"].ToString();
                    }
                }
                catch
                {
                    mode = "";
                }
                return mode;
            }
            catch
            {
                return "";
            }
        }

        private void FrmDebtorscontrol_FormClosing(object sender, FormClosingEventArgs e)
        {
            var result = XtraMessageBox.Show("Do you want Close the Screen?", "Confirmation", MessageBoxButtons.YesNo);

            if (result.ToString() == "Yes")
            {

            }
            else
            {
                e.Cancel = true;
            }
        }
        private void getPaymentTermsFromABSToolStripMenuItem_Click(object sender, EventArgs e)
        {
            try
            {
                getpaymentmethod(gridView14);
            }
            catch
            {
                MessageBox.Show("Error Getting the details");
            }
        }

        private void flyoutPanel4_ButtonClick(object sender, FlyoutPanelButtonClickEventArgs e)
        {
            if (e.Button.Caption == "Search")
            {
                try
                {
                    getomarrecon();
                    flyoutPanel4.HidePopup();
                }
                catch
                {

                }

            }
            else
            {
                flyoutPanel4.HidePopup();
            }
        }

        private void menuStrip9_ItemClicked(object sender, ToolStripItemClickedEventArgs e)
        {

        }

        public void docin()
        {
            try
            {
                pivotGridControl1.OptionsBehavior.CopyToClipboardWithFieldValues = true;
                pivotGridControl2.OptionsBehavior.CopyToClipboardWithFieldValues = true;
                pivotGridControl3.OptionsBehavior.CopyToClipboardWithFieldValues = true;
                pivotGridControl4.OptionsBehavior.CopyToClipboardWithFieldValues = true;
                pivotGridControl5.OptionsBehavior.CopyToClipboardWithFieldValues = true;
            }
            catch
            {

            }

            tabPane1.Dock = System.Windows.Forms.DockStyle.Fill;
            tabPane2.Dock = System.Windows.Forms.DockStyle.Fill;

            tabPane3.Dock = System.Windows.Forms.DockStyle.Fill;
            tabPane4.Dock = System.Windows.Forms.DockStyle.Fill;

            tabPane5.Dock = System.Windows.Forms.DockStyle.Fill;
            tabPane6.Dock = System.Windows.Forms.DockStyle.Fill;

            //  tabPane8.Dock = System.Windows.Forms.DockStyle.Fill;
            //tabPane9.Dock = System.Windows.Forms.DockStyle.Fill;


            //tabPane17.Dock = System.Windows.Forms.DockStyle.Fill;
            //tabPane18.Dock = System.Windows.Forms.DockStyle.Fill;
            //tabPane19.Dock = System.Windows.Forms.DockStyle.Fill;



        }




        private void refreshDataToolStripMenuItem_Click(object sender, EventArgs e)
        {
            helperclass helper = null;
            helper = new helperclass();

            FusionRunReport report = null;

            report = new FusionRunReport();

            GraysProdReporting Preport = null;

            try
            {
                DataTable DTdebtors = DSomar.Tables[1];

                helper.setgridproperties_new(DSomar, gridView1, gridControl1, "Analysis", helper.getnumbercharcols(DTdebtors, "N"), "nopaint", helper.getnumbercharcols(DTdebtors, "C"), spreadsheetControl1);

            }
            catch
            {

            }
        }

        private void openFlyoutToolStripMenuItem_Click(object sender, EventArgs e)
        {
            flyoutPanel12.Height = 700;
            flyoutPanel12.ShowPopup();
        }

        string fromwhere = "";
        private void searchParametersToolStripMenuItem_Click(object sender, EventArgs e)
        {
            //  fromwhere = "APPLICAITONS";
            flyoutPanel3.OwnerControl = gridControl10;
            flyoutPanel3.ShowPopup();

        }



        public void queryreceiptapplications()
        {

            helperclass helper = null;
            helper = new helperclass();

            FusionRunReport report = null;

            report = new FusionRunReport();

            GraysProdReporting Preport = null;
            Preport = new GraysProdReporting();

            businessunit = Properties.Settings.Default.businessunitid;

            // GETTING RECEIPTS FROM FUSION 
            //  if (dateEdit2.EditValue != null && dateEdit1.EditValue != null)

            DateTime fromdate;
            DateTime todate;
            string fromdate1 = "";
            string todate1 = "";

            try
            {

                fromdate = Convert.ToDateTime(dateEdit2.EditValue.ToString());
                todate = Convert.ToDateTime(dateEdit1.EditValue.ToString());
                fromdate1 = fromdate.ToString("yyyy-MM-dd");
                todate1 = todate.ToString("yyyy-MM-dd");
            }
            catch
            {

            }

            string status = null;

            report = new FusionRunReport();
            //DataSet DSreceipts = new DataSet();
            DSreceiptapplications = new DataSet();


            if (instance_name == "TEST")
            {

                DSreceiptapplications = report.runreport_parameter_new_10("/Custom/DEXPRESS/Receivables/AR_RECEIPT_APPLICATIONS_BIP.xdo",
                        "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbsalesordernumber2.Text, tbcustomernumber2.Text, tbfromamount.Text, tbtoamount.Text, "",
                                          "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "ORDER_NUMBER", "ACCOUNT_NUMBER", "FROM_AMOUNT", "TO_AMOUNT", "");
            }
            else if (instance_name == "PROD")
            {
                DSreceiptapplications = Preport.runreport_parameter_new_10("/Custom/DEXPRESS/Receivables/AR_RECEIPT_APPLICATIONS_BIP.xdo",
                                          "shaik", "fusion1234", fromdate1, todate1, businessunit, textBoxcustomername.Text, tbreceiptnumber3.Text, tbsalesordernumber2.Text, tbcustomernumber2.Text, tbfromamount.Text, tbtoamount.Text, "",
                                          "FROM_DATE", "TO_DATE", "ORG_ID", "CUSTOMER_NAME", "BANKREF", "ORDER_NUMBER", "ACCOUNT_NUMBER", "FROM_AMOUNT", "TO_AMOUNT", "");

            }


            //try
            //{
            //    DataTable DTreceiptsapp = DSreceiptapplications.Tables[1];


            //    //   INVENTORY_ON_HAND_FOR_SALESREPS_SHOPS_BIP

            //    helper.setgridproperties_new(DSreceiptapplications, gridView10, gridControl10, "Analysis", helper.getnumbercharcols(DTreceiptsapp, "N"), "nopaint", helper.getnumbercharcols(DTreceiptsapp, "C"), spreadsheetControl1);
            //    //   helper.setgridproperties_new(DSreceipts, gridView9, gridControl9, "Analysis", helper.getnumbercharcols(DTreceipts, "N"), "nopaint", helper.getnumbercharcols(DTreceipts, "C"), spreadsheetControl1);
            //}
            //catch
            //{

            //}



        }

        private void simpleButton3_Click(object sender, EventArgs e)
        {
            try
            {
                SplashScreenManager.ShowForm(typeof(WaitForm1));
            }
            catch (Exception e5)
            {

            }

            DataRow row = websrvicedates.NewRow();
            row["Date"] = DateTime.Now.ToString();
            row["reportname"] = "Query Receipt Applications";
            row["status"] = "initializing";

            websrvicedates.Rows.Add(row);

            gridControl2.DataSource = null;
            gridView2.RefreshData();

            gridControl10.DataSource = null;
            gridView10.RefreshData();


            //   stkmovment();

            Thread thread = new Thread(() => queryreceiptapplications());
            thread.IsBackground = true;
            Thread.Sleep(1000);
            thread.Name = string.Format("Query Receipt Applications");
            _threads.Add(thread);

            //Task<string> task = new Task<string>(stkmovment);
            //task.Start();
            //string x;
            //x = await task;


            //       Thread.Sleep(1000);
            //  thread.Name = string.Format("Fusion Client{0}", "Stock Movement");
            //  _threads.Add(thread);

            thread.Start();

            DataRow row1 = Threadtable.NewRow();
            row1["Threadname"] = thread.Name;
            row1["status"] = thread.ThreadState;
            row1["startdate"] = DateTime.Now.ToString();
            row1["enddate"] = "";
            row1["notify"] = "";

            Threadtable.Rows.Add(row1);


            timer1.Enabled = true;

            showalert("Request for GL Drill has been Launched", "info");







            try
            {
                SplashScreenManager.CloseForm();
                flyoutPanel3.HidePopup();
            }
            catch (Exception e5)
            {

            }
        }

        private void toPDFToolStripMenuItem_Click(object sender, EventArgs e)
        {
            DateTime dt = DateTime.Now;

            string time = dt.ToString("-HH-mm-ss");

            try
            {
                string FileName = "C:\\fusion\\accountdetails-" + time + ".pdf";
                //     pivotGridControl9.ExportToXls(FileName);

                var pivotExportOptions = new DevExpress.XtraPivotGrid.PivotXlsExportOptions();
                pivotExportOptions.ExportType = DevExpress.Export.ExportType.WYSIWYG;
                pivotGridControl4.OptionsPrint.PageSettings.PaperKind = System.Drawing.Printing.PaperKind.A3;

                pivotGridControl4.ShowPrintPreview();

                pivotGridControl4.OptionsPrint.PageSettings.Landscape = true;

                //settings.SettingsExport.OptionsPrint.PageSettings.Landscape = true;

                pivotGridControl4.ExportToPdf(FileName);

                //PivotXlsxExportOptions options = new PivotXlsxExportOptions();
                //options.CustomizeCell += options_CustomizeCell;
                //pivotGridControl4.ExportToXlsx(FileName);//, options);

                System.Diagnostics.Process.Start("C:\\fusion\\accountdetails-" + time + ".pdf");


            }
            catch (Exception e6)
            {

            }
        }

        private void toExcelToolStripMenuItem_Click(object sender, EventArgs e)
        {
            DateTime dt = DateTime.Now;

            string time = dt.ToString("-HH-mm-ss");

            try
            {
                string FileName = "C:\\fusion\\accountdetails-" + time + ".xls";
                //     pivotGridControl9.ExportToXls(FileName);

                var pivotExportOptions = new DevExpress.XtraPivotGrid.PivotXlsxExportOptions();
                pivotExportOptions.ExportType = DevExpress.Export.ExportType.WYSIWYG;

                pivotGridControl4.ExportToXlsx(FileName, pivotExportOptions);

                //PivotXlsxExportOptions options = new PivotXlsxExportOptions();
                //options.CustomizeCell += options_CustomizeCell;
                //pivotGridControl4.ExportToXlsx(FileName);//, options);

                System.Diagnostics.Process.Start("C:\\fusion\\accountdetails-" + time + ".xls");


            }
            catch (Exception e6)
            {

            }
        }

        private void exportToolStripMenuItem_Click(object sender, EventArgs e)
        {

            try
            {
                var pivotExportOptions = new DevExpress.XtraPivotGrid.PivotXlsExportOptions();
                pivotExportOptions.ExportType = DevExpress.Export.ExportType.WYSIWYG;
                pivotGridControl5.OptionsPrint.PageSettings.PaperKind = System.Drawing.Printing.PaperKind.A3;

                pivotGridControl5.ShowPrintPreview();
            }
            catch
            {

            }
        }

        public void setwebservicedataattributes(DevExpress.XtraGrid.Views.Grid.GridView view)
        {
            view.OptionsSelection.MultiSelect = true;
            view.OptionsView.ShowFooter = true;
            view.OptionsView.ShowAutoFilterRow = true;
            view.OptionsView.ShowIndicator = false;
            view.OptionsView.ColumnAutoWidth = true;
            view.Appearance.Row.Font = new Font("Tahoma", 14f);
            view.HorzScrollVisibility = DevExpress.XtraGrid.Views.Base.ScrollVisibility.Always;
            view.OptionsView.ColumnAutoWidth = false;
            view.OptionsView.BestFitMaxRowCount = -1;
            view.OptionsBehavior.ReadOnly = true;
            view.OptionsBehavior.Editable = true;
            view.BestFitColumns();

            //   helper.setgridproperties_new(DSb2dp, gridView29, gridControl29, "", helper.getnumbercharcols(DTb2dp, "N"), "paint", helper.getnumbercharcols(DTb2dp, "C"), spreadsheetControl1);


        }


        helperclass helper1 = new helperclass();

        public void runthreads()
        {
            anythinglive = "N";
            string notify = "";
            string status = "";
            //  var currentProcess = Process.GetCurrentProcess();
            //var allthreads = currentProcess.Threads;

            int noofthreads = 0;
            int startedthreads = 1;

            // check only 4 trheads are in parallel 

            foreach (Thread thread1 in _threads)
            // foreach (Thread thread in allthreads)
            {


                if (thread1.IsAlive)
                {
                    noofthreads = noofthreads + 1;

                }

            }


            if (noofthreads <= 2)
            {

                foreach (Thread thread1 in _threads)
                // foreach (Thread thread in allthreads)
                {


                    if (thread1.ThreadState.ToString() == "Background, Unstarted")
                    {

                        if (startedthreads <= 3)
                        {
                            thread1.Start();
                            startedthreads = startedthreads + 1;
                            foreach (DataRow dr in Threadtable.Rows) // search whole table
                            {
                                if (dr["threadname"] == thread1.Name) // if id==2
                                {
                                    notify = dr["notify"].ToString();
                                    status = dr["status"].ToString();

                                    if (status == "Background, Unstarted")
                                    {
                                        dr["status"] = thread1.ThreadState.ToString();
                                    }
                                }
                            }

                        }
                    }


                }
            }


            if (anythinglive == "N")
            {
                //tbendtime.Text = DateTime.Now.ToString();
                //        timer1.Enabled = false;
            }


            try
            {
                //gridControl35.DataSource = websrvicedates;
                gridControl12.DataSource = websrvicedates;

                gridControl12.DataSource = Threadtable;

            }
            catch (Exception e3)
            {

            }
        }



        string anythinglive;


        public void checkthreadstatus()
        {
            //richTextBox1.Text = cstlog;

            GC.Collect();
            GC.WaitForPendingFinalizers();

            string threadstatus = "";
            anythinglive = "N";
            string notify = "";
            string status = "";
            //  var currentProcess = Process.GetCurrentProcess();
            //var allthreads = currentProcess.Threads;

            foreach (Thread thread1 in _threads)
            // foreach (Thread thread in allthreads)
            {

                threadstatus = thread1.ThreadState.ToString();

                if (thread1.IsAlive || thread1.ThreadState.ToString().Contains("Background"))
                {
                    anythinglive = "Y";
                    //showalert(thread.ToString() + " is Alive", "error");
                    //DataRow row = datatable1.NewRow();
                    //row["Threadname"] = thread.Name;
                    //row["status"] = "Alive";
                    //datatable1.Rows.Add(row);

                }
                else
                {

                    try
                    {

                        foreach (DataRow dr in Threadtable.Rows) // search whole table
                        {
                            if (dr["threadname"] == thread1.Name) // if id==2
                            {
                                notify = dr["notify"].ToString();
                                status = dr["status"].ToString();

                                if (status == "Background")
                                {
                                    dr["status"] = "Completed";
                                    dr["notify"] = "Yes";
                                    dr["enddate"] = DateTime.Now.ToString();
                                    //  Displaynotify(thread1.Name, "Thread Execution Completed");
                                    helper1.ShowNotification(thread1.Name.Replace("Fusion Client", "") + " thread execution completed", businessunit);

                                    if (thread1.Name == "Query Receipts")
                                    {
                                        getreceiptdata();
                                    }
                                    else if (thread1.Name == "Query Receipts Applications")
                                    {
                                        viewreceiptapplications();
                                    }
                                    else if (thread1.Name == "Query Account Details")
                                    {
                                        queryaccountdetails();
                                    }
                                }




                                //change the name
                                //break; break or not depending on you
                            }
                        }

                    }

                    catch
                    {
                        showalert("error in checking thread status", "error");
                    }
                }
            }

            if (anythinglive == "N")
            {
                //tbendtime.Text = DateTime.Now.ToString();
                timer1.Enabled = false;
            }


            try
            {
                //   gridControl1.DataSource = Threadtable;
                //                gridControl1.DataSource = datatable1;

                //  gridControl19.DataSource = Threadtable;
                //                gridControl21.DataSource = Threadtable;
                gridControl11.DataSource = Threadtable;

            }
            catch (Exception e3)
            {

            }
        }



        private void timer1_Tick(object sender, EventArgs e)
        {
            checkthreadstatus();
            runthreads();

            gridControl12.DataSource = websrvicedates;
            // gridControl11.DataSource = websrvicedates;

            //  gridControl38.DataSource = websrvicedates;

            gridControl11.DataSource = Threadtable;
            //         gridControl2.DataSource = Threadtable;

            setwebservicedataattributes(gridView11);
            setwebservicedataattributes(gridView12);

        }

        private void refreshDataToolStripMenuItem1_Click(object sender, EventArgs e)
        {
            getreceiptdata();
        }

        public async Task getreceiptdata()
        {

            helperclass helper = new helperclass();

            try
            {

                DataTable DTreceipts = DSreceipts.Tables[1];

                await helper.setgridproperties_async(DSreceipts, gridView2, gridControl2, "Analysis", helper.getnumbercharcols(DTreceipts, "N"), "nopaint", helper.getnumbercharcols(DTreceipts, "C"), spreadsheetControl1);
                //await helper.setgridproperties_async(DSreceipts, gridView9, gridControl9, "Analysis", helper.getnumbercharcols(DTreceipts, "N"), "nopaint", helper.getnumbercharcols(DTreceipts, "C"), spreadsheetControl1);

                gridView2.OptionsView.ColumnAutoWidth = false;
                gridView2.OptionsView.BestFitMaxRowCount = -1;
                gridView2.OptionsBehavior.ReadOnly = true;
                gridView2.OptionsBehavior.Editable = true;
                gridView2.BestFitColumns();
            }
            catch (Exception e7)
            {
                MessageBox.Show(e7.Message, "info");
            }


            try
            {

                DataTable DTreceiptsapp = DSreceiptapplications.Tables[1];


                //   INVENTORY_ON_HAND_FOR_SALESREPS_SHOPS_BIP

                helper.setgridproperties_new(DSreceiptapplications, gridView10, gridControl10, "Analysis", helper.getnumbercharcols(DTreceiptsapp, "N"), "nopaint", helper.getnumbercharcols(DTreceiptsapp, "C"), spreadsheetControl1);
                //   helper.setgridproperties_new(DSreceipts, gridView9, gridControl9, "Analysis", helper.getnumbercharcols(DTreceipts, "N"), "nopaint", helper.getnumbercharcols(DTreceipts, "C"), spreadsheetControl1);

                gridView10.OptionsView.ColumnAutoWidth = false;
                gridView10.OptionsView.BestFitMaxRowCount = -1;
                gridView10.BestFitColumns();
            }
            catch (Exception e7)
            {
                MessageBox.Show(e7.Message, "info");
            }

        }

        private void refreshDataToolStripMenuItem2_Click(object sender, EventArgs e)
        {
            viewreceiptapplications();
        }


        public void queryaccountdetails()
        {

   
            try
            {
                DataTable DTsumm = DSbalance.Tables[1];

                helper1.setgridproperties_new(DSbalance, gridView5, gridControl5, "Analysis", helper1.getnumbercharcols(DTsumm, "N"), "nopaint", helper1.getnumbercharcols(DTsumm, "C"), spreadsheetControl1);

                pivotaccountdetails(DSbalance, pivotGridControl3);
                pivotacctdetailsbymonth(pvt, pivotGridControl5);
            }
            catch (Exception e7)
            {
                DataTable DTsumm = DSbalance.Tables[0];

                helper1.setgridproperties_new(DSbalance, gridView5, gridControl5, "", helper1.getnumbercharcols(DTsumm, "N"), "nopaint", helper1.getnumbercharcols(DTsumm, "C"), spreadsheetControl1);

                pivotaccountdetails(DSbalance, pivotGridControl3);
                pivotacctdetailsbymonth(pvt, pivotGridControl5);
            }

        }


        public void viewreceiptapplications()
        {
            try
            {
                DataTable DTreceiptsapp = DSreceiptapplications.Tables[1];


                //   INVENTORY_ON_HAND_FOR_SALESREPS_SHOPS_BIP

                helper1.setgridproperties_new(DSreceiptapplications, gridView10, gridControl10, "Analysis", helper1.getnumbercharcols(DTreceiptsapp, "N"), "nopaint", helper1.getnumbercharcols(DTreceiptsapp, "C"), spreadsheetControl1);
                //   helper.setgridproperties_new(DSreceipts, gridView9, gridControl9, "Analysis", helper.getnumbercharcols(DTreceipts, "N"), "nopaint", helper.getnumbercharcols(DTreceipts, "C"), spreadsheetControl1);
            }
            catch
            {

            }


        }

        private void barCheckItem1_CheckedChanged(object sender, DevExpress.XtraBars.ItemClickEventArgs e)
        {
            //string status = barCheckItem1.Checked.ToString();

            //if (status == "False")
            //{
            //    barCheckItem1.ImageUri = "Cancel";
            //}
            //else
            //{
            //    barCheckItem1.ImageUri = "Apply";
            //}

            //Properties.Settings.Default.copyheaders = barCheckItem1.Checked;
        }

        helperclass help = new helperclass();

        private void barButtonItem7_ItemClick(object sender, DevExpress.XtraBars.ItemClickEventArgs e)
        {
            try
            {
                help.CaptureMyScreen();
            }
            catch
            {

            }
        }

        private void refreshToolStripMenuItem_Click(object sender, EventArgs e)
        {

        }

        private void printReceiptToolStripMenuItem_Click(object sender, EventArgs e)
        {
            try
            {
                string filename = generatereceipt(tbreceiptnumber1.Text);

                tbsubject.Text = "Grays Inc Receipt for Your Payment";
                rtbody.Text = "Dear Sir/Madam " + "\r\n" + Environment.NewLine +

                               " Please find attached receipt for your Payemnt ." + "\r\n" + Environment.NewLine +
                               " Kindly ignore this mail if you have already received the receipt." + "\r\n" + Environment.NewLine +


                                "Sincerely, " + "\r\n" + Environment.NewLine +
                                "Accounts Receivables Department," + "\r\n" + Environment.NewLine +
                                "Grays Inc";

                pdfViewer1.LoadDocument(filename);
                flyoutPanel16.Height = 700;
                // flyoutPanel1.OwnerControl = tabNavigationPage1;
                flyoutPanel16.ShowPopup();
            }
            catch
            {

            }
        }

        private void printReceiptToolStripMenuItem1_Click(object sender, EventArgs e)
        {
            try
            {

                string receiptnumber = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "RECEIPT_NUMBER").ToString();

                string filename = generatereceipt(receiptnumber);

                tbsubject.Text = "Grays Inc Receipt for Your Payment";
                rtbody.Text = "Dear Sir/Madam " + "\r\n" + Environment.NewLine +

                               " Please find attached receipt for your Payemnt ." + "\r\n" + Environment.NewLine +
                               " Kindly ignore this mail if you have already received the receipt." + "\r\n" + Environment.NewLine +


                                "Sincerely, " + "\r\n" + Environment.NewLine +
                                "Accounts Receivables Department," + "\r\n" + Environment.NewLine +
                                "Grays Inc";

                pdfViewer1.LoadDocument(filename);
                flyoutPanel16.Height = 700;
                // flyoutPanel1.OwnerControl = tabNavigationPage1;
                flyoutPanel16.ShowPopup();
            }
            catch
            {

            }
        }

        public void queryrelationship()
        {

            helperclass helper = null;
            helper = new helperclass();

            FusionRunReport report = null;

            report = new FusionRunReport();

            GraysProdReporting Preport = null;
            Preport = new GraysProdReporting();

            // GETTING RECEIPTS FROM FUSION 
            //  if (dateEdit2.EditValue != null && dateEdit1.EditValue != null)
            string status = null;

            report = new FusionRunReport();
            //DataSet DSreceipts = new DataSet();
            DataSet DSrelation = new DataSet();
            DataTable DTrelation = new DataTable();


            if (instance_name == "TEST")
            {

                DSrelation = report.runreport_parameter("/Custom/DEXPRESS/Receivables/AR_CUSTOMER_RELATIONSHIP_BIP.xdo",
                        "shaik", "fusion1234", "", "", "", "");
            }
            else if (instance_name == "PROD")
            {
                DSrelation = Preport.runreport_parameter("/Custom/DEXPRESS/Receivables/AR_CUSTOMER_RELATIONSHIP_BIP.xdo",
                        "shaik", "fusion1234", "", "", "", "");
            }

            try
            {

                DTrelation = DSrelation.Tables[0];

                helper1.setgridproperties_new(DSrelation, gridView16, gridControl15, "", helper1.getnumbercharcols(DTrelation, "N"), "nopaint", helper1.getnumbercharcols(DTrelation, "C"), spreadsheetControl1);

            }
            catch
            {

            }


        }




        private void refreshDataToolStripMenuItem3_Click(object sender, EventArgs e)
        {
            try
            {
                queryrelationship();
            }
            catch
            {

            }
        }

        private void importFromFileToolStripMenuItem_Click(object sender, EventArgs e)
        {
            String filename = "";
            DataTable Dt = new DataTable();
            try
            {
                filename = selectcsvtoload();
                Dt = loadcsv(filename);
            }
            catch
            {

            }

            helperclass helper = null;
            helper = new helperclass();


            DataSet DS = new DataSet();
            DataSet DS1 = new DataSet();

            if (!string.IsNullOrEmpty(filename))
            {

                try
                {
                    DS1.Tables.Add(Dt);
                    markdata(DS1);
                }
                catch (Exception e9)
                {

                }
            }
            else
            {
                MessageBox.Show("Plese select the file");

            }

            // markdata(DS1);

        }



        private void markdata(DataSet DS)
        {

            //     DataSet Materialtrx1;
            //DataTable DtMaterial1;

            DataRow[] foundRows;
            DataRow[] filerows;
            DataRow[] ItemRows;
            DataRow[] trxrows;
            DataRow[] salesreponhand;
            string ITEM_NUMBER = "";
            string qty = "";
            string old_item = "";
            string new_item = "";
            string itemorg = "";

            DataTable DTfile1 = new DataTable();
            DTfile1 = DS.Tables[0];

            //try
            //{
            //    onhand1.Tables[1].DefaultView.Sort = "ITEM_NUMBER DESC";
            //}
            //catch
            //{

            //}

            for (int i = 0; i < DSbalance.Tables[1].Rows.Count; i++)
            {

                //string s = ARDETAILS.Tables[0].Rows[intCount][3];
                ITEM_NUMBER = DSbalance.Tables[1].Rows[i]["SALES_ORDER"].ToString();


                // new_item = onhand1.Tables[1].Rows[i]["ITEM_NUMBER"].ToString();


                //    string LOCATION = abstransactions.Tables[0].Rows[i]["LOCATION"].ToString();

                try
                {
                    // UPDATTING SALESREP     
                    try
                    {
                        if (ITEM_NUMBER == "GFI040083089X")
                        {

                        }

                        //EFI037044239XSALESREPSSPFIRM      

                        string ItemSearch = "ORDERNUMBER = '" + ITEM_NUMBER + "'";
                        filerows = DTfile1.Select(ItemSearch);

                        //GFI001010039X


                        //qty = filerows[0]["REQ_QTY"].ToString();
                        // fusion_salesrep_name = filerows[0]["NEW_NAME"].ToString();

                        string or = filerows[0]["ORDERNUMBER"].ToString();
                        string amt = filerows[0]["AMOUNT"].ToString();

                        DSbalance.Tables[1].Rows[i][0] = "S";
                        DSbalance.Tables[1].Rows[i][27] = amt;


                    }
                    catch (Exception e9)
                    {

                    }


                }
                catch
                { }




            }

            DSbalance.Tables[0].AcceptChanges();

        }

        public DataTable loadcsv(string filename)
        {

            DataTable dt = new DataTable();
            try
            {
                using (StreamReader sr = new StreamReader(filename))
                {
                    string[] headers = sr.ReadLine().Split(',');
                    foreach (string header in headers)
                    {
                        dt.Columns.Add(header);
                    }
                    while (!sr.EndOfStream)
                    {
                        string[] rows = sr.ReadLine().Split(',');
                        DataRow dr = dt.NewRow();
                        for (int i = 0; i < headers.Length; i++)
                        {
                            dr[i] = rows[i];
                        }
                        dt.Rows.Add(dr);
                    }

                }
            }
            catch (Exception e9)
            {
                MessageBox.Show("Error", e9.Message);
            }

            return dt;
        }

        public string selectcsvtoload()
        {
            string filename = "";

            OpenFileDialog openFileDialog1 = new OpenFileDialog
            {
                //  InitialDirectory = @"D:\",
                Title = "Select item loading csv file",

                CheckFileExists = true,
                CheckPathExists = true,

                DefaultExt = "csv",
                Filter = "(*.csv)|*.csv",
                FilterIndex = 2,
                RestoreDirectory = true,

                ReadOnlyChecked = true,
                ShowReadOnly = true
            };

            if (openFileDialog1.ShowDialog() == DialogResult.OK)
            {
                filename = openFileDialog1.FileName;
                //  label66.Text = filename;
            }
            return filename;

        }

        private void FrmDebtorscontrol_Resize(object sender, EventArgs e)
        {
            //Region = System.Drawing.Region.FromHrgn(CreateRoundRectRgn(0, 0, this.Width, this.Height, 20, 20));
        }

        private void button_WOC1_Click(object sender, EventArgs e)
        {
            tabPane1.SelectedPageIndex = 1;
            tabPane3.SelectedPageIndex = 0;

            flyoutPanel3.OwnerControl = gridControl2;

            flyoutPanel3.ShowPopup();
        }

        private void button_WOC2_Click(object sender, EventArgs e)
        {
            tabPane1.SelectedPageIndex = 2;
            tabPane4.SelectedPageIndex = 0;
            flyoutPanel23.ShowPopup();

        }

        private void button_WOC3_Click(object sender, EventArgs e)
        {
            tabPane1.SelectedPageIndex = 3;
            var result = XtraMessageBox.Show("Do you Want to Refresh the Data ?, This will take several minutes !", "Confirmation", MessageBoxButtons.YesNo);

            // IF 1
            if (result.ToString() == "Yes")
            {


                getcustomers("", "QUERY", "BALANCES");
            }
        }

        private void attachmentsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            string receiptfilename = "";
            DialogResult result = openFileDialog1.ShowDialog();
            if (result == DialogResult.OK)
            {
                receiptfilename = openFileDialog1.FileName;
            }

            string receiptid = "";

            receiptid = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "CASH_RECEIPT_ID").ToString();

            Attachreceipt(receiptfilename, receiptid, "FILE", receiptfilename, "File Upload", "CUSTOMER_RECEIPT"); 


        }
  
    public class receiptattachmentclass
    {
        public string DatatypeCode { get; set; }
        public string FileName { get; set; }
        public string Title { get; set; }
        public string Description { get; set; }
        public string CategoryName { get; set; }
        public string FileContents { get; set; }
    }

    public void Attachreceipt(string filename, string receiptid, string DatatypeCode, string Title, string Description, string CategoryName)
    {
        string status = "";

        string instance_name = Properties.Settings.Default.instancename;
        string password = Properties.Settings.Default.password;
        string user = Properties.Settings.Default.username;

        string file_name = Path.GetFileName(filename);

        Byte[] bytes = File.ReadAllBytes(filename);
        String base64 = Convert.ToBase64String(bytes);

        try
        {
            var request = new RestRequest();

            string fullurl = "";



            if (instance_name == "PROD")
            {
                fullurl = "https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/standardReceipts/" + receiptid + "/child/attachments";

            }
            else if (instance_name == "TEST")
            {

                fullurl = "https://efmh-test.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/standardReceipts/" + receiptid + "/child/attachments";

            }



            var client = new RestClient(fullurl);
            client.Authenticator = new RestSharp.Authenticators.HttpBasicAuthenticator(user, password);
            request.AddHeader("Accept", "application/json");
            request.AddHeader("Cache-Control", "no-cache");
            request.AddHeader("Content-Type", "application/json");
            dynamic foo = new System.Dynamic.ExpandoObject();

            //   string id = gridView1.GetRowCellValue(gridView1.FocusedRowHandle, "id").ToString();

            foo = new receiptattachmentclass
            {
                DatatypeCode = DatatypeCode,
                FileName = filename,
                Title = Title,
                Description = Description,
                CategoryName = CategoryName,
                FileContents = base64
            };



            var json = Newtonsoft.Json.JsonConvert.SerializeObject(foo, Newtonsoft.Json.Formatting.Indented);
            request = new RestRequest(Method.POST);

            request.AddJsonBody(foo);


            IRestResponse response = client.Execute(request);
            if (response.StatusCode == System.Net.HttpStatusCode.Created)
            {
                status = "File Attached";
                MessageBox.Show(response.ToString()+" -"+"File uploaded");
            }
            else
            {
                status = "File Attached";
                    MessageBox.Show(response.ErrorMessage);
                }

        }
        catch
        {

        }


    }

        private void automatedReceiptApplicationToolStripMenuItem_Click(object sender, EventArgs e)
        {
            flyoutPanel5.OwnerControl = gridControl2;
            string LEDGMENTREF = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "LODGEMENTREF").ToString();
            tbledgmentref1.Text = LEDGMENTREF;
            flyoutPanel5.ShowPopup();
        }

        private void button2_Click(object sender, EventArgs e)
        {
            //DateTime fromdate = Convert.ToDateTime(dateEdit7.EditValue.ToString());
            //DateTime todate = Convert.ToDateTime(dateEdit6.EditValue.ToString());

            dateEdit7.EditValue = "01/01/2021";
            dateEdit6.EditValue = "28/02/2021";

        }

        private void flyoutPanel5_ButtonClick(object sender, FlyoutPanelButtonClickEventArgs e)
        {
            if (e.Button.Caption == "Close")
            {
                flyoutPanel5.HidePopup();
            }
            else
            {
  
                DateTime fromdate = Convert.ToDateTime(salesdate.EditValue.ToString());
                DateTime todate = Convert.ToDateTime(salesdate.EditValue.ToString());

                string fromdate1 = fromdate.ToString("yyyy-MM-dd");
                string todate1 = todate.ToString("yyyy-MM-dd");

                string customername = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "CUSTOMER_NAME").ToString();
                string customernumber = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "ACCOUNT_NUMBER").ToString();
                // = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "RECEIPT_METHOD").ToString();


                // getcustomerbalancedetails(Bu_name, customernumber, tbscustomer.Text, "MULTIPLE", fromdate1, todate1, tbtransactiontype.Text, "AD", "");
                flyoutPanel5.HidePopup();
                 editreceipt();

               

                getcustomerbalancedetails(Bu_name, customernumber, "", "RA", fromdate1, todate1, "", "RA", "INV",tbclass.Text);

                dateEdit2.EditValue = null;
                dateEdit1.EditValue = null;

                dateEdit2.EditValue = Convert.ToDateTime(salesdate.EditValue);
                dateEdit1.EditValue = Convert.ToDateTime(salesdate.EditValue);

                dateEdit2.EditValue = Convert.ToString(Convert.ToDateTime(salesdate.EditValue));
                dateEdit1.Text = Convert.ToString(Convert.ToDateTime(salesdate.EditValue));


                DateTime fromdate4 = Convert.ToDateTime(salesdate.EditValue.ToString());

                //dateEdit2.EditValue = fromdate4;
                //dateEdit1.EditValue = fromdate4;
                //todate = Convert.ToDateTime(dateEdit1.EditValue.ToString());
                //fromdate1 = fromdate.ToString("yyyy-MM-dd");
                //todate1 = todate.ToString("yyyy-MM-dd");

                setcartattributes(gridView14);
                //tabPane3.TabIndex = 2;
            }
        }

        private void button4_Click(object sender, EventArgs e)
        {
            string filename = "c:/fusion/" + tbreceiptnumberbc.Text;
            XRBarCode barcode = new XRBarCode();

            barcode.Symbology = new Code128Generator();
            barcode.Text = tbreceiptnumberbc.Text;
            barcode.Width = 400;
            barcode.Height = 100;
            barcode.AutoModule = true;
            ((Code128Generator)barcode.Symbology).CharacterSet = Code128Charset.CharsetB;
            XtraReport report = new XtraReport();
            report.Bands.Add(new DetailBand());
            report.Bands[0].Controls.Add(barcode);
            report.CreateDocument();
            report.ExportToImage(filename, System.Drawing.Imaging.ImageFormat.Jpeg);
            // return url + "/htmlPages/Barcodes/" + filename + ".jpg";
            report.ExportToImage(filename + ".jpeg", System.Drawing.Imaging.ImageFormat.Jpeg);
            // return  filename;

        }

        private void openBarcodeToolStripMenuItem_Click(object sender, EventArgs e)
        {
            flyoutPanel6.OwnerControl = tabPane3;
            flyoutPanel6.ShowPopup();

            tbreceiptnumberbc.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "RECEIPT_NUMBER").ToString();
            tbreceiptamountbc.Text = gridView2.GetRowCellValue(gridView2.FocusedRowHandle, "AMOUNT").ToString();

            barCodeControlreceiptnumber.Text = tbreceiptnumberbc.Text;
            flyoutPanel6.ShowPopup();
        }

        private void menuStrip1_ItemClicked(object sender, ToolStripItemClickedEventArgs e)
        {

        }

        private void button_WOC4_Click(object sender, EventArgs e)
        {
            tabPane1.SelectedPageIndex = 0;
            tabPane4.SelectedPageIndex = 0;
            flyoutPanel4.ShowPopup();

        }

        private void increaseToolStripMenuItem_Click(object sender, EventArgs e)
        {
            gridView2.Appearance.Row.Font = new Font("Tahoma", 14f);
        }
            
        private void decreaseToolStripMenuItem_Click(object sender, EventArgs e)
        {
            gridView2.Appearance.Row.Font = new Font("Tahoma", 12f);
        }

        private void increaseToolStripMenuItem1_Click(object sender, EventArgs e)
        {
            gridView3.Appearance.Row.Font = new Font("Tahoma", 14f);
        }

        private void decreaseToolStripMenuItem1_Click(object sender, EventArgs e)
        {
            gridView3.Appearance.Row.Font = new Font("Tahoma", 12f);
        }

        private void increaseToolStripMenuItem2_Click(object sender, EventArgs e)
        {
            gridView1.Appearance.Row.Font = new Font("Tahoma", 14f);
        }

        private void decreaseToolStripMenuItem2_Click(object sender, EventArgs e)
        {
            gridView1.Appearance.Row.Font = new Font("Tahoma", 12f);
        }

        private void accordionControlElement3_Click(object sender, EventArgs e)
        {
            label48.Text = "Manage Receipts";
            xtraTabControl1.SelectedTabPageIndex = 1;
            //tabPane1.SelectedPageIndex = 1;
            tabPane3.SelectedPageIndex = 0;

          
           
        }

        private void accordionControlElement4_Click(object sender, EventArgs e)
        {
            xtraTabControl1.SelectedTabPageIndex = 2;
            label48.Text = "Query Account Details";
            //tabPane1.SelectedPageIndex = 2;
            tabPane4.SelectedPageIndex = 0;
            flyoutPanel23.ShowPopup();
            
        }

        private void accordionControlElement5_Click(object sender, EventArgs e)
        {
            xtraTabControl1.SelectedTabPageIndex = 3;
            label48.Text = "Query Customer Balances";
           // tabPane1.SelectedPageIndex = 3;
            //var result = XtraMessageBox.Show("Do you Want to Query customer balances ?, This will take several minutes !", "Confirmation", MessageBoxButtons.YesNo);

            //// IF 1
            //if (result.ToString() == "Yes")
            //{


            //    getcustomers("", "QUERY", "BALANCES");
            //}
        }

        private void accordionControlElement6_Click(object sender, EventArgs e)
        {
            xtraTabControl1.SelectedTabPageIndex = 0;
            label48.Text = "Reconcile Order Management and AR";
            //.SelectedPageIndex = 0;
            tabPane2.SelectedPageIndex = 0;
            flyoutPanel4.OwnerControl = gridControl1;
            flyoutPanel4.ShowPopup();
        }

        private void flyoutPanel6_ButtonClick(object sender, FlyoutPanelButtonClickEventArgs e)
        {
            flyoutPanel6.HidePopup();
        }

        private void queryBalancesFromFusionToolStripMenuItem_Click(object sender, EventArgs e)
        {
            var result = XtraMessageBox.Show("Do you Want to Query customer balances ?, This will take several minutes !", "Confirmation", MessageBoxButtons.YesNo);

            // IF 1
            if (result.ToString() == "Yes")
            {


                getcustomers("", "QUERY", "BALANCES");
            }

        }

        private void parametersToolStripMenuItem_Click(object sender, EventArgs e)
        {
            flyoutPanel3.OwnerControl = tabPane3;

            flyoutPanel3.ShowPopup();
        }

        private void accordionControlElement7_Click(object sender, EventArgs e)
        {
            //xtraTabControl1.SelectedTabPageIndex = 8 ;
            //label48.Text = "Manage Receipts using Spreadsheet";

            xtraTabControl1.SelectedTabPageIndex = 12;
            label48.Text = "Manage Using SpreadSheet";
        }

        private void actionToolStripMenuItem_Click(object sender, EventArgs e)
        {
            copyspreadsheetlines("");
            flyoutPanel8.OwnerControl = button2;
            flyoutPanel8.ShowBeakForm();
            //createarreceipts(gridView17);
            bkgmode = "CREATERECEIPT";
            lblselected.Text = "0";
            lblupdated.Text = "0";
            lblfailed.Text = "0";
            submitbackgroundprocess("CREATECREATERECEIPTRECEIPT");

        }


        public void createarreceipts(DevExpress.XtraGrid.Views.Grid.GridView view, BackgroundWorker worker, DoWorkEventArgs e)
        {
            if (worker.CancellationPending)
            {
                e.Cancel = true;

            }

            Fusion_Integration help = new Fusion_Integration();
            ArrayList rows = new ArrayList();

            view.SelectAll();

            Int32[] selectedRowHandles = view.GetSelectedRows();

            String status1, status2, status3, status4, status5, status6, status7;

            int s = 1; int f = 1;

            for (int i = 0; i < selectedRowHandles.Length; i++)
            {
                int selectedRowHandle = selectedRowHandles[i];
                if (selectedRowHandle >= 0)
                    rows.Add(view.GetDataRow(selectedRowHandle));
            }

            if (lblselected.InvokeRequired)
            {
                lblselected.Invoke((MethodInvoker)delegate ()
                {

                    lblselected.Text = selectedRowHandles.Count().ToString();

                });
            }


            for (int i = 0; i < rows.Count; i++)
            {
                DataRow row = rows[i] as DataRow;
                // Change the field value.
                //     row["Discontinued"] = true;

                // string[,] status = new string[3, 2];
                //  gridView1.DeleteRow(i);

                string receipt_number = row["receipt_number"].ToString();
                string customer_acct_id = row["customer_account_id"].ToString();
                string CUSTOMER_NUMBER = row["CUSTOMER_NUMBER"].ToString();

                double amount = Convert.ToDouble(row["receipt_amount"].ToString());
                string receipt_date = row["receipt_date"].ToString();
                string receipt_method_id = row["receipt_method_id"].ToString();
                string org_id = row["org_id"].ToString();
                string comments = row["comments"].ToString();

                string bsno = "";
                string bsref = "";
                string source = "";
                string bsid = "";

                try
                {
                    bsid = row["bsid"].ToString();
                }
                catch
                {

                }
                try
                {
                    bsno = row["bsno"].ToString();
                }
                catch
                {

                }

                try
                {
                    bsref = row["bsref"].ToString();
                }
                catch
                {

                }
                try
                {
                    source = row["source"].ToString();
                }
                catch
                {

                }


                status2 = help.FusionReceiptInterface(receipt_number, customer_acct_id, amount, receipt_date, receipt_method_id, org_id, comments, bsid, bsno, bsref, source, user, password, instance_name);

                row["STATUS"] = status2;
                if (status2 == "SUCCESS")
                {
                    if (lblupdated.InvokeRequired)
                    {
                        lblupdated.Invoke((MethodInvoker)delegate ()
                        {
                            s = s + 1;
                            lblupdated.Text = s.ToString();

                        });
                    }
                }
                else
                {
                    if (lblfailed.InvokeRequired)
                    {
                        lblfailed.Invoke((MethodInvoker)delegate ()
                        {
                            f = f + 1;
                            lblfailed.Text = f.ToString();

                        });
                    }

                }

               
            }

            DSselectedcolumns.AcceptChanges();
            try
                {
                    Worksheet worksheet = spreadsheetControl1.Document.Worksheets.ActiveWorksheet;

                    //    DevExpress.Spreadsheet.CellRange visibleRange = spreadsheetControl1.VisibleRange;
                    worksheet.Import(DTselectedcolumns, true, 1, 1);
                    worksheet.Rows[0].Delete();
                }
                catch
                {

                }
            
        }

        private void toCreateReceiptsToolStripMenuItem_Click(object sender, EventArgs e)
        {
            //flyoutPanel7.ShowBeakForm();

            FrmSelectcustomers frm = new FrmSelectcustomers(businessunit,instance_name,DTreceiptmethods,DSrecieptmethods,businessunit);
            frm.ShowDialog();

            DataTable dt = new DataTable();
            dt = frm.DTselectedcustomers;
            receipt_method = frm.receipt_method;
            DTselectedcustomers.Merge(dt);
            createnewreceiptsusingspreadsheet();

            // method to make grid columns non editable 

            //gridSplitContainer3Grid.DataSource = _dataTableReturn;

        }


        public void submitbackgroundprocess(string name)
        {
            bkgmode = name;

            try
            {
                backgroundWorker1.RunWorkerAsync();
            }
            catch (Exception E9)
            {
                MessageBox.Show(E9.Message);
                backgroundWorker1.Dispose();
            }
        }


        private void InitializeBackgroundWorker()
        {

            backgroundWorker1.WorkerSupportsCancellation = true;
            backgroundWorker1.WorkerReportsProgress = true;

            backgroundWorker1.DoWork +=
                new DoWorkEventHandler(backgroundWorker1_DoWork);
            backgroundWorker1.RunWorkerCompleted +=
                new RunWorkerCompletedEventHandler(
            backgroundWorker1_RunWorkerCompleted);
            backgroundWorker1.ProgressChanged +=
                new ProgressChangedEventHandler(
            backgroundWorker1_ProgressChanged);


        }

        private void backgroundWorker1_ProgressChanged(object sender, ProgressChangedEventArgs e)
        {
            throw new NotImplementedException();
        }

        private void backgroundWorker1_RunWorkerCompleted(object sender, RunWorkerCompletedEventArgs e)
        {
            flyoutPanel8.HidePopup();
        }

        string bkgmode;

        private void backgroundWorker1_DoWork(object sender, DoWorkEventArgs e)
        {
            // Get the BackgroundWorker that raised this event.
            BackgroundWorker worker = sender as BackgroundWorker;

    
            //if (panel4.InvokeRequired)
            //{
            //    lblcount.Invoke((MethodInvoker)delegate ()
            //    {

            //        panel4.Visible = true;

            //    });
            //}






            if (worker.CancellationPending == true)
            {
                e.Cancel = true;
                return;
            }
            if (bkgmode == "QUERYRECEIPTMETHODS")
            {
                getarreceiptmethods(worker, e);
            }
            else if (bkgmode=="CREATERECEIPT")
            {
                createarreceipts(gridView17,worker,e);
            }

        }

        DataSet DSrecieptmethods;
        DataTable DTreceiptmethods;

        public void getarreceiptmethods(BackgroundWorker worker, DoWorkEventArgs e)
        {
             
            FusionRunReport report = null;
            report = new FusionRunReport();
            Fusion_Integration help = new Fusion_Integration();

            GraysProdReporting preport = new GraysProdReporting();
            
            helperclass helper = null;
            helper = new helperclass();

            if (worker.CancellationPending)
            {
                e.Cancel = true;

            }

            DSrecieptmethods = new DataSet();
            DTreceiptmethods = new DataTable();
            

                 Fusion_Integration Fusion_Integration = new Fusion_Integration();

            try
            {

                DSrecieptmethods = Fusion_Integration.runfusionreport_new_3("/Custom/DEXPRESS/Receivables/AR_RECEIPT_METHODS_BIP.xdo", user, password,
                 "", "", "", "", "", "",instance_name);

                //if (instance_name == "PROD")
                //{
                //    DSrecieptmethods = preport.runreport_3_parameter("/Custom/DEXPRESS/Receivables/AR_RECEIPT_METHODS_BIP.xdo", user, password,
                //        "", "", "", "", "", "");
                //}
                //else if (instance_name == "TEST")
                //{
                //    DSrecieptmethods = report.runreport_3_parameter("/Custom/DEXPRESS/Receivables/AR_RECEIPT_METHODS_BIP.xdo", user, password,
                //        "", "", "", "", "", "");
                //}

                int count = DSrecieptmethods.Tables[0].Rows.Count;
                DTreceiptmethods = DSrecieptmethods.Tables[0];

                helper1.setgridproperties_new(DSrecieptmethods, gridView9, gridControl9, "", helper1.getnumbercharcols(DTreceiptmethods, "N"), "nofreeze", helper1.getnumbercharcols(DTreceiptmethods, "C"), spreadsheetControl1);


            }
            catch (Exception e2)
            {

            }
   

        }
        string receipt_method;

        int srecords;

        public void createnewreceiptsusingspreadsheet()
        {
            srecords = 1;



            string[] selectedColumns = new[] { "STATUS", "RECEIPT_DATE", "RECEIPT_METHOD","RECEIPT_NUMBER",
                    "CUSTOMER_NUMBER", "CUSTOMER_NAME","RECEIPT_AMOUNT","COMMENTS","CUSTOMER_ACCOUNT_ID","RECEIPT_METHOD_ID" ,"ORG_ID"};


            DataTable dt = new DataView(DTselectedcustomers).ToTable(false, selectedColumns);

            //dt.Columns.Add("GroupName"); //, "", " REMARKS"")
            dt.Columns.Add("bsid");
            dt.Columns.Add("bsno");
            dt.Columns.Add("bsref");
    

            if (dt != null)
            {
  
                spreadsheetControl1.Document.Worksheets.Add();
                
                Worksheet worksheet = spreadsheetControl1.Document.Worksheets.ActiveWorksheet;

                //    DevExpress.Spreadsheet.CellRange visibleRange = spreadsheetControl1.VisibleRange;
                worksheet.Import(dt, true, 1, 1);
                worksheet.Rows[0].Delete();
                 
                string name = worksheet.Name;
                string wsname = name + "-Create Receipts " + receipt_method; ;
                try
                {
                    wsname = wsname.Substring(1, 30);
                }
                catch
                {

                }

                worksheet.Name = wsname;
                worksheet.Tag = "Create Receipts";
                
            }


        }

        private void flyoutPanel7_ButtonClick(object sender, FlyoutPanelButtonClickEventArgs e)
        {
            if (e.Button.Caption=="Close")
            {
                flyoutPanel7.HidePopup();
            }
            else
            {
                createnewreceiptsusingspreadsheet();
            }

        }

        private void accordionControlElement8_Click(object sender, EventArgs e)
        {
            xtraTabControl1.SelectedTabPageIndex = 12;
            label48.Text = "Debtors DashBoard";

            //using (FileStream stream = new FileStream("Documents\\AR_CUSTOMER_SUMMARY_EXCEL_DASHBOARD.xlsx", FileMode.Open))
            //{
            //    spreadsheetControl2.LoadDocument(stream, DocumentFormat.Xlsx);
            //}
        }

        private void button6_Click(object sender, EventArgs e)
        {
        }
        public void loadcustomerbalanceinspreadsheet()
        { 
            // DataTable dt = new DataView(DTcustomerbalances).ToTable(false, selectedColumns);
            try
            {
                DataTable dtCloned = DTcustomerbalances.Clone();
                dtCloned.Columns[7].DataType = typeof(Double);

                dtCloned.Columns["AMT_ORIGINAL"].DataType = typeof(Double);
                dtCloned.Columns["AMT_REMAINING"].DataType = typeof(Double);



                foreach (DataRow row in DTcustomerbalances.Rows)
                {
                    dtCloned.ImportRow(row);
                }

                //DTcustomerbalances.ConvertColumnType("MyColumnName", typeof(Double));

                if (dtCloned != null)
                {
                    Worksheet worksheet = spreadsheetControl2.Document.Worksheets.ActiveWorksheet;

                    DevExpress.Spreadsheet.CellRange visibleRange = spreadsheetControl1.VisibleRange;
                    worksheet.Import(dtCloned, true, 1, 1);
                    worksheet.Rows[0].Delete();
                }
                else
                {
                    MessageBox.Show("First Query Summary Balance Data");
                }
            }
            catch
            {
                MessageBox.Show("First Query Summary Balance Data");
            }
        }


        

        private void ribbonControl1_Click(object sender, EventArgs e)
        {

        }

        private void refreshPivotTableToolStripMenuItem_Click(object sender, EventArgs e)
        {
            try
            {
                Worksheet worksheet = spreadsheetControl2.Document.Worksheets.ActiveWorksheet;
                // Access the pivot table by its name in the collection.
                PivotTable pivotTable = worksheet.PivotTables["PivotTable1"];
                // Refresh the pivot table.
                pivotTable.Cache.Refresh();

            }
            catch
            {

            }
            }

        private void toolStripMenuItem3_Click(object sender, EventArgs e)
        {

        }

        private void customerAccountBalancesToolStripMenuItem_Click(object sender, EventArgs e)
        {
            loadcustomerbalanceinspreadsheet();
        }

        private void accordionControlElement9_Click(object sender, EventArgs e)
        {
            xtraTabControl1.SelectedTabPageIndex = 13;
            label48.Text = "Manage Using SpreadSheet";
        }

        private void richEditControl1_Click(object sender, EventArgs e)
        {

        }


        private void CreateTable()
        {

            Document doc = richEditControl1.Document;
            // Clear out the document content
            doc.Delete(richEditControl1.Document.Range);
            // Set up header information
            DocumentPosition pos = doc.Range.Start;
            DocumentRange rng = doc.InsertSingleLineText(pos, "Directory Information from C:\\");

            CharacterProperties cp_Header = doc.BeginUpdateCharacters(rng);
            cp_Header.FontName = "Verdana";
            cp_Header.FontSize = 16;
            doc.EndUpdateCharacters(cp_Header);
            doc.Paragraphs.Insert(rng.End);
            doc.Paragraphs.Insert(rng.End);

            // Add the table
            doc.Tables.Create(rng.End, 1, 3, AutoFitBehaviorType.AutoFitToWindow);
            // Format the table
            Table tbl = doc.Tables[0];

            try
            {
                tbl.BeginUpdate();

                CharacterProperties cp_Tbl = doc.BeginUpdateCharacters(tbl.Range);
                cp_Tbl.FontSize = 8;
                cp_Tbl.FontName = "Verdana";
                doc.EndUpdateCharacters(cp_Tbl);

                // Insert header caption and format the columns
                doc.InsertSingleLineText(tbl[0, 0].Range.Start, "Name");
                doc.InsertSingleLineText(tbl[0, 1].Range.Start, "Size");
                ParagraphProperties pp_HeadingSize = doc.BeginUpdateParagraphs(tbl[0, 1].Range);
                pp_HeadingSize.Alignment = ParagraphAlignment.Right;
                doc.EndUpdateParagraphs(pp_HeadingSize);

                doc.InsertSingleLineText(tbl[0, 2].Range.Start, "Modified");
                ParagraphProperties pp_HeadingModified = doc.BeginUpdateParagraphs(tbl[0, 2].Range);
                pp_HeadingModified.Alignment = ParagraphAlignment.Right;
                doc.EndUpdateParagraphs(pp_HeadingModified);
                // Apply a style to the table
                //tbl.Style = doc.TableStyles["MyTableGridNumberEight"];
                // Specify right and left paddings equal to 0.08 inches for all cells in a table
                tbl.RightPadding = Units.InchesToDocumentsF(0.08f);
                tbl.LeftPadding = Units.InchesToDocumentsF(0.08f);
            }
            finally
            {
                tbl.EndUpdate();
            }
        }

        private void CreateStyles()
        {
            // Define basic style
            TableStyle tStyleNormal = richEditControl1.Document.TableStyles.CreateNew();
            tStyleNormal.LineSpacingType = ParagraphLineSpacing.Single;
            tStyleNormal.FontName = "Verdana";
            tStyleNormal.Alignment = ParagraphAlignment.Left;
            tStyleNormal.Name = "MyTableGridNormal";
            richEditControl1.Document.TableStyles.Add(tStyleNormal);

            // Define Grid Eight style
            TableStyle tStyleGrid8 = richEditControl1.Document.TableStyles.CreateNew();
            tStyleGrid8.Parent = tStyleNormal;
            TableBorders borders = tStyleGrid8.TableBorders;

            borders.Bottom.LineColor = Color.DarkBlue;
            borders.Bottom.LineStyle = TableBorderLineStyle.Single;
            borders.Bottom.LineThickness = 0.75f;

            borders.Left.LineColor = Color.DarkBlue;
            borders.Left.LineStyle = TableBorderLineStyle.Single;
            borders.Left.LineThickness = 0.75f;

            borders.Right.LineColor = Color.DarkBlue;
            borders.Right.LineStyle = TableBorderLineStyle.Single;
            borders.Right.LineThickness = 0.75f;

            borders.Top.LineColor = Color.DarkBlue;
            borders.Top.LineStyle = TableBorderLineStyle.Single;
            borders.Top.LineThickness = 0.75f;

            borders.InsideVerticalBorder.LineColor = Color.DarkBlue;
            borders.InsideVerticalBorder.LineStyle = TableBorderLineStyle.Single;
            borders.InsideVerticalBorder.LineThickness = 0.75f;

            borders.InsideHorizontalBorder.LineColor = Color.DarkBlue;
            borders.InsideHorizontalBorder.LineStyle = TableBorderLineStyle.Single;
            borders.InsideHorizontalBorder.LineThickness = 0.75f;

            tStyleGrid8.CellBackgroundColor = Color.Transparent;
            tStyleGrid8.Name = "MyTableGridNumberEight";
            richEditControl1.Document.TableStyles.Add(tStyleGrid8);

            // Define Headings paragraph style
            ParagraphStyle pStyleHeadings = richEditControl1.Document.ParagraphStyles.CreateNew();
            pStyleHeadings.Bold = true;
            pStyleHeadings.ForeColor = Color.White;
            pStyleHeadings.Name = "My Headings Style";
            richEditControl1.Document.ParagraphStyles.Add(pStyleHeadings);
        }

        private void FillTable()
        {
            // Fill the table with data
            Document doc = richEditControl1.Document;
            Table tbl = doc.Tables[0];
            DirectoryInfo di = new DirectoryInfo("C:\\");

            try
            {
                tbl.BeginUpdate();
                foreach (FileInfo fi in di.GetFiles())
                {
                    TableRow row = tbl.Rows.Append();
                    TableCell cell = row.FirstCell;
                    doc.InsertSingleLineText(cell.Range.Start, fi.Name);
                    doc.InsertSingleLineText(cell.Next.Range.Start,
                        String.Format("{0:N0}", fi.Length));
                    doc.InsertSingleLineText(cell.Next.Next.Range.Start,
                        String.Format("{0:g}", fi.LastWriteTime));
                }
            }
            finally
            {
                tbl.EndUpdate();
            }
        }

        private void ApplyHeadingStyle()
        {
            Document doc = richEditControl1.Document;
            Table tbl = doc.Tables[0];
            foreach (TableCell cell in tbl.Rows.First.Cells)
            {
                cell.BackgroundColor = Color.DarkBlue;
            }
            ParagraphProperties pp_Headings = doc.BeginUpdateParagraphs(tbl.Rows.First.Range);
            pp_Headings.Style = doc.ParagraphStyles["My Headings Style"];
            doc.EndUpdateParagraphs(pp_Headings);
        }

        private void addTableToolStripMenuItem_Click(object sender, EventArgs e)
        {
            CreateTable();
            FillTable();
            ApplyHeadingStyle();
        }

        private void distinctCustomersToolStripMenuItem_Click(object sender, EventArgs e)
        {
            DataView view = new DataView(DTcustomerbalances);
            DTdistinctcustomers = view.ToTable(true, "ACCOUNT_NAME", "ACCOUNT_NUMBER","EMAIL");
            richEditControl1.Options.MailMerge.DataSource = DTdistinctcustomers;
            richEditControl1.Options.MailMerge.DataSource = 
            dataNavigator1.DataSource = DTdistinctcustomers;
        }

        private void richEditControl1_MailMergeStarted(object sender, DevExpress.XtraRichEdit.MailMergeStartedEventArgs e)
        {
            CreateTable();
            FillTable();
            ApplyHeadingStyle();
        }

        private void accordionControlElement10_Click(object sender, EventArgs e)
        {

            xtraTabControl1.SelectedTabPageIndex = 8;
            label48.Text = "Manage Receipts using Spreadsheet";

        }

        private void spreadsheetControl1_Enter(object sender, EventArgs e)
        {
            SpreadsheetControl spreadsheet = (SpreadsheetControl)sender;
            spreadsheetBarController1.SpreadsheetControl = spreadsheet;
            spreadsheetBarController2.SpreadsheetControl = spreadsheet;
            spreadsheet.UpdateCommandUI();

          
        }

        private void spreadsheetControl2_Enter(object sender, EventArgs e)
        {
            SpreadsheetControl spreadsheet = (SpreadsheetControl)sender;
            spreadsheetBarController1.SpreadsheetControl = spreadsheet;
            spreadsheetBarController2.SpreadsheetControl = spreadsheet;
            spreadsheet.UpdateCommandUI();
        }

        private void welcomeWizardPage1_Click(object sender, EventArgs e)
        {

        }

        private void button6_Click_1(object sender, EventArgs e)
        {
            getcustomeres(tbcustomerwizard.Text);

            DevExpress.XtraGrid.Columns.GridColumn chkColumn;
                DevExpress.XtraGrid.Columns.GridColumn chkColumnBtn = new DevExpress.XtraGrid.Columns.GridColumn ();
         
  

        }
        DataSet DSallcustomers;
        DataTable DTallcustomers;

        public void getcustomeres(string customername)
        {
            string status = "";
            helperclass helper = null;
            helper = new helperclass();

            FusionRunReport report = null;

            report = new FusionRunReport();

            GraysProdReporting Preport = null;
            Preport = new GraysProdReporting();
            string fromdate1 = "";
            string todate1 = "";
            //     gridControl13.DataSource = null;
            //    gridView12.RefreshData();

            // DSpricelist = report.runreport("/Custom/DEXPRESS/ORDER MANAGEMENT/GRAYS_PRICET_LIST_NEW_BIP.xdo", "shaik", "fusion1234");
            DSallcustomers = new DataSet();
            DTallcustomers = new DataTable();

            if (instance_name == "TEST")
            {

                DSallcustomers = report.runreport_parameter_new_10("/Custom/DEXPRESS/Receivables/CUSTOMER_MASTER_BIP_V4.xdo", "shaik", "fusion1234",
              businessunit, customername, tbcustomernumber1.Text, fromdate1, todate1, "", "", "", "", "", "BUSINESS_UNIT_ID", "ACCOUNT_NAME", "ACCOUNT_NUMBER",
              "FROM_DATE", "TO_DATE", "PARTNERID", "", "", "", "");

            }
            else if (instance_name == "TEST")
            {

                DSallcustomers = Preport.runreport_parameter_new_10("/Custom/DEXPRESS/Receivables/CUSTOMER_MASTER_BIP_V4.xdo", "shaik", "fusion1234",
                businessunit, customername, tbcustomernumber1.Text, fromdate1, todate1, "", "", "", "", "", "BUSINESS_UNIT_ID", "ACCOUNT_NAME", "ACCOUNT_NUMBER",
                "FROM_DATE", "TO_DATE", "PARTNERID", "", "", "", "");
            }

            DTallcustomers = DSallcustomers.Tables[1];

            helper1.setgridproperties_new(DSallcustomers, gridView17, gridControl16, "Analysis", helper1.getnumbercharcols(DTallcustomers, "N"), "nofreeze", helper1.getnumbercharcols(DTallcustomers, "C"), spreadsheetControl1);


        }

        private void wizardControl1_NextClick(object sender, DevExpress.XtraWizard.WizardCommandButtonClickEventArgs e)
        {
                string name= e.Page.Name;
             if (name== "wizardPage1")
            {
                tbcustomerwizard.Visible = true;
                button6.Visible = true;
            }
             else
            {
                tbcustomerwizard.Visible = false;
                button6.Visible = false;
            }
        }

        private void simpleButton5_Click(object sender, EventArgs e)
        {
            selectcustomerfor(gridView17);
        }

        DataSet DSselectedcustomers;

        public void selectcustomerfor(DevExpress.XtraGrid.Views.Grid.GridView view)
        {
            helperclass helper = null;
            helper = new helperclass();
            ArrayList rows = new ArrayList();

            Int32[] selectedRowHandles = view.GetSelectedRows();

            try
            {
                DSselectedcustomers.Tables.Remove(DTselectedcustomers);
            }
            catch (System.Exception e2)
            { }

            for (int i = 0; i < selectedRowHandles.Length; i++)
            {
                int selectedRowHandle = selectedRowHandles[i];
                if (selectedRowHandle >= 0)
                    rows.Add(view.GetDataRow(selectedRowHandle));
            }

            string CUSTOMER_NUMBER;
            string CUSTOMER_NAME;
            string CUSTOMER_ACCT_ID;

            for (int i = 0; i < rows.Count; i++)
            {
                DataRow row = rows[i] as DataRow;
                // Change the field value.
                //     row["Discontinued"] = true;
                CUSTOMER_NUMBER = row["ACCOUNT_NUMBER"].ToString();
                CUSTOMER_NAME = row["ACCOUNT_NAME"].ToString();
                CUSTOMER_ACCT_ID = row["CUST_ACCOUNT_ID"].ToString();
                      
                DTselectedcustomers.Rows.Add(CUSTOMER_NUMBER, CUSTOMER_NAME, CUSTOMER_ACCT_ID);
  
            }

            DSselectedcustomers = new DataSet();

            DSselectedcustomers.Tables.Add(DTselectedcustomers);
            helper.setgridproperties_new(DSselectedcustomers, gridView18, gridControl17, "", helper.getnumbercharcols(DTselectedcustomers, "N"), "nofreeze", helper.getnumbercharcols(DTselectedcustomers, "C"), spreadsheetControl1);


        }

        private void simpleButton6_Click(object sender, EventArgs e)
        {

        }

        DataTable DTselectedcolumns ;
        DataSet DSselectedcolumns ;

        public void copyspreadsheetlines(string itemtype)
        {
            helperclass helper = null;
            helper = new helperclass();
            DTselectedcolumns = new DataTable();


            IList<DevExpress.Spreadsheet.CellRange> currentSelection = spreadsheetControl1.GetSelectedRanges();

            Worksheet worksheet = spreadsheetControl1.Document.Worksheets.ActiveWorksheet;
            DevExpress.Spreadsheet.CellRange range = worksheet.Selection;// worksheet["C15:R18"];

            // bool rangeHasHeaders = this.barCheckItemHasHeaders1.Checked;

            //   Range range = worksheet.Selection;
            //bool rangeHasHeaders = this. barCheckItemHasHeaders1.Checked;

            // Create a data table with column names obtained from the first row in a range if it has headers.
            // Column data types are obtained from cell value types of cells in the first data row of the worksheet range.
            DataTable dataTable = worksheet.CreateDataTable(range, true);

            //Validate cell value types. If cell value types in a column are different, the column values are exported as text.
            for (int col = 0; col < range.ColumnCount; col++)
            {
                CellValueType cellType = range[0, col].Value.Type;
                for (int r = 1; r < range.RowCount; r++)
                {
                    if (cellType != range[r, col].Value.Type)
                    {
                        dataTable.Columns[col].DataType = typeof(string);
                        break;
                    }
                }
            }

            // Create the exporter that obtains data from the specified range, 
            // skips the header row (if required) and populates the previously created data table. 
            DataTableExporter exporter = worksheet.CreateDataTableExporter(range, dataTable, true);
            // Handle value conversion errors.
            // exporter.CellValueConversionError += exporter_CellValueConversionError;

            // Perform the export.
            exporter.Export();

            DSselectedcolumns = new DataSet();
            DSselectedcolumns.Tables.Add(dataTable);
            DTselectedcolumns = dataTable;

            gridControl16.DataSource = dataTable;

            //helper.setgridproperties_new(DSselectedcolumns, gridView3, gridControl3, "", helper.getnumbercharcols(dataTable, "N"), "nopaint", helper.getnumbercharcols(dataTable, "C"));

            helper.setgridproperties_newcopy(dataTable, gridView17, gridControl16);
            //   tabPane1.SelectedPageIndex = 6;

        }

        private void showProgressbarToolStripMenuItem_Click(object sender, EventArgs e)
        {
            flyoutPanel8.OwnerControl = button2;
            flyoutPanel8.ShowBeakForm();
        }

        private void accordionControlElement18_Click(object sender, EventArgs e)
        {
            xtraTabControl1.SelectedTabPageIndex = 5;
            label48.Text = "Customer Statements";
        }

        private void accordionControlElement19_Click(object sender, EventArgs e)
        {
            xtraTabControl1.SelectedTabPageIndex = 7;
            label48.Text = "Customer Relationships";
        }

        private void wizardControl1_PrevClick(object sender, DevExpress.XtraWizard.WizardCommandButtonClickEventArgs e)
        {
            string name = e.Page.Name;



            if (name == "completionWizardPage1")
            {
            tbcustomerwizard.Visible = true;
            button6.Visible = true;
        }
            else
            {
            tbcustomerwizard.Visible = false;
            button6.Visible = false;
            }
}
    }

}