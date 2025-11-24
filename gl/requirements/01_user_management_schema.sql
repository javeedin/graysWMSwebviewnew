-- ============================================================================
-- USER MANAGEMENT SCHEMA
-- Oracle General Ledger - User, Role, Menu, Access Rights Tables
-- Version: 1.0
-- Date: November 8, 2025
-- ============================================================================

-- ============================================================================
-- 1. USERS TABLE
-- ============================================================================
CREATE TABLE FND_USERS (
    USER_ID                 NUMBER PRIMARY KEY,
    USER_NAME               VARCHAR2(100) NOT NULL UNIQUE,
    ENCRYPTED_PASSWORD      VARCHAR2(255) NOT NULL,
    EMAIL_ADDRESS           VARCHAR2(240),
    DESCRIPTION             VARCHAR2(240),
    START_DATE              DATE,
    END_DATE                DATE,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y' CHECK (ENABLED_FLAG IN ('Y', 'N')),
    LAST_LOGIN_DATE         DATE,
    FAILED_LOGIN_ATTEMPTS   NUMBER DEFAULT 0,
    PASSWORD_EXPIRY_DATE    DATE,
    PASSWORD_CHANGE_DATE    DATE,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);

CREATE SEQUENCE FND_USERS_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX FND_USERS_N1 ON FND_USERS(USER_NAME);
CREATE INDEX FND_USERS_N2 ON FND_USERS(EMAIL_ADDRESS);

COMMENT ON TABLE FND_USERS IS 'Stores application user information including authentication details';
COMMENT ON COLUMN FND_USERS.USER_ID IS 'Unique identifier for user';
COMMENT ON COLUMN FND_USERS.USER_NAME IS 'Login username (unique)';
COMMENT ON COLUMN FND_USERS.ENCRYPTED_PASSWORD IS 'Encrypted password using bcrypt or PBKDF2';

-- ============================================================================
-- 2. USER SESSIONS TABLE
-- ============================================================================
CREATE TABLE FND_USER_SESSIONS (
    SESSION_ID              NUMBER PRIMARY KEY,
    USER_ID                 NUMBER NOT NULL,
    INSTANCE_NAME           VARCHAR2(100) NOT NULL,
    SESSION_TOKEN           VARCHAR2(255) NOT NULL UNIQUE,
    LOGIN_TIME              TIMESTAMP NOT NULL,
    LAST_ACTIVITY_TIME      TIMESTAMP NOT NULL,
    IP_ADDRESS              VARCHAR2(50),
    USER_AGENT              VARCHAR2(500),
    STATUS                  VARCHAR2(20) DEFAULT 'ACTIVE' CHECK (STATUS IN ('ACTIVE', 'EXPIRED', 'LOGGED_OUT')),
    CREATION_DATE           DATE NOT NULL,
    CONSTRAINT FND_USER_SESSIONS_FK1 FOREIGN KEY (USER_ID) REFERENCES FND_USERS(USER_ID)
);

CREATE SEQUENCE FND_USER_SESSIONS_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX FND_USER_SESSIONS_N1 ON FND_USER_SESSIONS(USER_ID);
CREATE INDEX FND_USER_SESSIONS_N2 ON FND_USER_SESSIONS(SESSION_TOKEN);
CREATE INDEX FND_USER_SESSIONS_N3 ON FND_USER_SESSIONS(STATUS);

COMMENT ON TABLE FND_USER_SESSIONS IS 'Stores active user sessions';

-- ============================================================================
-- 3. ROLES TABLE
-- ============================================================================
CREATE TABLE FND_ROLES (
    ROLE_ID                 NUMBER PRIMARY KEY,
    ROLE_NAME               VARCHAR2(100) NOT NULL UNIQUE,
    DISPLAY_NAME            VARCHAR2(240),
    DESCRIPTION             VARCHAR2(500),
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y' CHECK (ENABLED_FLAG IN ('Y', 'N')),
    START_DATE              DATE,
    END_DATE                DATE,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);

CREATE SEQUENCE FND_ROLES_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX FND_ROLES_N1 ON FND_ROLES(ROLE_NAME);

COMMENT ON TABLE FND_ROLES IS 'Stores application roles for access control';

-- ============================================================================
-- 4. USER-ROLE ASSIGNMENTS TABLE
-- ============================================================================
CREATE TABLE FND_USER_ROLE_ASSIGNMENTS (
    USER_ROLE_ID            NUMBER PRIMARY KEY,
    USER_ID                 NUMBER NOT NULL,
    ROLE_ID                 NUMBER NOT NULL,
    START_DATE              DATE,
    END_DATE                DATE,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y' CHECK (ENABLED_FLAG IN ('Y', 'N')),
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    CONSTRAINT FND_USER_ROLE_ASSIGN_FK1 FOREIGN KEY (USER_ID) REFERENCES FND_USERS(USER_ID),
    CONSTRAINT FND_USER_ROLE_ASSIGN_FK2 FOREIGN KEY (ROLE_ID) REFERENCES FND_ROLES(ROLE_ID),
    CONSTRAINT FND_USER_ROLE_ASSIGN_U1 UNIQUE (USER_ID, ROLE_ID)
);

