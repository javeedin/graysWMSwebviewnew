# General Ledger (GL) Module - Requirements Document

**Version:** 1.0
**Date:** November 8, 2025
**Project:** WMS Application - Oracle-Compatible General Ledger Module

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Menu Structure](#2-menu-structure)
3. [Database Table Structure](#3-database-table-structure)
4. [User Management System](#4-user-management-system)
5. [Functional Requirements](#5-functional-requirements)
6. [Technical Requirements](#6-technical-requirements)
7. [Security Requirements](#7-security-requirements)

---

## 1. Introduction

### 1.1 Purpose
This document outlines the requirements for implementing a General Ledger (GL) module compatible with Oracle E-Business Suite General Ledger functionality within the WMS Application framework.

### 1.2 Scope
The GL module will provide comprehensive financial accounting capabilities including:
- Journal entry creation and management
- Chart of accounts management
- Period and calendar management
- Multi-currency support
- Budget management
- Consolidation and reporting
- Account inquiry and analysis

### 1.3 Reference
This design is based on Oracle E-Business Suite General Ledger R12 structure and functionality.

---

## 2. Menu Structure

The GL module follows the Oracle General Ledger menu hierarchy. Below is the complete navigation structure:

### 2.1 Main Menu Categories

#### **2.1.1 Setup**
- **Financials**
  - Accounting Setup Manager
    - Accounting Setups
      - Create Accounting Setup
      - Manage Accounting Setup
    - Define Ledger
    - Define Chart of Accounts

  - Flexfields
    - Key Flexfields
      - Segments
      - Values
      - Qualifiers
    - Descriptive Flexfields

  - Calendars
    - Accounting Calendar
    - Period Types
    - Period Sets

  - Currencies
    - Define Currency
    - Define Currency Rate Types
    - Enter Daily Rates
    - Mass Currency Rates

  - Organizations
    - Business Units
    - Legal Entities
    - Operating Units

- **Journals**
  - Sources
  - Categories
  - Document Sequences
  - Balancing Rules

- **Accounts**
  - Summary Templates
  - AutoAllocation
  - Mass Allocations
  - Recurring Journals

- **Budgets**
  - Define Budget Organization
  - Budget Formula
  - Budget Rules

- **Consolidation**
  - Consolidation Setup
  - Mapping Sets
  - Translation Rules

#### **2.1.2 Journals**
- **Enter**
  - Enter Journals
  - Import Journals (from GL_INTERFACE)
  - Create Journals

- **Review**
  - Find Journals
  - Reverse Journals
  - Delete Journals

- **Post**
  - Post Journals
  - Unpost Journals

- **Approve**
  - Approve Journals
  - Submit for Approval

- **Recurring Journals**
  - Define Recurring Journals
  - Generate Recurring Journals
  - Review Recurring Journals

- **Mass Allocations**
  - Define Mass Allocations
  - Generate Mass Allocations

#### **2.1.3 Budgets**
- **Define**
  - Define Budget
  - Budget Organization
  - Budget Rules

- **Enter**
  - Enter Budget
  - Load Budget (Import)

- **Review**
  - Budget Inquiry
  - Budget vs Actual Report

- **Control**
  - Enable Budget Control
  - Define Control Budget
  - Budget Journal

#### **2.1.4 Inquiry**
- **Account Inquiry**
  - Account Balances
  - Account Analysis
  - Drilldown to Journals

- **Journal Inquiry**
  - Journal Entry Inquiry
  - Posted Journals
  - Unposted Journals

- **Budget Inquiry**
  - Budget Balances
  - Budget vs Actual

- **Period Inquiry**
  - Period Status
  - Period Balances

#### **2.1.5 Reports**
- **Financial Reports**
  - Trial Balance
  - General Ledger Report
  - Account Analysis
  - Chart of Accounts Listing

- **Journal Reports**
  - Journal Register
  - Posting Register
  - Journal Entry Report
  - Unposted Journals Report

- **Budget Reports**
  - Budget Listing
  - Budget vs Actual Report
  - Budget Detail Report

- **Reconciliation Reports**
  - Account Reconciliation
  - Intercompany Reconciliation
  - Suspense Account Report

#### **2.1.6 Periods**
- **Open/Close**
  - Open Period
  - Close Period
  - Reopen Period

- **Status**
  - View Period Status
  - Update Period Status

#### **2.1.7 Consolidation**
- **Transfer**
  - Transfer to GL
  - Transfer Journals

- **Consolidation**
  - Consolidate Ledgers
  - Consolidation Workbench
  - Translation

- **Elimination**
  - Intercompany Elimination
  - Elimination Sets

#### **2.1.8 Tools**
- **Mass Maintenance**
  - Mass Journals Update
  - Mass Delete
  - Mass Copy

- **Interface**
  - GL Interface
  - Budget Interface

- **Archives**
  - Archive Journals
  - Purge Journals

#### **2.1.9 Processes**
- **Period Close**
  - Period Close Checklist
  - Run Period Close

- **Year End**
  - Year End Close
  - Retained Earnings Transfer

---

## 3. Database Table Structure

### 3.1 Core GL Tables

Based on Oracle General Ledger R12 architecture, the following table structure is required:

#### **3.1.1 Ledger and Accounting Setup Tables**

**GL_LEDGERS**
```sql
CREATE TABLE GL_LEDGERS (
    LEDGER_ID               NUMBER PRIMARY KEY,
    NAME                    VARCHAR2(100) NOT NULL,
    SHORT_NAME              VARCHAR2(30),
    DESCRIPTION             VARCHAR2(240),
    LEDGER_CATEGORY_CODE    VARCHAR2(30), -- PRIMARY, SECONDARY, ALC
    CURRENCY_CODE           VARCHAR2(15) NOT NULL,
    CHART_OF_ACCOUNTS_ID    NUMBER NOT NULL,
    PERIOD_SET_NAME         VARCHAR2(15),
    ACCOUNTED_PERIOD_TYPE   VARCHAR2(15),
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);
```

**GL_PERIODS**
```sql
CREATE TABLE GL_PERIODS (
    PERIOD_SET_NAME         VARCHAR2(15) NOT NULL,
    PERIOD_NAME             VARCHAR2(15) NOT NULL,
    PERIOD_YEAR             NUMBER NOT NULL,
    PERIOD_NUM              NUMBER NOT NULL,
    QUARTER_NUM             NUMBER,
    START_DATE              DATE NOT NULL,
    END_DATE                DATE NOT NULL,
    PERIOD_TYPE             VARCHAR2(15) NOT NULL,
    ADJUSTMENT_PERIOD_FLAG  VARCHAR2(1) DEFAULT 'N',
    YEAR_START_DATE         DATE,
    QUARTER_START_DATE      DATE,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    PRIMARY KEY (PERIOD_SET_NAME, PERIOD_NAME)
);
```

**GL_PERIOD_STATUSES**
```sql
CREATE TABLE GL_PERIOD_STATUSES (
    LEDGER_ID               NUMBER NOT NULL,
    PERIOD_NAME             VARCHAR2(15) NOT NULL,
    PERIOD_YEAR             NUMBER NOT NULL,
    PERIOD_NUM              NUMBER NOT NULL,
    CLOSING_STATUS          VARCHAR2(1), -- O=Open, C=Closed, P=Permanently Closed, N=Never Opened
    ADJUSTMENT_PERIOD_FLAG  VARCHAR2(1) DEFAULT 'N',
    EFFECTIVE_PERIOD_NUM    NUMBER,
    START_DATE              DATE NOT NULL,
    END_DATE                DATE NOT NULL,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    PRIMARY KEY (LEDGER_ID, PERIOD_NAME),
    FOREIGN KEY (LEDGER_ID) REFERENCES GL_LEDGERS(LEDGER_ID)
);
```

**GL_PERIOD_SETS**
```sql
CREATE TABLE GL_PERIOD_SETS (
    PERIOD_SET_NAME         VARCHAR2(15) PRIMARY KEY,
    DESCRIPTION             VARCHAR2(240),
    FIRST_PERIOD_NAME       VARCHAR2(15),
    LAST_PERIOD_NAME        VARCHAR2(15),
    NUMBER_OF_PERIODS       NUMBER,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);
```

**GL_PERIOD_TYPES**
```sql
CREATE TABLE GL_PERIOD_TYPES (
    PERIOD_TYPE             VARCHAR2(15) PRIMARY KEY,
    DESCRIPTION             VARCHAR2(240),
    NUMBER_PER_FISCAL_YEAR  NUMBER,
    YEAR_TYPE_NAME          VARCHAR2(15),
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);
```

#### **3.1.2 Chart of Accounts Tables**

**GL_CODE_COMBINATIONS**
```sql
CREATE TABLE GL_CODE_COMBINATIONS (
    CODE_COMBINATION_ID     NUMBER PRIMARY KEY,
    CHART_OF_ACCOUNTS_ID    NUMBER NOT NULL,
    SEGMENT1                VARCHAR2(30), -- Company
    SEGMENT2                VARCHAR2(30), -- Cost Center
    SEGMENT3                VARCHAR2(30), -- Account
    SEGMENT4                VARCHAR2(30), -- Sub Account
    SEGMENT5                VARCHAR2(30), -- Product
    SEGMENT6                VARCHAR2(30), -- Future Use
    SEGMENT7                VARCHAR2(30), -- Future Use
    SEGMENT8                VARCHAR2(30), -- Future Use
    CONCATENATED_SEGMENTS   VARCHAR2(240),
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    START_DATE_ACTIVE       DATE,
    END_DATE_ACTIVE         DATE,
    SUMMARY_FLAG            VARCHAR2(1) DEFAULT 'N',
    DETAIL_BUDGETING_ALLOWED VARCHAR2(1) DEFAULT 'Y',
    DETAIL_POSTING_ALLOWED  VARCHAR2(1) DEFAULT 'Y',
    ACCOUNT_TYPE            VARCHAR2(1), -- A=Asset, L=Liability, O=Owners Equity, R=Revenue, E=Expense
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);
```

**GL_ACCOUNTS**
```sql
CREATE TABLE GL_ACCOUNTS (
    CODE_COMBINATION_ID     NUMBER PRIMARY KEY,
    ACCOUNT_NUMBER          VARCHAR2(240),
    ACCOUNT_DESC            VARCHAR2(240),
    ACCOUNT_TYPE            VARCHAR2(1), -- A, L, O, R, E
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    FOREIGN KEY (CODE_COMBINATION_ID) REFERENCES GL_CODE_COMBINATIONS(CODE_COMBINATION_ID)
);
```

#### **3.1.3 Journal Entry Tables**

**GL_JE_BATCHES**
```sql
CREATE TABLE GL_JE_BATCHES (
    JE_BATCH_ID             NUMBER PRIMARY KEY,
    LEDGER_ID               NUMBER NOT NULL,
    NAME                    VARCHAR2(100) NOT NULL,
    DESCRIPTION             VARCHAR2(240),
    STATUS                  VARCHAR2(1), -- U=Unposted, P=Posted, S=Selected, I=In Process
    DEFAULT_PERIOD_NAME     VARCHAR2(15),
    POSTING_RUN_ID          NUMBER,
    APPROVAL_STATUS_CODE    VARCHAR2(30), -- A=Approved, R=Rejected, P=Pending
    BUDGET_VERSION_ID       NUMBER,
    CONTROL_TOTAL           NUMBER,
    RUNNING_TOTAL_DR        NUMBER,
    RUNNING_TOTAL_CR        NUMBER,
    RUNNING_TOTAL_ACCOUNTED_DR NUMBER,
    RUNNING_TOTAL_ACCOUNTED_CR NUMBER,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    FOREIGN KEY (LEDGER_ID) REFERENCES GL_LEDGERS(LEDGER_ID)
);
```

**GL_JE_HEADERS**
```sql
CREATE TABLE GL_JE_HEADERS (
    JE_HEADER_ID            NUMBER PRIMARY KEY,
    JE_BATCH_ID             NUMBER NOT NULL,
    LEDGER_ID               NUMBER NOT NULL,
    NAME                    VARCHAR2(100) NOT NULL,
    DESCRIPTION             VARCHAR2(240),
    PERIOD_NAME             VARCHAR2(15) NOT NULL,
    POSTED_DATE             DATE,
    STATUS                  VARCHAR2(1), -- U=Unposted, P=Posted, S=Selected, I=In Process
    JE_SOURCE               VARCHAR2(25) NOT NULL,
    JE_CATEGORY             VARCHAR2(25) NOT NULL,
    CURRENCY_CODE           VARCHAR2(15) NOT NULL,
    ACTUAL_FLAG             VARCHAR2(1) DEFAULT 'A', -- A=Actual, B=Budget, E=Encumbrance
    ACCRUAL_REV_FLAG        VARCHAR2(1),
    ACCRUAL_REV_EFFECTIVE_DATE DATE,
    ACCRUAL_REV_JE_HEADER_ID NUMBER,
    EXTERNAL_REFERENCE      VARCHAR2(240),
    REVERSED_JE_HEADER_ID   NUMBER,
    REVERSAL_FLAG           VARCHAR2(1),
    REVERSAL_METHOD         VARCHAR2(30),
    REVERSAL_PERIOD_NAME    VARCHAR2(15),
    DOC_SEQUENCE_ID         NUMBER,
    DOC_SEQUENCE_VALUE      NUMBER,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    FOREIGN KEY (JE_BATCH_ID) REFERENCES GL_JE_BATCHES(JE_BATCH_ID),
    FOREIGN KEY (LEDGER_ID) REFERENCES GL_LEDGERS(LEDGER_ID)
);
```

**GL_JE_LINES**
```sql
CREATE TABLE GL_JE_LINES (
    JE_HEADER_ID            NUMBER NOT NULL,
    JE_LINE_NUM             NUMBER NOT NULL,
    CODE_COMBINATION_ID     NUMBER NOT NULL,
    PERIOD_NAME             VARCHAR2(15) NOT NULL,
    EFFECTIVE_DATE          DATE,
    STATUS                  VARCHAR2(1), -- U=Unposted, P=Posted
    ENTERED_DR              NUMBER,
    ENTERED_CR              NUMBER,
    ACCOUNTED_DR            NUMBER,
    ACCOUNTED_CR            NUMBER,
    DESCRIPTION             VARCHAR2(240),
    REFERENCE_1             VARCHAR2(100),
    REFERENCE_2             VARCHAR2(100),
    REFERENCE_3             VARCHAR2(100),
    REFERENCE_4             VARCHAR2(240),
    REFERENCE_5             VARCHAR2(240),
    ATTRIBUTE1              VARCHAR2(150), -- Descriptive Flexfield
    ATTRIBUTE2              VARCHAR2(150),
    ATTRIBUTE3              VARCHAR2(150),
    ATTRIBUTE4              VARCHAR2(150),
    ATTRIBUTE5              VARCHAR2(150),
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    PRIMARY KEY (JE_HEADER_ID, JE_LINE_NUM),
    FOREIGN KEY (JE_HEADER_ID) REFERENCES GL_JE_HEADERS(JE_HEADER_ID),
    FOREIGN KEY (CODE_COMBINATION_ID) REFERENCES GL_CODE_COMBINATIONS(CODE_COMBINATION_ID)
);
```

**GL_JE_SOURCES**
```sql
CREATE TABLE GL_JE_SOURCES (
    JE_SOURCE_NAME          VARCHAR2(25) PRIMARY KEY,
    DESCRIPTION             VARCHAR2(240),
    USER_JE_SOURCE_NAME     VARCHAR2(25),
    LANGUAGE                VARCHAR2(4),
    IMPORT_ALLOWED_FLAG     VARCHAR2(1) DEFAULT 'Y',
    FREEZE_FLAG             VARCHAR2(1) DEFAULT 'N',
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);
```

**GL_JE_CATEGORIES**
```sql
CREATE TABLE GL_JE_CATEGORIES (
    JE_CATEGORY_NAME        VARCHAR2(25) PRIMARY KEY,
    DESCRIPTION             VARCHAR2(240),
    USER_JE_CATEGORY_NAME   VARCHAR2(25),
    LANGUAGE                VARCHAR2(4),
    CONSOLIDATION_FLAG      VARCHAR2(1) DEFAULT 'N',
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);
```

#### **3.1.4 Balance Tables**

**GL_BALANCES**
```sql
CREATE TABLE GL_BALANCES (
    LEDGER_ID               NUMBER NOT NULL,
    CODE_COMBINATION_ID     NUMBER NOT NULL,
    CURRENCY_CODE           VARCHAR2(15) NOT NULL,
    PERIOD_NAME             VARCHAR2(15) NOT NULL,
    PERIOD_YEAR             NUMBER NOT NULL,
    PERIOD_NUM              NUMBER NOT NULL,
    ACTUAL_FLAG             VARCHAR2(1) NOT NULL, -- A, B, E
    BEGIN_BALANCE_DR        NUMBER DEFAULT 0,
    BEGIN_BALANCE_CR        NUMBER DEFAULT 0,
    PERIOD_NET_DR           NUMBER DEFAULT 0,
    PERIOD_NET_CR           NUMBER DEFAULT 0,
    QUARTER_TO_DATE_DR      NUMBER DEFAULT 0,
    QUARTER_TO_DATE_CR      NUMBER DEFAULT 0,
    YEAR_TO_DATE_DR         NUMBER DEFAULT 0,
    YEAR_TO_DATE_CR         NUMBER DEFAULT 0,
    PROJECT_TO_DATE_DR      NUMBER DEFAULT 0,
    PROJECT_TO_DATE_CR      NUMBER DEFAULT 0,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    PRIMARY KEY (LEDGER_ID, CODE_COMBINATION_ID, CURRENCY_CODE, PERIOD_NAME, ACTUAL_FLAG),
    FOREIGN KEY (LEDGER_ID) REFERENCES GL_LEDGERS(LEDGER_ID),
    FOREIGN KEY (CODE_COMBINATION_ID) REFERENCES GL_CODE_COMBINATIONS(CODE_COMBINATION_ID)
);
```

**GL_DAILY_BALANCES**
```sql
CREATE TABLE GL_DAILY_BALANCES (
    LEDGER_ID               NUMBER NOT NULL,
    CODE_COMBINATION_ID     NUMBER NOT NULL,
    CURRENCY_CODE           VARCHAR2(15) NOT NULL,
    PERIOD_NAME             VARCHAR2(15) NOT NULL,
    ACCOUNTING_DATE         DATE NOT NULL,
    ACTUAL_FLAG             VARCHAR2(1) NOT NULL,
    BEGIN_BALANCE_DR        NUMBER DEFAULT 0,
    BEGIN_BALANCE_CR        NUMBER DEFAULT 0,
    PERIOD_NET_DR           NUMBER DEFAULT 0,
    PERIOD_NET_CR           NUMBER DEFAULT 0,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    PRIMARY KEY (LEDGER_ID, CODE_COMBINATION_ID, CURRENCY_CODE, ACCOUNTING_DATE, ACTUAL_FLAG)
);
```

#### **3.1.5 Budget Tables**

**GL_BUDGETS**
```sql
CREATE TABLE GL_BUDGETS (
    BUDGET_VERSION_ID       NUMBER PRIMARY KEY,
    LEDGER_ID               NUMBER NOT NULL,
    BUDGET_NAME             VARCHAR2(15) NOT NULL,
    DESCRIPTION             VARCHAR2(240),
    STATUS                  VARCHAR2(1), -- O=Open, F=Frozen, C=Current
    DATE_OPENED             DATE,
    DATE_CLOSED             DATE,
    BUDGET_TYPE             VARCHAR2(1), -- S=Standard, F=Financial Planning
    FIRST_VALID_PERIOD_NAME VARCHAR2(15),
    LAST_VALID_PERIOD_NAME  VARCHAR2(15),
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    FOREIGN KEY (LEDGER_ID) REFERENCES GL_LEDGERS(LEDGER_ID)
);
```

**GL_BUDGET_ASSIGNMENTS**
```sql
CREATE TABLE GL_BUDGET_ASSIGNMENTS (
    LEDGER_ID               NUMBER NOT NULL,
    CODE_COMBINATION_ID     NUMBER NOT NULL,
    CURRENCY_CODE           VARCHAR2(15) NOT NULL,
    BUDGET_VERSION_ID       NUMBER NOT NULL,
    RANGE_ID                NUMBER,
    LAST_VALID_PERIOD_NAME  VARCHAR2(15),
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    PRIMARY KEY (LEDGER_ID, CODE_COMBINATION_ID, CURRENCY_CODE, BUDGET_VERSION_ID),
    FOREIGN KEY (BUDGET_VERSION_ID) REFERENCES GL_BUDGETS(BUDGET_VERSION_ID)
);
```

#### **3.1.6 Interface Tables**

**GL_INTERFACE**
```sql
CREATE TABLE GL_INTERFACE (
    STATUS                  VARCHAR2(30), -- NEW, PENDING, POSTED, ERROR
    LEDGER_ID               NUMBER NOT NULL,
    USER_JE_SOURCE_NAME     VARCHAR2(25) NOT NULL,
    USER_JE_CATEGORY_NAME   VARCHAR2(25) NOT NULL,
    ACCOUNTING_DATE         DATE NOT NULL,
    CURRENCY_CODE           VARCHAR2(15) NOT NULL,
    DATE_CREATED            DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    ACTUAL_FLAG             VARCHAR2(1) DEFAULT 'A',
    SEGMENT1                VARCHAR2(30),
    SEGMENT2                VARCHAR2(30),
    SEGMENT3                VARCHAR2(30),
    SEGMENT4                VARCHAR2(30),
    SEGMENT5                VARCHAR2(30),
    SEGMENT6                VARCHAR2(30),
    SEGMENT7                VARCHAR2(30),
    SEGMENT8                VARCHAR2(30),
    ENTERED_DR              NUMBER,
    ENTERED_CR              NUMBER,
    ACCOUNTED_DR            NUMBER,
    ACCOUNTED_CR            NUMBER,
    REFERENCE1              VARCHAR2(100),
    REFERENCE2              VARCHAR2(100),
    REFERENCE3              VARCHAR2(100),
    REFERENCE4              VARCHAR2(240),
    REFERENCE5              VARCHAR2(240),
    REFERENCE10             VARCHAR2(240),
    GROUP_ID                NUMBER,
    REQUEST_ID              NUMBER,
    PERIOD_NAME             VARCHAR2(15),
    CHART_OF_ACCOUNTS_ID    NUMBER
);
```

#### **3.1.7 Currency Tables**

**FND_CURRENCIES**
```sql
CREATE TABLE FND_CURRENCIES (
    CURRENCY_CODE           VARCHAR2(15) PRIMARY KEY,
    CURRENCY_NAME           VARCHAR2(60),
    DESCRIPTION             VARCHAR2(240),
    PRECISION               NUMBER,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    START_DATE_ACTIVE       DATE,
    END_DATE_ACTIVE         DATE,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);
```

**GL_DAILY_RATES**
```sql
CREATE TABLE GL_DAILY_RATES (
    FROM_CURRENCY           VARCHAR2(15) NOT NULL,
    TO_CURRENCY             VARCHAR2(15) NOT NULL,
    CONVERSION_DATE         DATE NOT NULL,
    CONVERSION_TYPE         VARCHAR2(30) NOT NULL,
    CONVERSION_RATE         NUMBER NOT NULL,
    STATUS_CODE             VARCHAR2(15),
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    PRIMARY KEY (FROM_CURRENCY, TO_CURRENCY, CONVERSION_DATE, CONVERSION_TYPE)
);
```

---

## 4. User Management System

### 4.1 Overview
The user management system provides authentication, authorization, and access control for the GL module.

### 4.2 User Management Tables

#### **4.2.1 Users Table**

**FND_USERS**
```sql
CREATE TABLE FND_USERS (
    USER_ID                 NUMBER PRIMARY KEY,
    USER_NAME               VARCHAR2(100) NOT NULL UNIQUE,
    ENCRYPTED_PASSWORD      VARCHAR2(255) NOT NULL,
    EMAIL_ADDRESS           VARCHAR2(240),
    DESCRIPTION             VARCHAR2(240),
    START_DATE              DATE,
    END_DATE                DATE,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    LAST_LOGIN_DATE         DATE,
    FAILED_LOGIN_ATTEMPTS   NUMBER DEFAULT 0,
    PASSWORD_EXPIRY_DATE    DATE,
    PASSWORD_CHANGE_DATE    DATE,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);
```

#### **4.2.2 User Sessions Table**

**FND_USER_SESSIONS**
```sql
CREATE TABLE FND_USER_SESSIONS (
    SESSION_ID              NUMBER PRIMARY KEY,
    USER_ID                 NUMBER NOT NULL,
    INSTANCE_NAME           VARCHAR2(100) NOT NULL,
    SESSION_TOKEN           VARCHAR2(255) NOT NULL,
    LOGIN_TIME              TIMESTAMP NOT NULL,
    LAST_ACTIVITY_TIME      TIMESTAMP NOT NULL,
    IP_ADDRESS              VARCHAR2(50),
    USER_AGENT              VARCHAR2(500),
    STATUS                  VARCHAR2(20) DEFAULT 'ACTIVE', -- ACTIVE, EXPIRED, LOGGED_OUT
    CREATION_DATE           DATE NOT NULL,
    FOREIGN KEY (USER_ID) REFERENCES FND_USERS(USER_ID)
);
```

#### **4.2.3 Roles Table**

**FND_ROLES**
```sql
CREATE TABLE FND_ROLES (
    ROLE_ID                 NUMBER PRIMARY KEY,
    ROLE_NAME               VARCHAR2(100) NOT NULL UNIQUE,
    DISPLAY_NAME            VARCHAR2(240),
    DESCRIPTION             VARCHAR2(500),
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    START_DATE              DATE,
    END_DATE                DATE,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);
```

**Sample Roles:**
- GL_SUPER_USER
- GL_SUPERVISOR
- GL_CONTROLLER
- GL_BUDGET_USER
- GL_USER
- GL_INQUIRE_ONLY

#### **4.2.4 User-Role Assignment Table**

**FND_USER_ROLE_ASSIGNMENTS**
```sql
CREATE TABLE FND_USER_ROLE_ASSIGNMENTS (
    USER_ROLE_ID            NUMBER PRIMARY KEY,
    USER_ID                 NUMBER NOT NULL,
    ROLE_ID                 NUMBER NOT NULL,
    START_DATE              DATE,
    END_DATE                DATE,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    FOREIGN KEY (USER_ID) REFERENCES FND_USERS(USER_ID),
    FOREIGN KEY (ROLE_ID) REFERENCES FND_ROLES(ROLE_ID),
    UNIQUE (USER_ID, ROLE_ID)
);
```

#### **4.2.5 Menus Table**

**FND_MENUS**
```sql
CREATE TABLE FND_MENUS (
    MENU_ID                 NUMBER PRIMARY KEY,
    MENU_NAME               VARCHAR2(100) NOT NULL UNIQUE,
    DISPLAY_NAME            VARCHAR2(240),
    DESCRIPTION             VARCHAR2(500),
    PARENT_MENU_ID          NUMBER,
    MENU_TYPE               VARCHAR2(30), -- MAIN, SUBMENU, ACTION
    SEQUENCE                NUMBER,
    FUNCTION_NAME           VARCHAR2(100),
    URL                     VARCHAR2(500),
    ICON                    VARCHAR2(100),
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    FOREIGN KEY (PARENT_MENU_ID) REFERENCES FND_MENUS(MENU_ID)
);
```

#### **4.2.6 Role-Menu Assignment Table**

**FND_ROLE_MENU_ASSIGNMENTS**
```sql
CREATE TABLE FND_ROLE_MENU_ASSIGNMENTS (
    ROLE_MENU_ID            NUMBER PRIMARY KEY,
    ROLE_ID                 NUMBER NOT NULL,
    MENU_ID                 NUMBER NOT NULL,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    FOREIGN KEY (ROLE_ID) REFERENCES FND_ROLES(ROLE_ID),
    FOREIGN KEY (MENU_ID) REFERENCES FND_MENUS(MENU_ID),
    UNIQUE (ROLE_ID, MENU_ID)
);
```

#### **4.2.7 Business Units Table**

**HR_BUSINESS_UNITS**
```sql
CREATE TABLE HR_BUSINESS_UNITS (
    BU_ID                   NUMBER PRIMARY KEY,
    BU_NAME                 VARCHAR2(240) NOT NULL UNIQUE,
    BU_CODE                 VARCHAR2(30),
    DESCRIPTION             VARCHAR2(500),
    PARENT_BU_ID            NUMBER,
    LEDGER_ID               NUMBER,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    START_DATE              DATE,
    END_DATE                DATE,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    FOREIGN KEY (PARENT_BU_ID) REFERENCES HR_BUSINESS_UNITS(BU_ID),
    FOREIGN KEY (LEDGER_ID) REFERENCES GL_LEDGERS(LEDGER_ID)
);
```

#### **4.2.8 Access Rights (User-BU Assignment) Table**

**FND_USER_BU_ASSIGNMENTS**
```sql
CREATE TABLE FND_USER_BU_ASSIGNMENTS (
    USER_BU_ID              NUMBER PRIMARY KEY,
    USER_ID                 NUMBER NOT NULL,
    BU_ID                   NUMBER NOT NULL,
    ACCESS_TYPE             VARCHAR2(30), -- FULL, READ_ONLY, LIMITED
    START_DATE              DATE,
    END_DATE                DATE,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y',
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    FOREIGN KEY (USER_ID) REFERENCES FND_USERS(USER_ID),
    FOREIGN KEY (BU_ID) REFERENCES HR_BUSINESS_UNITS(BU_ID),
    UNIQUE (USER_ID, BU_ID)
);
```

### 4.3 User Management System Flow

```
1. User Login
   ├── Input: Username, Password, Instance Name
   ├── Validation
   │   ├── Check USER_NAME exists in FND_USERS
   │   ├── Verify ENCRYPTED_PASSWORD
   │   ├── Validate INSTANCE_NAME
   │   └── Check ENABLED_FLAG = 'Y'
   ├── Session Creation
   │   ├── Generate SESSION_TOKEN
   │   ├── Insert into FND_USER_SESSIONS
   │   └── Update LAST_LOGIN_DATE in FND_USERS
   └── Load User Context
       ├── Get Roles (FND_USER_ROLE_ASSIGNMENTS)
       ├── Get Menus (FND_ROLE_MENU_ASSIGNMENTS)
       └── Get Business Units (FND_USER_BU_ASSIGNMENTS)

2. Menu Access Control
   ├── Load user's roles
   ├── For each role, load assigned menus
   ├── Build menu tree based on PARENT_MENU_ID
   └── Display enabled menus only

3. Data Access Control
   ├── Filter data by assigned Business Units
   ├── Apply role-based permissions
   └── Enforce access type (FULL, READ_ONLY, LIMITED)
```

---

## 5. Functional Requirements

### 5.1 Authentication & Authorization

**FR-1.1: Login Screen**
- Must support Username field (required)
- Must support Password field (required, masked)
- Must support Instance Name field (required)
- Must validate credentials against FND_USERS table
- Must create session upon successful login
- Must track failed login attempts (max 5 attempts)
- Must lock account after 5 failed attempts

**FR-1.2: Session Management**
- Session timeout after 30 minutes of inactivity
- Ability to extend session
- Secure session token generation
- Session tracking in FND_USER_SESSIONS

**FR-1.3: Role-Based Access Control**
- Users assigned to one or more roles
- Roles determine menu access
- Role hierarchy support

### 5.2 Journal Entry Management

**FR-2.1: Create Journal Entry**
- Enter batch-level information
- Enter header-level information
- Enter line-level information
- Support multi-line entries
- Validate debit/credit balance
- Support foreign currency
- Auto-populate concatenated segments

**FR-2.2: Review Journal Entry**
- Search journals by multiple criteria
- View batch summary
- View journal details
- Drilldown to journal lines

**FR-2.3: Post Journal Entry**
- Validate journal completeness
- Check period status (must be Open)
- Update GL_BALANCES
- Update period net totals
- Mark journal as Posted

**FR-2.4: Reverse Journal Entry**
- Support manual reversal
- Support automatic reversal
- Create offsetting entries
- Link to original journal

### 5.3 Chart of Accounts

**FR-3.1: Define Chart of Accounts**
- Support multi-segment structure
- Define segment qualifiers
- Support value sets

**FR-3.2: Account Combinations**
- Validate segment combinations
- Cross-validation rules
- Dynamic insertion support

### 5.4 Period Management

**FR-4.1: Open/Close Periods**
- Open accounting periods
- Close accounting periods
- Period close validation
- Prevent posting to closed periods

**FR-4.2: Period Status**
- View period status by ledger
- Period close checklist

### 5.5 Budgets

**FR-5.1: Define Budget**
- Create budget versions
- Set budget status
- Define valid periods

**FR-5.2: Enter Budget**
- Enter budget amounts by account
- Support budget formulas
- Import budget data

**FR-5.3: Budget Inquiry**
- View budget vs actual
- Variance analysis

### 5.6 Inquiry & Reporting

**FR-6.1: Account Inquiry**
- View account balances by period
- Drilldown to transactions
- Multi-currency view

**FR-6.2: Journal Inquiry**
- Search journals
- View journal details
- Export journal data

**FR-6.3: Standard Reports**
- Trial Balance
- General Ledger Report
- Account Analysis
- Journal Register

### 5.7 Multi-Currency

**FR-7.1: Currency Support**
- Support multiple currencies
- Daily exchange rates
- Currency conversion

**FR-7.2: Translation**
- Functional currency translation
- Reporting currency

---

## 6. Technical Requirements

### 6.1 Technology Stack

**Frontend:**
- HTML5
- CSS3
- JavaScript (ES6+)
- WebView2 compatible

**Backend:**
- C# .NET 8
- Oracle Database (or compatible RDBMS)
- RESTful API architecture

### 6.2 Database Requirements

**DB-1: Oracle Compatibility**
- Table structure compatible with Oracle GL
- SQL syntax compatible with Oracle
- Support for stored procedures
- Support for triggers

**DB-2: Data Integrity**
- Primary key constraints
- Foreign key constraints
- Check constraints
- Default values

**DB-3: Indexing**
- Indexes on primary keys
- Indexes on foreign keys
- Indexes on frequently queried columns
- Composite indexes for performance

**DB-4: Audit Trail**
- CREATION_DATE on all tables
- CREATED_BY on all tables
- LAST_UPDATE_DATE on all tables
- LAST_UPDATED_BY on all tables

### 6.3 Performance Requirements

**PERF-1: Response Time**
- Login: < 2 seconds
- Menu load: < 1 second
- Journal entry save: < 3 seconds
- Account inquiry: < 5 seconds
- Report generation: < 30 seconds

**PERF-2: Scalability**
- Support 100+ concurrent users
- Handle 10,000+ journal entries per day
- Support 1 million+ GL_BALANCES records

### 6.4 API Requirements

**API-1: RESTful Endpoints**
```
Authentication:
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/refresh-token

Journals:
GET    /api/gl/journals
GET    /api/gl/journals/{id}
POST   /api/gl/journals
PUT    /api/gl/journals/{id}
DELETE /api/gl/journals/{id}
POST   /api/gl/journals/{id}/post
POST   /api/gl/journals/{id}/reverse

Accounts:
GET    /api/gl/accounts
GET    /api/gl/accounts/{id}
GET    /api/gl/accounts/{id}/balance

Periods:
GET    /api/gl/periods
POST   /api/gl/periods/{id}/open
POST   /api/gl/periods/{id}/close

Budgets:
GET    /api/gl/budgets
POST   /api/gl/budgets
GET    /api/gl/budgets/{id}

Users:
GET    /api/users
POST   /api/users
GET    /api/users/{id}
PUT    /api/users/{id}

Roles:
GET    /api/roles
POST   /api/roles
GET    /api/users/{id}/roles

Menus:
GET    /api/menus
GET    /api/users/{id}/menus

Business Units:
GET    /api/business-units
GET    /api/users/{id}/business-units
```

---

## 7. Security Requirements

### 7.1 Authentication Security

**SEC-1.1: Password Policy**
- Minimum 8 characters
- Require uppercase, lowercase, number, special character
- Password expiry after 90 days
- Cannot reuse last 5 passwords
- Account lockout after 5 failed attempts

**SEC-1.2: Session Security**
- Secure session token generation (UUID or JWT)
- Session timeout after 30 minutes inactivity
- Session invalidation on logout
- Single sign-on support

### 7.2 Authorization Security

**SEC-2.1: Role-Based Access**
- Users must be assigned to role
- Menu access based on role
- Data access based on business unit assignment

**SEC-2.2: Data Security**
- Users can only access assigned business units
- Read-only users cannot modify data
- Audit trail for all data changes

### 7.3 Communication Security

**SEC-3.1: Transport Security**
- HTTPS required for all API calls
- TLS 1.2 or higher
- Certificate validation

**SEC-3.2: Data Encryption**
- Passwords encrypted using bcrypt or PBKDF2
- Sensitive data encrypted at rest
- Session tokens encrypted

### 7.4 Audit & Compliance

**SEC-4.1: Audit Trail**
- Log all user logins
- Log all data changes
- Retain audit logs for 7 years
- Tamper-proof audit logs

**SEC-4.2: Compliance**
- SOX compliance for financial data
- GDPR compliance for user data
- Data retention policies

---

## 8. Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- Implement login screen
- Create user management tables
- Implement authentication API
- Create session management

### Phase 2: Core GL Setup (Weeks 3-4)
- Create GL tables
- Implement ledger setup
- Implement chart of accounts
- Implement period management

### Phase 3: Journal Entry (Weeks 5-6)
- Implement journal entry forms
- Implement journal posting
- Implement journal inquiry
- Implement journal reports

### Phase 4: Budgets & Inquiry (Weeks 7-8)
- Implement budget functionality
- Implement account inquiry
- Implement standard reports
- Implement currency support

### Phase 5: Advanced Features (Weeks 9-10)
- Implement consolidation
- Implement intercompany
- Performance optimization
- User acceptance testing

---

## 9. Appendix

### 9.1 Oracle GL Reference Documents
- Oracle General Ledger User's Guide (R12)
- Oracle General Ledger Implementation Guide (R12)
- Oracle Applications Developer's Guide
- Oracle E-Business Suite Security Guide

### 9.2 Database ERD
(To be created separately showing table relationships)

### 9.3 Menu Hierarchy Diagram
(To be created separately showing complete menu tree)

### 9.4 User Management Flow Diagram
(To be created separately showing authentication/authorization flow)

---

**End of Requirements Document**

**Document Control:**
- Version: 1.0
- Last Updated: November 8, 2025
- Next Review: December 8, 2025
- Owner: Development Team
