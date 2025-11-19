# General Ledger Module - Requirements & Documentation

## Overview

This folder contains the complete requirements and database schema for the Oracle-compatible General Ledger (GL) module implementation.

## Contents

### 1. GL_MODULE_REQUIREMENTS.md
**Comprehensive requirements document containing:**
- Complete Oracle GL menu structure (9 main categories with all submenus)
- Full database table design (40+ tables)
- User management system design
- Functional requirements
- Technical requirements
- Security requirements
- Implementation roadmap

**Menu Categories Documented:**
1. Setup (Financials, Journals, Accounts, Budgets, Consolidation)
2. Journals (Enter, Review, Post, Approve, Recurring, Mass Allocations)
3. Budgets (Define, Enter, Review, Control)
4. Inquiry (Account, Journal, Budget, Period)
5. Reports (Financial, Journal, Budget, Reconciliation)
6. Periods (Open/Close, Status)
7. Consolidation (Transfer, Consolidation, Elimination)
8. Tools (Mass Maintenance, Interface, Archives)
9. Processes (Period Close, Year End)

### 2. 01_user_management_schema.sql
**Database schema for user management including:**
- FND_USERS - User authentication and information
- FND_USER_SESSIONS - Session management
- FND_ROLES - Role definitions (6 default roles)
- FND_USER_ROLE_ASSIGNMENTS - User-role mapping
- FND_MENUS - Menu hierarchy
- FND_ROLE_MENU_ASSIGNMENTS - Role-based menu access
- HR_BUSINESS_UNITS - Business unit hierarchy
- FND_USER_BU_ASSIGNMENTS - Access rights (user-BU mapping)
- FND_AUDIT_LOG - Audit trail

**Default Roles Included:**
- GL_SUPER_USER - Full access
- GL_SUPERVISOR - Supervisor access
- GL_CONTROLLER - Controller access
- GL_BUDGET_USER - Budget access
- GL_USER - Standard user
- GL_INQUIRE_ONLY - Read-only access

### 3. 02_gl_core_schema.sql
**Database schema for GL core functionality including:**

**Ledger & Setup:**
- GL_LEDGERS - Ledger definitions
- GL_PERIOD_SETS - Calendar definitions
- GL_PERIOD_TYPES - Period types
- GL_PERIODS - Accounting periods
- GL_PERIOD_STATUSES - Period status by ledger

**Chart of Accounts:**
- GL_CODE_COMBINATIONS - Account combinations (8 segments)

**Journal Entries:**
- GL_JE_SOURCES - Journal sources
- GL_JE_CATEGORIES - Journal categories
- GL_JE_BATCHES - Journal batches
- GL_JE_HEADERS - Journal headers
- GL_JE_LINES - Journal lines

**Balances:**
- GL_BALANCES - Period balances
- GL_DAILY_BALANCES - Daily balances

**Budgets:**
- GL_BUDGETS - Budget definitions

**Interface:**
- GL_INTERFACE - Journal import interface

**Currency:**
- FND_CURRENCIES - Currency definitions
- GL_DAILY_RATES - Exchange rates

## Database Features

### Constraints
- Primary keys on all tables
- Foreign key relationships enforced
- Check constraints for data validation
- Unique constraints where applicable

### Indexing
- Primary key indexes
- Foreign key indexes
- Performance indexes on frequently queried columns

### Audit Trail
All tables include:
- CREATION_DATE
- CREATED_BY
- LAST_UPDATE_DATE
- LAST_UPDATED_BY

### Sequences
- Auto-incrementing sequences for all ID columns

## User Management Flow

```
User Login
    ↓
Validate Credentials (FND_USERS)
    ↓
Create Session (FND_USER_SESSIONS)
    ↓
Load User Roles (FND_USER_ROLE_ASSIGNMENTS)
    ↓
Load Accessible Menus (FND_ROLE_MENU_ASSIGNMENTS)
    ↓
Load Business Units (FND_USER_BU_ASSIGNMENTS)
    ↓
Apply Data Access Control
```

## Implementation Steps

### Phase 1: User Management (Weeks 1-2)
1. Run `01_user_management_schema.sql`
2. Implement login screen (see `/login.html`)
3. Implement authentication API
4. Implement session management
5. Implement role-based menu access

### Phase 2: GL Core Setup (Weeks 3-4)
1. Run `02_gl_core_schema.sql`
2. Implement ledger setup screens
3. Implement chart of accounts
4. Implement period management
5. Implement currency setup

### Phase 3: Journal Entry (Weeks 5-6)
1. Implement journal entry forms
2. Implement journal posting logic
3. Implement journal inquiry
4. Implement journal reports

### Phase 4: Budgets & Reports (Weeks 7-8)
1. Implement budget functionality
2. Implement account inquiry
3. Implement standard reports
4. Implement currency conversion

### Phase 5: Testing & Deployment (Weeks 9-10)
1. Integration testing
2. Performance optimization
3. User acceptance testing
4. Production deployment

## API Endpoints (To Be Implemented)

### Authentication
- POST /api/auth/login
- POST /api/auth/logout
- POST /api/auth/refresh-token

### Journals
- GET /api/gl/journals
- POST /api/gl/journals
- POST /api/gl/journals/{id}/post

### Accounts
- GET /api/gl/accounts
- GET /api/gl/accounts/{id}/balance

### Periods
- GET /api/gl/periods
- POST /api/gl/periods/{id}/open
- POST /api/gl/periods/{id}/close

### Users & Roles
- GET /api/users
- GET /api/users/{id}/roles
- GET /api/users/{id}/menus
- GET /api/users/{id}/business-units

## Security Considerations

### Password Policy
- Minimum 8 characters
- Complexity requirements
- 90-day expiration
- Account lockout after 5 failed attempts

### Session Security
- Secure token generation
- 30-minute timeout
- HTTPS required

### Data Security
- Business unit-based access control
- Role-based permissions
- Audit logging

## Testing

### Sample Test Users (To Be Created)
```sql
-- Super User
INSERT INTO FND_USERS (USER_ID, USER_NAME, ...) VALUES (...);

-- Standard User
INSERT INTO FND_USERS (USER_ID, USER_NAME, ...) VALUES (...);

-- Inquiry Only
INSERT INTO FND_USERS (USER_ID, USER_NAME, ...) VALUES (...);
```

## Reference

This implementation follows Oracle E-Business Suite R12 General Ledger structure and functionality.

### Key Oracle GL Tables Replicated:
- GL_LEDGERS
- GL_PERIODS / GL_PERIOD_STATUSES
- GL_CODE_COMBINATIONS
- GL_JE_BATCHES / GL_JE_HEADERS / GL_JE_LINES
- GL_BALANCES
- GL_BUDGETS
- GL_INTERFACE

### Oracle GL Menu Structure Replicated:
- All 9 main menu categories
- 50+ submenu items
- Complete navigation hierarchy

## Next Steps

1. ✅ Requirements documentation complete
2. ✅ Database schema design complete
3. ✅ Login screen created
4. ⏳ Implement backend authentication API
5. ⏳ Create database tables
6. ⏳ Implement GL setup screens
7. ⏳ Implement journal entry functionality
8. ⏳ Implement reports and inquiry

## Support

For questions or clarifications on the requirements, please refer to:
- GL_MODULE_REQUIREMENTS.md - Complete functional and technical requirements
- Oracle General Ledger User's Guide (R12)
- Oracle General Ledger Implementation Guide (R12)

---

**Document Version:** 1.0
**Last Updated:** November 8, 2025
**Status:** Ready for Implementation