CREATE SEQUENCE FND_USER_ROLE_ASSIGN_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX FND_USER_ROLE_ASSIGN_N1 ON FND_USER_ROLE_ASSIGNMENTS(USER_ID);
CREATE INDEX FND_USER_ROLE_ASSIGN_N2 ON FND_USER_ROLE_ASSIGNMENTS(ROLE_ID);

COMMENT ON TABLE FND_USER_ROLE_ASSIGNMENTS IS 'Maps users to roles';

-- ============================================================================
-- 5. MENUS TABLE
-- ============================================================================
CREATE TABLE FND_MENUS (
    MENU_ID                 NUMBER PRIMARY KEY,
    MENU_NAME               VARCHAR2(100) NOT NULL UNIQUE,
    DISPLAY_NAME            VARCHAR2(240),
    DESCRIPTION             VARCHAR2(500),
    PARENT_MENU_ID          NUMBER,
    MENU_TYPE               VARCHAR2(30) CHECK (MENU_TYPE IN ('MAIN', 'SUBMENU', 'ACTION')),
    SEQUENCE                NUMBER,
    FUNCTION_NAME           VARCHAR2(100),
    URL                     VARCHAR2(500),
    ICON                    VARCHAR2(100),
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y' CHECK (ENABLED_FLAG IN ('Y', 'N')),
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    CONSTRAINT FND_MENUS_FK1 FOREIGN KEY (PARENT_MENU_ID) REFERENCES FND_MENUS(MENU_ID)
);

CREATE SEQUENCE FND_MENUS_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX FND_MENUS_N1 ON FND_MENUS(PARENT_MENU_ID);
CREATE INDEX FND_MENUS_N2 ON FND_MENUS(MENU_NAME);

COMMENT ON TABLE FND_MENUS IS 'Stores application menu hierarchy';

-- ============================================================================
-- 6. ROLE-MENU ASSIGNMENTS TABLE
-- ============================================================================
CREATE TABLE FND_ROLE_MENU_ASSIGNMENTS (
    ROLE_MENU_ID            NUMBER PRIMARY KEY,
    ROLE_ID                 NUMBER NOT NULL,
    MENU_ID                 NUMBER NOT NULL,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y' CHECK (ENABLED_FLAG IN ('Y', 'N')),
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    CONSTRAINT FND_ROLE_MENU_ASSIGN_FK1 FOREIGN KEY (ROLE_ID) REFERENCES FND_ROLES(ROLE_ID),
    CONSTRAINT FND_ROLE_MENU_ASSIGN_FK2 FOREIGN KEY (MENU_ID) REFERENCES FND_MENUS(MENU_ID),
    CONSTRAINT FND_ROLE_MENU_ASSIGN_U1 UNIQUE (ROLE_ID, MENU_ID)
);

CREATE SEQUENCE FND_ROLE_MENU_ASSIGN_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX FND_ROLE_MENU_ASSIGN_N1 ON FND_ROLE_MENU_ASSIGNMENTS(ROLE_ID);
CREATE INDEX FND_ROLE_MENU_ASSIGN_N2 ON FND_ROLE_MENU_ASSIGNMENTS(MENU_ID);

COMMENT ON TABLE FND_ROLE_MENU_ASSIGNMENTS IS 'Maps roles to accessible menus';

-- ============================================================================
-- 7. BUSINESS UNITS TABLE
-- ============================================================================
CREATE TABLE HR_BUSINESS_UNITS (
    BU_ID                   NUMBER PRIMARY KEY,
    BU_NAME                 VARCHAR2(240) NOT NULL UNIQUE,
    BU_CODE                 VARCHAR2(30),
    DESCRIPTION             VARCHAR2(500),
    PARENT_BU_ID            NUMBER,
    LEDGER_ID               NUMBER,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y' CHECK (ENABLED_FLAG IN ('Y', 'N')),
    START_DATE              DATE,
    END_DATE                DATE,
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    CONSTRAINT HR_BUSINESS_UNITS_FK1 FOREIGN KEY (PARENT_BU_ID) REFERENCES HR_BUSINESS_UNITS(BU_ID)
);

CREATE SEQUENCE HR_BUSINESS_UNITS_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX HR_BUSINESS_UNITS_N1 ON HR_BUSINESS_UNITS(PARENT_BU_ID);
CREATE INDEX HR_BUSINESS_UNITS_N2 ON HR_BUSINESS_UNITS(BU_CODE);

COMMENT ON TABLE HR_BUSINESS_UNITS IS 'Stores business unit hierarchy for data access control';

