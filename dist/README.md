# Gray's WMS WebView Application

A Windows Forms application using WebView2 to provide a modern web-based interface for Warehouse Management System (WMS) operations, integrated with Oracle APEX REST APIs.

## Overview

This application combines:
- **C# Windows Forms**: Desktop application framework with WebView2 browser control
- **Modern Web UI**: HTML/CSS/JavaScript with DevExtreme components
- **Oracle APEX REST APIs**: Backend data storage and business logic
- **Local Printer Integration**: Direct access to Windows printers for label printing

## Features

- **Trip Management**: Create, view, and manage warehouse trips
- **Printer Management**: Configure multiple printer profiles with Oracle Fusion credentials
- **Inventory Onhand**: Search and display inventory levels
- **Receiving**: Process incoming shipments
- **Auto-Print**: Automatically download and print documents from Oracle Fusion

## Project Structure

```
graysWMSwebviewnew/
├── Program.cs                      # Application entry point
├── Form1.cs                        # Main form with WebView2 control
├── Form1.Designer.cs               # Form designer code
├── WMSApp.csproj                   # Visual Studio project file
├── index.html                      # Main UI HTML
├── app.js                          # Application JavaScript logic
├── config.js                       # API configuration
├── printer-management-new.js       # Printer management module
├── styles.css                      # Application styles
├── classes/                        # C# helper classes
│   ├── ApexHtmlFileDownloader.cs
│   ├── ClaudeApiHandler.cs
│   ├── PrintJobManager.cs
│   ├── PrinterService.cs
│   ├── LocalStorageManager.cs
│   └── ... (other helper classes)
├── apex_sql/                       # Oracle APEX database scripts
│   ├── 01_tables.sql
│   ├── 02_procedures_get.sql
│   ├── 03_procedures_post.sql
│   ├── 04_apex_endpoints_get.sql
│   ├── 05_apex_endpoints_post.sql
│   ├── 06_additional_printer_procedures.sql
│   └── 07_printer_management_endpoints.sql
└── docs/                           # Documentation
    └── PRINTER_SETUP_GUIDE.md
```

## Prerequisites

- **Windows 10/11** (required for WebView2)
- **Visual Studio 2022** or later
- **.NET 8.0 SDK** or later
- **Oracle APEX** workspace with REST API access
- **WebView2 Runtime** (usually pre-installed on Windows 11)

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/javeedin/graysWMSwebviewnew.git
cd graysWMSwebviewnew
```

### 2. Configure APEX API URL

Edit `config.js` and update the APEX base URL:

```javascript
const API_CONFIG = {
    APEX_BASE_URL: 'https://your-apex-instance.oraclecloudapps.com/ords/workspace/schema',
    DEBUG: true,
    TIMEOUT: 30000
};
```

### 3. Setup Database

Run the SQL scripts in order from the `apex_sql/` folder:

1. `01_tables.sql` - Create database tables
2. `02_procedures_get.sql` - Create GET procedures
3. `03_procedures_post.sql` - Create POST procedures
4. `04_apex_endpoints_get.sql` - Create GET REST endpoints in APEX
5. `05_apex_endpoints_post.sql` - Create POST REST endpoints in APEX
6. `06_additional_printer_procedures.sql` - Printer management procedures
7. `07_printer_management_endpoints.sql` - Printer REST endpoints

### 4. Build and Run

**Option A: Visual Studio**
1. Open `WMSApp.csproj` in Visual Studio
2. Restore NuGet packages (automatic)
3. Press F5 to build and run

**Option B: Command Line**
```bash
dotnet restore
dotnet build
dotnet run
```

### 5. First Launch

On first launch:
1. Go to "Printer Setup New" menu
2. Click "Add Printer"
3. Configure at least one printer with your Oracle Fusion credentials
4. Test the printer connection
5. Set it as active

## Key Technologies

- **WebView2**: Microsoft's Chromium-based browser control
- **DevExtreme**: JavaScript UI components for data grids
- **Oracle APEX**: Low-code platform with REST APIs
- **Windows Forms**: Desktop application framework
- **HTP.p() JSON Building**: Manual JSON construction in Oracle PL/SQL

## API Endpoints

All endpoints are relative to the configured `APEX_BASE_URL`:

### Printer Management
- `GET /printers/all` - Get all configured printers
- `POST /config/printer` - Add new printer configuration
- `POST /printers/set-active` - Set active printer
- `POST /printers/delete` - Delete printer configuration

### Trip Management
- `GET /trips` - Get all trips
- `POST /trips` - Create new trip
- `GET /trips/{id}` - Get trip details
- `GET /trips/stats` - Get trip statistics

## File Copy Configuration

The `.csproj` file is configured to automatically copy web files to the output directory on build:

```xml
<ItemGroup>
  <None Update="*.html">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </None>
  <None Update="*.js">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </None>
  <None Update="*.css">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </None>
</ItemGroup>
```

This ensures that any changes to HTML/JS/CSS files are immediately available after rebuild.

## Troubleshooting

### Changes Not Appearing in App

1. Click the "Clear Cache" button (trash can icon) in the toolbar
2. Rebuild the project to copy updated files
3. Restart the application

### WebView2 Not Working

- Ensure WebView2 Runtime is installed: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- On Windows 11, it should be pre-installed

### APEX API Errors

- Verify the `config.js` URL is correct
- Check that all SQL scripts have been run
- Ensure APEX REST endpoints are enabled
- Check Oracle database connection

### Printer Not Found

- Ensure printer is installed on Windows
- Check printer name matches exactly (case-sensitive)
- Verify printer is not offline or paused

## Development

### Folder Structure Philosophy

This project uses a **flat folder structure** for simplicity:
- All C# files in root
- All web files (HTML/JS/CSS) in root
- Helper classes in `classes/` subfolder
- SQL scripts in `apex_sql/` subfolder
- Documentation in `docs/` subfolder

This structure avoids confusion and ensures files are easy to find.

### Making Changes

1. **Web UI changes**: Edit `index.html`, `app.js`, `styles.css`
2. **Printer logic**: Edit `printer-management-new.js`
3. **API config**: Edit `config.js`
4. **C# backend**: Edit `Form1.cs` or helper classes
5. **Database**: Add new SQL scripts to `apex_sql/` folder

After any changes, rebuild the project and clear cache in the app.

## License

Proprietary - Internal use only for Gray's WMS operations.

## Support

For issues or questions, contact the development team.