-- ============================================================================
-- 8. USER-BUSINESS UNIT ASSIGNMENTS (ACCESS RIGHTS) TABLE
-- ============================================================================
CREATE TABLE FND_USER_BU_ASSIGNMENTS (
    USER_BU_ID              NUMBER PRIMARY KEY,
    USER_ID                 NUMBER NOT NULL,
    BU_ID                   NUMBER NOT NULL,
    ACCESS_TYPE             VARCHAR2(30) CHECK (ACCESS_TYPE IN ('FULL', 'READ_ONLY', 'LIMITED')),
    START_DATE              DATE,
    END_DATE                DATE,
    ENABLED_FLAG            VARCHAR2(1) DEFAULT 'Y' CHECK (ENABLED_FLAG IN ('Y', 'N')),
    CREATION_DATE           DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,
    CONSTRAINT FND_USER_BU_ASSIGN_FK1 FOREIGN KEY (USER_ID) REFERENCES FND_USERS(USER_ID),
    CONSTRAINT FND_USER_BU_ASSIGN_FK2 FOREIGN KEY (BU_ID) REFERENCES HR_BUSINESS_UNITS(BU_ID),
    CONSTRAINT FND_USER_BU_ASSIGN_U1 UNIQUE (USER_ID, BU_ID)
);

CREATE SEQUENCE FND_USER_BU_ASSIGN_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX FND_USER_BU_ASSIGN_N1 ON FND_USER_BU_ASSIGNMENTS(USER_ID);
CREATE INDEX FND_USER_BU_ASSIGN_N2 ON FND_USER_BU_ASSIGNMENTS(BU_ID);

COMMENT ON TABLE FND_USER_BU_ASSIGNMENTS IS 'Access Rights - Maps users to business units with access level';

-- ============================================================================
-- 9. AUDIT LOG TABLE
-- ============================================================================
CREATE TABLE FND_AUDIT_LOG (
    AUDIT_ID                NUMBER PRIMARY KEY,
    USER_ID                 NUMBER,
    SESSION_ID              NUMBER,
    TABLE_NAME              VARCHAR2(100),
    OPERATION               VARCHAR2(20) CHECK (OPERATION IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT')),
    RECORD_ID               NUMBER,
    OLD_VALUE               CLOB,
    NEW_VALUE               CLOB,
    AUDIT_TIMESTAMP         TIMESTAMP NOT NULL,
    IP_ADDRESS              VARCHAR2(50),
    CREATION_DATE           DATE NOT NULL
);

CREATE SEQUENCE FND_AUDIT_LOG_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX FND_AUDIT_LOG_N1 ON FND_AUDIT_LOG(USER_ID);
CREATE INDEX FND_AUDIT_LOG_N2 ON FND_AUDIT_LOG(TABLE_NAME);
CREATE INDEX FND_AUDIT_LOG_N3 ON FND_AUDIT_LOG(AUDIT_TIMESTAMP);

COMMENT ON TABLE FND_AUDIT_LOG IS 'Audit trail for all system changes';

-- ============================================================================
-- SAMPLE DATA - Default Roles
-- ============================================================================
INSERT INTO FND_ROLES (ROLE_ID, ROLE_NAME, DISPLAY_NAME, DESCRIPTION, ENABLED_FLAG, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY)
VALUES (FND_ROLES_SEQ.NEXTVAL, 'GL_SUPER_USER', 'GL Super User', 'Full access to all GL functions including setup and maintenance', 'Y', SYSDATE, 0, SYSDATE, 0);

INSERT INTO FND_ROLES (ROLE_ID, ROLE_NAME, DISPLAY_NAME, DESCRIPTION, ENABLED_FLAG, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY)
VALUES (FND_ROLES_SEQ.NEXTVAL, 'GL_SUPERVISOR', 'GL Supervisor', 'Supervisor access for journal approval and period management', 'Y', SYSDATE, 0, SYSDATE, 0);

INSERT INTO FND_ROLES (ROLE_ID, ROLE_NAME, DISPLAY_NAME, DESCRIPTION, ENABLED_FLAG, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY)
VALUES (FND_ROLES_SEQ.NEXTVAL, 'GL_CONTROLLER', 'GL Controller', 'Controller access for financial reporting and analysis', 'Y', SYSDATE, 0, SYSDATE, 0);

INSERT INTO FND_ROLES (ROLE_ID, ROLE_NAME, DISPLAY_NAME, DESCRIPTION, ENABLED_FLAG, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY)
VALUES (FND_ROLES_SEQ.NEXTVAL, 'GL_BUDGET_USER', 'GL Budget User', 'Budget entry and inquiry access', 'Y', SYSDATE, 0, SYSDATE, 0);

INSERT INTO FND_ROLES (ROLE_ID, ROLE_NAME, DISPLAY_NAME, DESCRIPTION, ENABLED_FLAG, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY)
VALUES (FND_ROLES_SEQ.NEXTVAL, 'GL_USER', 'GL User', 'Standard GL user for journal entry', 'Y', SYSDATE, 0, SYSDATE, 0);

INSERT INTO FND_ROLES (ROLE_ID, ROLE_NAME, DISPLAY_NAME, DESCRIPTION, ENABLED_FLAG, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY)
VALUES (FND_ROLES_SEQ.NEXTVAL, 'GL_INQUIRE_ONLY', 'GL Inquiry Only', 'Read-only access to GL inquiries and reports', 'Y', SYSDATE, 0, SYSDATE, 0);

COMMIT;

-- ============================================================================
-- END OF USER MANAGEMENT SCHEMA
-- ============================================================================
